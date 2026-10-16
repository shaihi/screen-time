using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ScreenTime.Control;

namespace ScreenTime.Service;

internal sealed class ControlWorker : IDisposable
{
    private readonly object gate = new();
    private readonly ServiceConfig config;
    private readonly WindowsRestriction restriction;
    private readonly DurableState state;
    private readonly SensorPipe pipe;
    private readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) };
    private readonly Dictionary<int, DateTimeOffset> sensorLaunches = new();
    private Decision decision = new("monitoring", "Starting control service", null, null, false);
    private DateTimeOffset clockBase;
    private long clockTick;
    private ulong lastUsageTick;
    private string? error;
    private string? syncError;
    private bool previouslyCounted;
    private bool sensorHealthy;
    private bool untrustedClock;
    private string policyDay = "";
    public ControlWorker()
    {
        Storage.VerifyProtectedRoot();
        config = Storage.Read<ServiceConfig>("service.json");
        config.Validate();
        restriction = new(config);
        restriction.VerifyIdentity();
        state = File.Exists(Storage.PathFor("state.json")) ? Storage.Read<DurableState>("state.json") : new();
        RestorePolicies();
        var wall = DateTimeOffset.UtcNow;
        var delta = wall - state.WallUtc;
        untrustedClock = state.TrustedUtc != default && (delta < TimeSpan.FromMinutes(-2) || delta > TimeSpan.FromHours(36));
        clockBase = state.TrustedUtc == default ? state.Policies.ServerTimeUtc : state.TrustedUtc.Add(delta > TimeSpan.Zero && !untrustedClock ? delta : TimeSpan.Zero);
        clockTick = Stopwatch.GetTimestamp();
        if (!QueryUnbiasedInterruptTime(out lastUsageTick))
            throw new InvalidOperationException("Cannot read Windows monotonic usage clock");
        pipe = new(config.WindowsSid, () => { lock (gate) return decision; });
        var initial = state.Policies.Effective(Now);
        policyDay = initial is not null ? PolicyEvaluator.Day(initial, Now) : Now.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
    }
    private void RestorePolicies()
    {
        // State stores only envelopes verified again with the installation-pinned public key.
        var current = state.CurrentEnvelope;
        var accepted = state.AcceptedEnvelope;
        state.Policies = new();
        if (current is not null)
            Accept(current, restoring: true);
        if (accepted is not null)
            Accept(accepted, restoring: true);
        if (current is null && accepted is null)
            Accept(Storage.Read<SignedEnvelope>("policy.json"), restoring: true);
    }
    private DateTimeOffset Now => clockBase + Stopwatch.GetElapsedTime(clockTick);
    private void Accept(SignedEnvelope envelope, bool restoring = false)
    {
        var verified = PolicyVerifier.Verify(envelope, config.PolicyPublicKeyPem, config.HouseholdId, config.DeviceId, config.WindowsSid);
        var policyHash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(verified.Policy, ControlJson.Options)));
        // Preserve the prior accepted envelope if its pending policy became effective between polls.
        if (state.AcceptedEnvelope is { } previous && state.Policies.Effective(verified.ServerTimeUtc)?.Revision == state.Policies.HighestRevision)
            state.CurrentEnvelope = previous;
        state.Policies.Accept(verified.Policy, policyHash, verified.ServerTimeUtc);
        state.AcceptedEnvelope = envelope;
        if (state.Policies.Effective(verified.ServerTimeUtc)?.Revision == verified.Policy.Revision)
            state.CurrentEnvelope = envelope;
        if (!restoring)
        {
            // Correct significant offline drift from signed server time, including a previously advanced wall clock.
            // Small request/response delays never pull the running monotonic anchor backwards.
            var priorNow = Now;
            clockBase = untrustedClock || Math.Abs((verified.ServerTimeUtc - priorNow).TotalMinutes) > 2
                ? verified.ServerTimeUtc
                : verified.ServerTimeUtc > priorNow ? verified.ServerTimeUtc : priorNow;
            clockTick = Stopwatch.GetTimestamp();
            untrustedClock = false;
        }
    }
    public async Task Run(CancellationToken stop)
    {
        var pipeTask = pipe.Run(stop);
        var syncTask = SyncLoop(stop);
        try
        {
            while (!stop.IsCancellationRequested)
            {
                try
                {
                    lock (gate)
                        Tick();
                }
                catch (Exception e)
                {
                    lock (gate)
                    {
                        error = $"Enforcement: {e.Message}";
                        decision = new("error", Bound(error), decision.RemainingSeconds, null, decision.Blocked);
                    }
                    Storage.Log($"Enforcement error: {e.GetType().Name}: {e.Message}");
                }
                await Task.Delay(1000, stop);
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        finally { await Task.WhenAll(pipeTask, syncTask); }
    }
    private void Tick()
    {
        var now = Now;
        var priorAppliedRevision = state.AppliedRevision;
        var policy = state.Policies.Effective(now);
        if (policy is null)
        {
            if (!QueryUnbiasedInterruptTime(out lastUsageTick))
                throw new InvalidOperationException("Monotonic usage clock unavailable");
            previouslyCounted = false;
            decision = new("monitoring", "Waiting for initial policy effective time", null, null, false);
            Persist(now);
            return;
        }
        if (state.AcceptedEnvelope is { } accepted && policy.Revision == state.Policies.HighestRevision)
            state.CurrentEnvelope = accepted;
        if (!QueryUnbiasedInterruptTime(out var ticks))
            throw new InvalidOperationException("Monotonic usage clock unavailable");
        var elapsed = ticks >= lastUsageTick ? (ticks - lastUsageTick) / 10_000_000.0 : 0;
        lastUsageTick = ticks;
        var sessions = WindowsSessions.ForChild(config.WindowsSid);
        policyDay = PolicyEvaluator.Day(policy, now);
        state.Ledger.BindTimeZone(policy.TimeZone, policyDay);
        var active = sessions.Where(s => s.Unlocked).ToArray();
        sensorHealthy = active.All(s => pipe.Read(s.Id).Healthy);
        var countUsage = active.Any(s => { var sample = pipe.Read(s.Id); return UsageAccounting.Count(policy.BudgetBasis, true, sample.Healthy && sample.State != "locked", sample.State); });
        if (countUsage || previouslyCounted)
            state.Ledger.Add(policyDay, elapsed);
        previouslyCounted = countUsage;
        // Evaluating a regressed timezone/day reuses the high-water usage day, never a new allowance.
        var used = state.Ledger.Used(policyDay);
        var desired = PolicyEvaluator.WarnPending(PolicyEvaluator.Evaluate(policy, now, used), state.Policies.Pending, now);
        state.RestrictionDesired = desired.Blocked;
        // Write journal and consumed seconds before normal account access changes.
        if (!PersistForEnforcement(now, policy, priorAppliedRevision))
            return;
        if (policy.Mode == "managed" && restriction.IsChildAdministrator())
            throw new InvalidDataException("Managed controls require a standard child account; sign out old administrator sessions");
        restriction.SetBlocked(desired.Blocked);
        state.AppliedRevision = policy.Revision;
        error = untrustedClock ? "Local clock changed unexpectedly; trusted time is held until authenticated sync" : null;
        decision = untrustedClock ? desired with
        {
            State = "error",
            Reason = error!
        } : desired;
        foreach (var session in active)
        {
            if (!desired.Blocked && !pipe.Read(session.Id).Healthy && (!sensorLaunches.TryGetValue(session.Id, out var last) || now - last > TimeSpan.FromSeconds(30)))
            {
                sensorLaunches[session.Id] = now;
                try
                {
                    WindowsSessions.LaunchSensor(session.Id);
                }
                catch (Exception e) { error = $"Sensor unavailable; unlocked-session fallback active: {e.Message}"; Storage.Log(error); }
            }
        }
        PersistForEnforcement(now, policy, priorAppliedRevision);
    }
    private bool PersistForEnforcement(DateTimeOffset now, ControlPolicy policy, long priorAppliedRevision)
    {
        try
        {
            Persist(now);
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // A full disk must not become a way to stop the timer. No successful policy application is
            // acknowledged when persistence fails. The protected enrollment remains the recovery authority.
            state.AppliedRevision = priorAppliedRevision;
            var blocked = policy.Mode == "managed";
            if (blocked)
            {
                state.RestrictionDesired = true;
                restriction.SetBlocked(true);
            }
            error = blocked ? "Local storage unavailable; child access restricted. Parent: free disk space or run offline recovery."
                : "Local storage unavailable; monitoring state cannot be saved.";
            decision = new("error", error, decision.RemainingSeconds, null, blocked);
            Storage.Log($"State persistence failed: {e.GetType().Name}");
            return false;
        }
    }
    private void Persist(DateTimeOffset now)
    {
        state.TrustedUtc = now;
        state.WallUtc = DateTimeOffset.UtcNow;
        Storage.Save("state.json", state);
    }
    private async Task SyncLoop(CancellationToken stop)
    {
        var backoff = 1;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stop);
                deadline.CancelAfter(TimeSpan.FromSeconds(15));
                string body;
                lock (gate)
                {
                    body = JsonSerializer.Serialize(new
                    {
                        protocolVersion = 1,
                        appliedRevision = state.AppliedRevision,
                        state = decision.State,
                        reason = decision.Reason,
                        usedSeconds = (long)Math.Ceiling(state.Ledger.Used(policyDay)),
                        remainingSeconds = decision.RemainingSeconds,
                        policyDay,
                        sensorHealthy,
                        agentVersion = "2.0.0",
                        error = (error ?? syncError) is { } reportError ? Bound(reportError) : null
                    }, ControlJson.Options);
                }
                // Request authentication uses Windows UTC; policy enforcement uses its protected monotonic anchor.
                // This lets a correct wall clock obtain signed server-time repair after a long offline shutdown.
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                var nonce = Guid.NewGuid().ToString();
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(config.ApiBaseUrl), "/api/agent/control/sync"));
                request.Headers.Add("x-screen-time-device-id", config.DeviceId);
                request.Headers.Add("x-screen-time-timestamp", timestamp.ToString(System.Globalization.CultureInfo.InvariantCulture));
                request.Headers.Add("x-screen-time-nonce", nonce);
                request.Headers.Add("x-screen-time-signature", RequestAuthentication.Sign(config.Credential, config.DeviceId, timestamp, nonce, body));
                request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength is > 262144)
                    throw new InvalidDataException("Sync response too large");
                await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
                using var limited = new MemoryStream();
                var buffer = new byte[4096];
                int count;
                while ((count = await stream.ReadAsync(buffer, deadline.Token)) > 0)
                {
                    if (limited.Length + count > 262144)
                        throw new InvalidDataException("Sync response too large");
                    limited.Write(buffer, 0, count);
                }
                using var parsed = JsonDocument.Parse(limited.ToArray(), new JsonDocumentOptions { MaxDepth = 16 });
                var envelope = parsed.RootElement.GetProperty("envelope").Deserialize<SignedEnvelope>(ControlJson.Options) ?? throw new InvalidDataException("Missing envelope");
                lock (gate)
                {
                    Accept(envelope);
                    syncError = null;
                    Persist(Now);
                }
                backoff = 1;
                await Task.Delay(TimeSpan.FromSeconds(30 + Random.Shared.Next(0, 5)), stop);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception e)
            {
                lock (gate)
                    syncError = Bound($"Policy sync unavailable; saved rules continue: {e.GetType().Name}");
                Storage.Log($"Control sync failed: {e.GetType().Name}");
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Min(60, backoff * 5)), stop);
                }
                catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
                backoff = Math.Min(backoff * 2, 12);
            }
        }
    }
    private static string Bound(string message) => message[..Math.Min(message.Length, 500)].Replace('\r', ' ').Replace('\n', ' ');
    public void Dispose() => http.Dispose();
    [DllImport("kernel32", SetLastError = true)] private static extern bool QueryUnbiasedInterruptTime(out ulong time);
}
