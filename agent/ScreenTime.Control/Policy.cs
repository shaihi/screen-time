using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace ScreenTime.Control;

public static class ControlJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = false, MaxDepth = 16 };
}
public sealed record AllowedWindow(int DayOfWeek, int StartMinute, int EndMinute);
public sealed record TimeGrant(Guid Id, string Day, int Seconds, DateTimeOffset ExpiresAtUtc);
public sealed record PolicyOverride(Guid Id, DateTimeOffset UntilUtc, bool IgnoreBudget, bool IgnoreSchedule);
public sealed record ControlPolicy
{
    [JsonRequired]
    public int SchemaVersion { get; init; } = 1;
    [JsonRequired]
    public string HouseholdId { get; init; } = "";
    [JsonRequired]
    public string DeviceId { get; init; } = "";
    [JsonRequired]
    public string WindowsSid { get; init; } = "";
    [JsonRequired]
    public long Revision
    {
        get; init;
    }
    [JsonRequired]
    public DateTimeOffset IssuedAtUtc
    {
        get; init;
    }
    [JsonRequired]
    public DateTimeOffset EffectiveAtUtc
    {
        get; init;
    }
    [JsonRequired]
    public string Mode { get; init; } = "monitor";
    // Optional for backward compatibility with policies issued before the shutdown control existed.
    public bool Shutdown { get; init; }
    [JsonRequired]
    public string TimeZone { get; init; } = "Asia/Jerusalem";
    [JsonRequired]
    public int? DailyLimitSeconds
    {
        get; init;
    }
    [JsonRequired]
    public string BudgetBasis { get; init; } = "actual_use";
    [JsonRequired]
    public AllowedWindow[] AllowedWindows { get; init; } = [];
    [JsonRequired]
    public TimeGrant[] Grants { get; init; } = [];
    [JsonRequired]
    public PolicyOverride? Override
    {
        get; init;
    }
}
public sealed record SignedEnvelope(string Payload, string Signature);
public sealed record SignedPayload(ControlPolicy Policy, DateTimeOffset ServerTimeUtc);
public sealed record Decision(string State, string Reason, int? RemainingSeconds, int? WarningSeconds, bool Blocked);

