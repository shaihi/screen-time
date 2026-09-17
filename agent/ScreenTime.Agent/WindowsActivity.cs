using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Windows.Management.Deployment;
using Windows.Media.Control;

namespace ScreenTime.Agent;

internal sealed class WindowsActivity
{
    private const uint DesktopSwitchDesktop = 0x0100;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const int MaxCachedNames = 256;
    private GlobalSystemMediaTransportControlsSessionManager? _mediaManager;
    private PackageManager? _packageManager;
    private readonly Dictionary<(uint ProcessId, string ProcessName), string?> _processNames = new();
    private readonly Dictionary<string, string> _mediaNames = new(StringComparer.OrdinalIgnoreCase);

    public async Task<Classification> ClassifyAsync(int idleThresholdSeconds)
    {
        if (IsWorkstationLocked()) return new(ActivityState.Locked, null);
        var foregroundApp = GetForegroundApp();
        var mediaApp = await GetPlayingMediaAppAsync();
        if (GetIdleSeconds() < idleThresholdSeconds)
            return new(ActivityState.Active, foregroundApp, mediaApp != foregroundApp ? mediaApp : null);
        return mediaApp is not null ? new(ActivityState.Media, mediaApp) : new(ActivityState.Idle, foregroundApp);
    }

    private async Task<string?> GetPlayingMediaAppAsync()
    {
        try
        {
            _mediaManager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var playing = _mediaManager.GetSessions().FirstOrDefault(session =>
                session.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing);
            return playing is null ? null : MediaAppName(playing.SourceAppUserModelId);
        }
        catch { _mediaManager = null; return null; }
    }

    private string MediaAppName(string aumid)
    {
        if (_mediaNames.TryGetValue(aumid, out var cached)) return cached;
        var name = AppNames.Known(aumid)
            ?? (aumid.Contains('!') ? PackageDisplayNameByFamily(aumid.Split('!')[0]) : null)
            ?? AppNames.FromAppUserModelId(aumid);
        if (_mediaNames.Count >= MaxCachedNames) _mediaNames.Clear();
        _mediaNames[aumid] = name;
        return name;
    }

    private string? GetForegroundApp()
    {
        try
        {
            var window = GetForegroundWindow();
            if (window == IntPtr.Zero) return null;
            _ = GetWindowThreadProcessId(window, out var processId);
            using var process = Process.GetProcessById((int)processId);
            // Store (UWP) apps are drawn inside ApplicationFrameHost; the real app owns a child window.
            if (process.ProcessName.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase))
                return HostedAppName(window, processId);
            return ProcessAppName(processId, process.ProcessName);
        }
        catch { return null; }
    }

    private string? HostedAppName(IntPtr frame, uint frameProcessId)
    {
        uint hostedProcessId = 0;
        _ = EnumChildWindows(frame, (child, parameter) =>
        {
            _ = GetWindowThreadProcessId(child, out var childProcessId);
            if (childProcessId == frameProcessId) return true;
            hostedProcessId = childProcessId;
            return false;
        }, IntPtr.Zero);
        if (hostedProcessId == 0) return null;
        using var hosted = Process.GetProcessById((int)hostedProcessId);
        return ProcessAppName(hostedProcessId, hosted.ProcessName);
    }

    private string? ProcessAppName(uint processId, string processName)
    {
        var key = (processId, processName);
        if (_processNames.TryGetValue(key, out var cached)) return cached;
        var name = ResolveProcessName(processId, processName);
        if (_processNames.Count >= MaxCachedNames) _processNames.Clear();
        _processNames[key] = name;
        return name;
    }

    private string? ResolveProcessName(uint processId, string processName)
    {
        if (AppNames.IsSystemProcess(processName)) return null;
        var packageFullName = QueryProcessString(processId, GetPackageFullName);
        return AppNames.Known(processName)
            ?? AppNames.Known(packageFullName)
            ?? (packageFullName is null ? null : PackageDisplayName(packageFullName))
            ?? FileDescription(processId)
            ?? AppNames.Clean(processName);
    }

    private string? PackageDisplayName(string packageFullName)
    {
        try
        {
            _packageManager ??= new PackageManager();
            return AppNames.Clean(_packageManager.FindPackageForUser(string.Empty, packageFullName)?.DisplayName);
        }
        catch { return AppNames.FromAppUserModelId(packageFullName); }
    }

    private string? PackageDisplayNameByFamily(string packageFamilyName)
    {
        try
        {
            _packageManager ??= new PackageManager();
            var package = _packageManager.FindPackagesForUser(string.Empty, packageFamilyName).FirstOrDefault();
            return AppNames.Clean(package?.DisplayName);
        }
        catch { return null; }
    }

    private static string? FileDescription(uint processId)
    {
        try
        {
            var path = QueryProcessString(processId, QueryFullProcessImageName);
            if (path is null) return null;
            var info = FileVersionInfo.GetVersionInfo(path);
            return AppNames.Clean(info.FileDescription) ?? AppNames.Clean(info.ProductName);
        }
        catch { return null; }
    }

    private delegate int ProcessStringQuery(IntPtr process, ref uint length, StringBuilder buffer);

    private static string? QueryProcessString(uint processId, ProcessStringQuery query)
    {
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle == IntPtr.Zero) return null;
        try
        {
            uint length = 1024;
            var buffer = new StringBuilder((int)length);
            return query(handle, ref length, buffer) == 0 && length > 0 ? buffer.ToString() : null;
        }
        finally { _ = CloseHandle(handle); }
    }

    private static int QueryFullProcessImageName(IntPtr process, ref uint length, StringBuilder buffer) =>
        QueryFullProcessImageNameW(process, 0, buffer, ref length) ? 0 : Marshal.GetLastWin32Error();

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

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    private struct LastInputInfo { public uint Size; public uint Time; }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);
    [DllImport("user32.dll")] private static extern bool SwitchDesktop(IntPtr desktop);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern int GetPackageFullName(IntPtr process, ref uint length, StringBuilder buffer);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder buffer, ref uint length);
}
