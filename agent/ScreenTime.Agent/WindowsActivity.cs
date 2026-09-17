using System.Diagnostics;
using System.Runtime.InteropServices;
using Windows.Media.Control;

namespace ScreenTime.Agent;

internal sealed class WindowsActivity
{
    private const uint DesktopSwitchDesktop = 0x0100;
    private GlobalSystemMediaTransportControlsSessionManager? _mediaManager;

    public async Task<Classification> ClassifyAsync(int idleThresholdSeconds)
    {
        if (IsWorkstationLocked()) return new(ActivityState.Locked, null);
        var foregroundApp = GetForegroundApp();
        if (GetIdleSeconds() < idleThresholdSeconds) return new(ActivityState.Active, foregroundApp);
        var mediaApp = await GetPlayingMediaAppAsync();
        return mediaApp is not null ? new(ActivityState.Media, mediaApp) : new(ActivityState.Idle, foregroundApp);
    }

    private async Task<string?> GetPlayingMediaAppAsync()
    {
        try
        {
            _mediaManager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var playing = _mediaManager.GetSessions().FirstOrDefault(session =>
                session.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing);
            return playing is null ? null : FriendlyName(playing.SourceAppUserModelId);
        }
        catch { _mediaManager = null; return null; }
    }

    private static string? GetForegroundApp()
    {
        try
        {
            var window = GetForegroundWindow();
            if (window == IntPtr.Zero) return null;
            _ = GetWindowThreadProcessId(window, out var processId);
            return FriendlyName(Process.GetProcessById((int)processId).ProcessName);
        }
        catch { return null; }
    }

    private static string FriendlyName(string source)
    {
        var value = source.ToLowerInvariant();
        if (value.Contains("codex")) return "Codex";
        if (value.Contains("chatgpt")) return "ChatGPT";
        if (value.Contains("chrome")) return "Google Chrome";
        if (value.Contains("msedge")) return "Microsoft Edge";
        if (value.Contains("firefox")) return "Firefox";
        if (value.Contains("netflix")) return "Netflix";
        if (value.Contains("vlc")) return "VLC";
        if (value.Contains("spotify")) return "Spotify";
        if (value.Contains("discord")) return "Discord";
        if (value is "code" or "code.exe" || value.Contains("visualstudiocode")) return "Visual Studio Code";
        var filename = Path.GetFileNameWithoutExtension(source);
        return filename.Length > 120 ? filename[..120] : filename;
    }

    private static uint GetIdleSeconds()
    {
        var info = new LastInputInfo { Size = (uint)Marshal.SizeOf<LastInputInfo>() };
        if (!GetLastInputInfo(ref info)) return 0;
        return unchecked((uint)Environment.TickCount - info.Time) / 1000;
    }

    private static bool IsWorkstationLocked()
    {
        var desktop = OpenInputDesktop(0, false, DesktopSwitchDesktop);
        if (desktop == IntPtr.Zero) return true;
        try { return !SwitchDesktop(desktop); }
        finally { _ = CloseDesktop(desktop); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LastInputInfo { public uint Size; public uint Time; }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);
    [DllImport("user32.dll")] private static extern bool SwitchDesktop(IntPtr desktop);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
}
