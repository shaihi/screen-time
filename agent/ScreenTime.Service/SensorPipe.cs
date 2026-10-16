using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using ScreenTime.Control;

namespace ScreenTime.Service;

internal sealed class SensorPipe(string childSid, Func<Decision> decision)
{
    private sealed record Observation(string State, long Sequence, long ReceivedTick, uint ProcessId);
    private readonly ConcurrentDictionary<int, Observation> observations = new();
    public (bool Healthy, string? State) Read(int session)
    {
        if (observations.TryGetValue(session, out var o) && Stopwatch.GetElapsedTime(o.ReceivedTick).TotalSeconds < 8)
            return (true, o.State);
        return (false, null);
    }
    public async Task Run(CancellationToken stop)
    {
        var acl = new PipeSecurity();
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(childSid), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create("ScreenTime.Control.v1", PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance, 4096, 4096, acl);
                await pipe.WaitForConnectionAsync(stop);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
                timeout.CancelAfter(TimeSpan.FromSeconds(3));
                var bytes = new List<byte>();
                var single = new byte[1];
                while (bytes.Count < 1024)
                {
                    var n = await pipe.ReadAsync(single, timeout.Token);
                    if (n == 0)
                        throw new InvalidDataException("Incomplete observation");
                    if (single[0] == (byte)'\n')
                        break;
                    bytes.Add(single[0]);
                }
                if (bytes.Count == 1024)
                    throw new InvalidDataException("Observation too long");
                int session = -1;
                pipe.RunAsClient(() =>
                {
                    using var identity = WindowsIdentity.GetCurrent(true) ?? throw new UnauthorizedAccessException();
                    if (identity.User?.Value != childSid)
                        throw new UnauthorizedAccessException("Wrong pipe client SID");
                    if (!GetTokenInformation(identity.AccessToken, 12, out var tokenSession, sizeof(int), out _))
                        throw new UnauthorizedAccessException("Cannot verify pipe client session");
                    session = tokenSession;
                });
                if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var pid) || !WindowsSessions.IsTrustedClient(pid, session) || !WindowsSessions.ForChild(childSid).Any(s => s.Id == session))
                    throw new UnauthorizedAccessException("Untrusted session sensor");
                using var doc = JsonDocument.Parse(bytes.ToArray(), new JsonDocumentOptions { MaxDepth = 4 });
                var root = doc.RootElement;
                if (root.GetProperty("type").GetString() != "observe")
                    throw new InvalidDataException("Only observations accepted");
                var state = root.GetProperty("state").GetString();
                var sequence = root.GetProperty("sequence").GetInt64();
                if (state is not ("active" or "media" or "idle" or "locked") || sequence < 0)
                    throw new InvalidDataException("Invalid sensor observation");
                if (observations.TryGetValue(session, out var old) && old.ProcessId == pid && sequence <= old.Sequence)
                    throw new InvalidDataException("Repeated sensor sequence");
                observations[session] = new(state, sequence, Stopwatch.GetTimestamp(), pid);
                var result = decision();
                var response = JsonSerializer.Serialize(new
                {
                    result.State,
                    result.RemainingSeconds,
                    result.Reason,
                    result.WarningSeconds
                }, ControlJson.Options) + "\n";
                await pipe.WriteAsync(Encoding.UTF8.GetBytes(response), timeout.Token);
                await pipe.FlushAsync(timeout.Token);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception e)
            {
                Storage.Log($"Sensor pipe: {e.GetType().Name}: {e.Message}");
                // A squatted pipe name or repeatedly invalid client must not consume a CPU core.
                try
                {
                    await Task.Delay(500, stop);
                }
                catch (OperationCanceledException) when (stop.IsCancellationRequested)
                {
                    break;
                }
            }
        }
    }
    [DllImport("kernel32", SetLastError = true)] private static extern bool GetNamedPipeClientProcessId(SafePipeHandle handle, out uint processId);
    [DllImport("advapi32", SetLastError = true)] private static extern bool GetTokenInformation(SafeAccessTokenHandle handle, int infoClass, out int tokenInfo, int size, out int needed);
}
