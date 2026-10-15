using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace ScreenTime.Service;

internal sealed record ChildSession(int Id, bool Unlocked);
internal static class WindowsSessions
{
    public static readonly string TrayPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "ScreenTime", "Tray", "ScreenTime.Agent.exe");
    public static List<ChildSession> ForChild(string sid)
    {
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out var buffer, out var count))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var result = new List<ChildSession>();
            for (var i = 0; i < count; i++)
            {
                var session = Marshal.PtrToStructure<WtsSession>(buffer + i * Marshal.SizeOf<WtsSession>());
                if (session.Id == 0)
                    continue;
                var name = QueryText(session.Id, 5);
                if (string.IsNullOrWhiteSpace(name))
                    continue;
                string accountSid;
                if (WTSQueryUserToken(session.Id, out var token))
                {
                    try
                    {
                        using var identity = new WindowsIdentity(token);
                        accountSid = identity.User?.Value ?? throw new InvalidDataException("Session token has no SID");
                    }
                    finally { CloseHandle(token); }
                }
                else
                {
                    // Disconnected sessions may have no queryable token, but must still be signed out.
                    var domain = QueryText(session.Id, 7);
                    accountSid = ((SecurityIdentifier)new NTAccount(domain, name).Translate(typeof(SecurityIdentifier))).Value;
                }
                if (accountSid != sid)
                    continue;
                var unlocked = session.State == 0;
                if (unlocked && WTSQuerySessionInformation(IntPtr.Zero, session.Id, 25, out var info, out var bytes))
                {
                    try
                    {
                        // WTSINFOEX level 1: DWORD Level, 8-byte aligned union; session flags at union+8.
                        // On supported Windows 11, 0=locked, 1=unlocked. Unknown => conservative unlocked.
                        if (bytes >= 20 && Marshal.ReadInt32(info) == 1 && Marshal.ReadInt32(info, 16) == 0)
                            unlocked = false;
                    }
                    finally { WTSFreeMemory(info); }
                }
                result.Add(new(session.Id, unlocked));
            }
            return result;
        }
        finally { WTSFreeMemory(buffer); }
    }
    private static string QueryText(int id, int kind)
    {
        if (!WTSQuerySessionInformation(IntPtr.Zero, id, kind, out var buffer, out _))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            return Marshal.PtrToStringUni(buffer) ?? "";
        }
        finally { WTSFreeMemory(buffer); }
    }
    public static void LaunchSensor(int sessionId)
    {
        if (!File.Exists(TrayPath))
            throw new FileNotFoundException("Protected tray sensor is missing", TrayPath);
        // The installer owns the complete directory. Do not follow links or launch a child-selected path.
        for (var d = new DirectoryInfo(Path.GetDirectoryName(TrayPath)!); d is not null; d = d.Parent)
            if (d.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidDataException("Sensor path contains a reparse point");
        if (new FileInfo(TrayPath).Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("Sensor executable is a reparse point");
        if (!WTSQueryUserToken(sessionId, out var token))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr env = IntPtr.Zero;
        try
        {
            if (!CreateEnvironmentBlock(out env, token, false))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var start = new StartupInfo { Cb = Marshal.SizeOf<StartupInfo>(), Desktop = "winsta0\\default" };
            // lpApplicationName is fixed; no shell, environment-expanded path, downloaded binary, or policy argument.
            var command = new StringBuilder($"\"{TrayPath}\" --managed");
            if (!CreateProcessAsUser(token, TrayPath, command, IntPtr.Zero, IntPtr.Zero, false, 0x00000400 | 0x00000200, env, Path.GetDirectoryName(TrayPath)!, ref start, out var process))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            CloseHandle(process.Thread);
            CloseHandle(process.Process);
        }
        finally { if (env != IntPtr.Zero) DestroyEnvironmentBlock(env); CloseHandle(token); }
    }
    public static bool IsTrustedClient(uint processId, int sessionId)
    {
        using var p = Process.GetProcessById(checked((int)processId));
        return p.SessionId == sessionId && string.Equals(p.MainModule?.FileName, TrayPath, StringComparison.OrdinalIgnoreCase);
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct WtsSession
    {
        public int Id; public IntPtr StationName; public int State;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Cb; public string? Reserved; public string? Desktop; public string? Title; public int X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags; public short ShowWindow, Reserved2Count; public IntPtr Reserved2, StdInput, StdOutput, StdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo
    {
        public IntPtr Process, Thread; public int ProcessId, ThreadId;
    }
    [DllImport("wtsapi32", SetLastError = true)] private static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr info, out int count);
    [DllImport("wtsapi32", EntryPoint = "WTSQuerySessionInformationW", SetLastError = true)] private static extern bool WTSQuerySessionInformation(IntPtr server, int id, int kind, out IntPtr buffer, out int count);
    [DllImport("wtsapi32")] private static extern void WTSFreeMemory(IntPtr memory);
    [DllImport("wtsapi32", SetLastError = true)] public static extern bool WTSQueryUserToken(int session, out IntPtr token);
    [DllImport("wtsapi32", SetLastError = true)] public static extern bool WTSLogoffSession(IntPtr server, int id, bool wait);
    [DllImport("kernel32", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("userenv", SetLastError = true)] private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);
    [DllImport("userenv")] private static extern bool DestroyEnvironmentBlock(IntPtr environment);
    [DllImport("advapi32", EntryPoint = "CreateProcessAsUserW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcessAsUser(IntPtr token, string app, StringBuilder command, IntPtr processAttrs, IntPtr threadAttrs, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo start, out ProcessInfo process);
}