public static class PolicyValidation
{
    public static bool IsChildSid(string sid) => Regex.IsMatch(sid, @"^S-1-5-21-\d+-\d+-\d+-\d+$", RegexOptions.CultureInvariant);
    public static void Validate(ControlPolicy p)
    {
        if (p.SchemaVersion != 1 || p.Revision < 1 || !Regex.IsMatch(p.DeviceId, @"^[a-zA-Z0-9._-]{1,64}$") || string.IsNullOrWhiteSpace(p.HouseholdId) || !IsChildSid(p.WindowsSid))
            throw new InvalidDataException("Invalid policy identity/version");
        if (p.Mode is not ("managed" or "monitor") || p.BudgetBasis is not ("actual_use" or "unlocked_session") || p.DailyLimitSeconds is < 60 or > 86400)
            throw new InvalidDataException("Invalid policy rules");
        if (p.IssuedAtUtc == default || p.EffectiveAtUtc < p.IssuedAtUtc || p.AllowedWindows is null || p.Grants is null || p.AllowedWindows.Length > 128 || p.Grants.Length > 256)
            throw new InvalidDataException("Invalid policy dates/limits");
        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(p.TimeZone);
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException) { throw new InvalidDataException("Unknown policy timezone", e); }
        foreach (var w in p.AllowedWindows)
            if (w.DayOfWeek is < 0 or > 6 || w.StartMinute is < 0 or > 1439 || w.EndMinute is < 1 or > 1440 || w.StartMinute >= w.EndMinute)
                throw new InvalidDataException("Invalid allowed-hours interval");
        foreach (var g in p.Grants)
            if (g.Id == Guid.Empty || g.Seconds is < 60 or > 86400 || !DateOnly.TryParseExact(g.Day, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                throw new InvalidDataException("Invalid time grant");
        if (p.Override is { } o && (o.Id == Guid.Empty || o.UntilUtc > p.IssuedAtUtc.AddHours(24) || (!o.IgnoreBudget && !o.IgnoreSchedule)))
            throw new InvalidDataException("Invalid override");
    }
}
public static class PolicyEvaluator
{
    public static Decision WarnPending(Decision current, ControlPolicy? pending, DateTimeOffset now)
    {
        if (current.Blocked || pending is null || pending.Mode != "managed" || pending.EffectiveAtUtc <= now)
            return current;
        var seconds = (pending.EffectiveAtUtc - now).TotalSeconds;
        if (seconds > 300)
            return current;
        var warning = seconds <= 60 ? 60 : 300;
        if (current.WarningSeconds is { } existing && existing < warning)
            return current;
        return current with
        {
            State = "warning",
            Reason = "New screen-time rules apply soon. Save your work.",
            WarningSeconds = warning
        };
    }
    public static string Day(ControlPolicy p, DateTimeOffset now) => TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(p.TimeZone)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static Decision Evaluate(ControlPolicy p, DateTimeOffset now, double usedSeconds)
    {
        if (p.Shutdown)
            return new("blocked", "Parent requested shutdown", 0, null, true);
        if (p.Mode == "monitor")
            return new("monitoring", "Monitoring only", null, null, false);
        var local = TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(p.TimeZone));
        var day = local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var activeOverride = p.Override is { } o && o.UntilUtc > now ? o : null;
        int? remaining = null;
        if (p.DailyLimitSeconds is { } cap && activeOverride?.IgnoreBudget != true)
        {
            var grants = p.Grants.Where(g => g.Day == day && g.ExpiresAtUtc > now).DistinctBy(g => g.Id).Sum(g => (long)g.Seconds);
            remaining = (int)Math.Clamp(cap + grants - (long)Math.Ceiling(usedSeconds), 0, int.MaxValue);
        }
        double? scheduleRemaining = null;
        if (p.AllowedWindows.Length > 0 && activeOverride?.IgnoreSchedule != true)
        {
            var minute = local.TimeOfDay.TotalMinutes;
            var windows = p.AllowedWindows.Where(w => w.DayOfWeek == (int)local.DayOfWeek && w.StartMinute <= minute && minute < w.EndMinute).ToArray();
            if (windows.Length == 0)
                return new("blocked", "Outside allowed hours", remaining, null, true);
            // Merge overlapping/adjacent intervals so warnings use the actual end of access.
            var end = windows.Max(w => w.EndMinute);
            foreach (var w in p.AllowedWindows.Where(w => w.DayOfWeek == (int)local.DayOfWeek).OrderBy(w => w.StartMinute))
                if (w.StartMinute <= end && w.EndMinute > end)
                    end = w.EndMinute;
            scheduleRemaining = (end - minute) * 60;
        }
        if (remaining is <= 0)
            return new("blocked", "Daily screen time used", 0, null, true);
        var deadline = Math.Min(remaining ?? double.PositiveInfinity, scheduleRemaining ?? double.PositiveInfinity);
        int? warning = deadline <= 60 ? 60 : deadline <= 300 ? 300 : null;
        return new(warning.HasValue ? "warning" : "allowed", warning.HasValue ? "Save your work before screen time ends" : "Within screen-time rules", remaining, warning, false);
    }
}
public sealed record RestrictionTransition(Decision Decision, DateTimeOffset? CountdownUntilUtc, bool EnforceBlocked);
public static class RestrictionCountdown
{
    public static readonly TimeSpan Duration = TimeSpan.FromSeconds(30);

