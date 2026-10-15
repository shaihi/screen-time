using System.IO.Pipes;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text;
using System.Text.Json;

namespace ScreenTime.Agent;

internal sealed record ControlStatus(string State, int? RemainingSeconds, string Reason, int? WarningSeconds);

/// <summary>Best effort observations only. The protected service owns all time and policy decisions.</summary>
internal sealed class ControlPipeClient(string pipeName = "ScreenTime.Control.v1", TimeSpan? timeout = null)
{
    private readonly TimeSpan _timeout = timeout ?? TimeSpan.FromMilliseconds(700);
    private long _sequence;
    private int _busy;
    internal const int MaxResponseCharacters = 4096;

    public async Task<ControlStatus?> ObserveAsync(ActivityState state)
    {
        // An absent or stalled service must never queue work behind the activity sampler.
        if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return null;
        try
        {
            using var deadline = new CancellationTokenSource(_timeout);
            await using var pipe = await ConnectAsync(deadline.Token).ConfigureAwait(false);
            var observation = JsonSerializer.Serialize(new
            {
                type = "observe",
                state = state switch { ActivityState.Active => "active", ActivityState.Media => "media", ActivityState.Locked => "locked", _ => "idle" },
                sequence = Interlocked.Increment(ref _sequence),
            });
            await pipe.WriteAsync(Encoding.UTF8.GetBytes(observation + "\n"), deadline.Token).ConfigureAwait(false);
            await pipe.FlushAsync(deadline.Token).ConfigureAwait(false);
            using var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, leaveOpen: true);
            var buffer = new char[1];
            var line = new StringBuilder();
            while (line.Length <= MaxResponseCharacters)
            {
                if (await reader.ReadAsync(buffer.AsMemory(), deadline.Token).ConfigureAwait(false) == 0) return null;
                if (buffer[0] == '\n') return ParseStatus(line.ToString().TrimEnd('\r'));
                line.Append(buffer[0]);
            }
            return null;
        }
        catch (Exception exception) when (exception is IOException or OperationCanceledException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
        finally { Volatile.Write(ref _busy, 0); }
    }

    private async Task<NamedPipeClientStream> ConnectAsync(CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsWindows())
        {
            var portable = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            try { await portable.ConnectAsync(cancellationToken).ConfigureAwait(false); return portable; }
            catch { portable.Dispose(); throw; }
        }
        // GENERIC_WRITE also requests FILE_CREATE_PIPE_INSTANCE. A child may send observations,
        // but must never gain the right to create a competing service pipe instance.
        const uint observationAccess = 0x00100183; // Synchronize, data read/write, attributes read/write.
        const uint overlappedImpersonation = 0x40120000; // OVERLAPPED + SQOS_PRESENT + IMPERSONATION.
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var handle = CreateFileW(@"\\.\pipe\" + pipeName, observationAccess, 0, IntPtr.Zero, 3, overlappedImpersonation, IntPtr.Zero);
            if (!handle.IsInvalid)
            {
                try { return new NamedPipeClientStream(PipeDirection.InOut, true, true, handle); }
                catch { handle.Dispose(); throw; }
            }
            var error = Marshal.GetLastWin32Error();
            handle.Dispose();
            if (error is not (2 or 231)) throw new IOException("Screen Time service pipe is unavailable.", new Win32Exception(error));
            await Task.Delay(20, cancellationToken).ConfigureAwait(false);
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern SafePipeHandle CreateFileW(string fileName, uint desiredAccess, uint shareMode,
        IntPtr securityAttributes, uint creationDisposition, uint flags, IntPtr templateFile);

    internal static ControlStatus? ParseStatus(string json)
    {
        if (json.Length > MaxResponseCharacters) return null;
        try
        {
            var status = JsonSerializer.Deserialize<ControlStatus>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (status is null || status.State is not ("allowed" or "warning" or "blocked" or "monitoring" or "error") ||
                status.Reason is null || status.Reason.Length > 1000 || status.RemainingSeconds < 0 ||
                status.WarningSeconds is not (null or 300 or 60)) return null;
            return status;
        }
        catch (JsonException) { return null; }
    }
}