    public static RestrictionTransition Evaluate(Decision desired, bool wasDesiredBlocked, DateTimeOffset? countdownUntilUtc, DateTimeOffset now)
    {
        if (!desired.Blocked)
            return new(desired, null, false);
        if (!wasDesiredBlocked && countdownUntilUtc is null)
            countdownUntilUtc = now.Add(Duration);
        if (countdownUntilUtc is { } deadline && deadline > now)
        {
            var seconds = Math.Clamp((int)Math.Ceiling((deadline - now).TotalSeconds), 1, (int)Duration.TotalSeconds);
            return new(new Decision(
                "countdown",
                $"{desired.Reason}. Save now; all apps close in {seconds} seconds.",
                desired.RemainingSeconds,
                seconds,
                false), deadline, false);
        }
        return new(desired, null, true);
    }
}
public static class PolicyVerifier
{
    public static SignedPayload Verify(SignedEnvelope envelope, string publicKey, string household, string device, string sid)
    {
        try
        {
            if (string.IsNullOrEmpty(envelope.Payload) || string.IsNullOrEmpty(envelope.Signature) || envelope.Payload.Length > 262144 || envelope.Signature.Length > 2048)
                throw new InvalidDataException("Envelope too large");
            var bytes = Convert.FromBase64String(envelope.Payload);
            using var rsa = RSA.Create();
            rsa.ImportFromPem(publicKey);
            if (rsa.KeySize < 2048 || !rsa.VerifyData(bytes, Convert.FromBase64String(envelope.Signature), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
                throw new InvalidDataException("Invalid policy signature");
            var payload = JsonSerializer.Deserialize<SignedPayload>(bytes, ControlJson.Options) ?? throw new InvalidDataException("Empty policy");
            if (payload.Policy is null)
                throw new InvalidDataException("Missing policy");
            PolicyValidation.Validate(payload.Policy);
            if (payload.Policy.HouseholdId != household || payload.Policy.DeviceId != device || payload.Policy.WindowsSid != sid || payload.ServerTimeUtc < payload.Policy.IssuedAtUtc)
                throw new InvalidDataException("Wrong policy target/time");
            return payload;
        }
        catch (Exception e) when (e is FormatException or CryptographicException or JsonException or ArgumentException) { throw new InvalidDataException("Invalid policy envelope", e); }
    }
}
public sealed class PolicyCache
{
    public ControlPolicy? Current
    {
        get; set;
    }
    public ControlPolicy? Pending
    {
        get; set;
    }
    public long HighestRevision
    {
        get; set;
    }
    public string PolicyHash { get; set; } = "";
    public DateTimeOffset ServerTimeUtc
    {
        get; set;
    }
    public void Accept(ControlPolicy policy, string hash, DateTimeOffset serverTime)
    {
        if (policy.Revision < HighestRevision || (policy.Revision == HighestRevision && PolicyHash != hash) || serverTime < ServerTimeUtc)
            throw new InvalidDataException("Policy rollback, conflicting revision, or regressing server time");
        Effective(serverTime);
        if (policy.Revision > HighestRevision)
        {
            Pending = policy;
            HighestRevision = policy.Revision;
            PolicyHash = hash;
        }
        ServerTimeUtc = serverTime;
    }
    public ControlPolicy? Effective(DateTimeOffset now)
    {
        if (Pending is { } p && p.EffectiveAtUtc <= now)
        {
            Current = p;
            Pending = null;
        }
        return Current;
    }
}
public sealed class UsageLedger
{
    public Dictionary<string, double> Days { get; set; } = new(StringComparer.Ordinal);
    public string HighWaterDay { get; set; } = "";
    public string TimeZone { get; set; } = "";
    public string Day(string day) => string.CompareOrdinal(day, HighWaterDay) < 0 ? HighWaterDay : day;
    public void Add(string day, double seconds)
    {
        if (!double.IsFinite(seconds) || seconds < 0)
            throw new ArgumentOutOfRangeException(nameof(seconds));
        day = Day(day);
        HighWaterDay = day;
        Days[day] = Days.GetValueOrDefault(day) + seconds;
    }
    public double Used(string day) => Days.GetValueOrDefault(Day(day));
    public void BindTimeZone(string zone, string day)
    {
        if (TimeZone.Length > 0 && zone != TimeZone && HighWaterDay.Length > 0)
        {
            // A policy timezone edit must not issue a fresh allowance on the same instant.
            var used = Days.GetValueOrDefault(HighWaterDay);
            day = Day(day);
            Days[day] = Math.Max(Days.GetValueOrDefault(day), used);
            HighWaterDay = day;
        }
        TimeZone = zone;
        // Observe legitimate midnight even while the child is signed out; a later timezone edit
        // carries this day's usage, rather than yesterday's unused historical counter.
        Add(day, 0);
    }
}
public static class UsageAccounting
{
    public static bool Count(string basis, bool verifiedUnlocked, bool sensorHealthy, string? observation) => verifiedUnlocked && (basis == "unlocked_session" || !sensorHealthy || observation is "active" or "media");
}
public static class RequestAuthentication
{
    public static string Sign(string credential, string device, long timestamp, string nonce, string body)
    {
        var bodyHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
        var canonical = $"v1\nPOST\n/api/agent/control/sync\n{device}\n{timestamp}\n{nonce}\n{bodyHash}";
        return Convert.ToHexString(HMACSHA256.HashData(Convert.FromBase64String(credential), Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }
}
