using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace ScreenTime.Service;

internal sealed class WindowsRestriction(ServiceConfig config)
{
    internal const string GroupName = "ScreenTimeRestricted";
    private static readonly string[] DenyRights = ["SeDenyInteractiveLogonRight", "SeDenyRemoteInteractiveLogonRight"];
    private static SecurityIdentifier GroupSid() => (SecurityIdentifier)new NTAccount(Environment.MachineName, GroupName).Translate(typeof(SecurityIdentifier));
    public void VerifyIdentity()
    {
        config.Validate(recovery: true);
        if (GroupSid().Value != config.RestrictionGroupSid)
            throw new InvalidDataException("Restriction group SID differs from protected enrollment; no changes made");
        if (!File.Exists(Storage.PathFor("restriction-group.json")) || Storage.Read<GroupReceipt>("restriction-group.json").RestrictionGroupSid != config.RestrictionGroupSid)
            throw new InvalidDataException("Restriction group ownership receipt does not match enrollment");
        var members = Members();
        if (members.Any(s => s != config.WindowsSid))
            throw new InvalidDataException("Restriction group has unexpected members; refusing changes");
    }
    public static string Prepare()
    {
        var receipt = Storage.PathFor("restriction-group.json");
        string? existing = null;
        try
        {
            existing = GroupSid().Value;
        }
        catch (IdentityNotMappedException) { }
        if (existing is not null)
        {
            if (!File.Exists(receipt) || Storage.Read<GroupReceipt>("restriction-group.json").RestrictionGroupSid != existing)
                throw new InvalidDataException("ScreenTimeRestricted already exists without matching protected ownership receipt");
        }
        else
        {
            var info = new GroupInfo { Name = GroupName, Comment = "ScreenTime owned restriction group; do not add other users" };
            Check(NetLocalGroupAdd(null, 1, ref info, out _));
            existing = GroupSid().Value;
            Storage.Save("restriction-group.json", new GroupReceipt(existing));
        }
        IntPtr resume = IntPtr.Zero;
        Check(NetLocalGroupGetMembers(null, GroupName, 0, out var memberBuffer, -1, out var memberCount, out _, ref resume));
        NetApiBufferFree(memberBuffer);
        if (memberCount != 0)
            throw new InvalidDataException("Prepared restriction group must be empty before assigning deny-logon rights");
        AssignRights(existing);
        return existing;
    }
    public bool IsChildAdministrator()
    {
        var account = (NTAccount)new SecurityIdentifier(config.WindowsSid).Translate(typeof(NTAccount));
        var name = account.Value.Split('\\').Last();
        var result = NetUserGetLocalGroups(null, name, 0, 1, out var buffer, -1, out var entries, out _);
        Check(result);
        try
        {
            for (var i = 0; i < entries; i++)
            {
                var group = Marshal.PtrToStringUni(Marshal.ReadIntPtr(buffer, i * IntPtr.Size))!;
                var sid = (SecurityIdentifier)new NTAccount(Environment.MachineName, group).Translate(typeof(SecurityIdentifier));
                if (sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid))
                    return true;
            }
        }
        finally { NetApiBufferFree(buffer); }
        // Existing logon tokens can retain Administrator membership after account type changes.
        foreach (var session in WindowsSessions.ForChild(config.WindowsSid))
        {
            if (!WindowsSessions.WTSQueryUserToken(session.Id, out var token))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                using var identity = new WindowsIdentity(token);
                if (identity.Groups?.Contains(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)) == true)
                    return true;
            }
            finally { WindowsSessions.CloseHandle(token); }
        }
        return false;
    }
    private HashSet<string> Members()
    {
        IntPtr resume = IntPtr.Zero;
        Check(NetLocalGroupGetMembers(null, GroupName, 0, out var buffer, -1, out var count, out _, ref resume));
        try
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < count; i++)
                result.Add(new SecurityIdentifier(Marshal.ReadIntPtr(buffer, i * IntPtr.Size)).Value);
            return result;
        }
        finally { NetApiBufferFree(buffer); }
    }
    public void SetBlocked(bool blocked)
    {
        config.Validate(recovery: true);
        if (!blocked && AlreadyRemoved())
            return;
        VerifyIdentity();
        if (blocked)
        {
            if (IsChildAdministrator())
                throw new InvalidDataException("Managed controls require a standard child account and fresh standard-user sign-in");
            VerifyRights(config.RestrictionGroupSid);
        }
        var member = Members().Contains(config.WindowsSid);
        if (member != blocked)
        {
            var sid = new SecurityIdentifier(config.WindowsSid);
            var bytes = new byte[sid.BinaryLength];
            sid.GetBinaryForm(bytes, 0);
            var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            try
            {
                var info = new MemberInfo { Sid = pin.AddrOfPinnedObject() };
                Check(blocked ? NetLocalGroupAddMembers(null, GroupName, 0, ref info, 1) : NetLocalGroupDelMembers(null, GroupName, 0, ref info, 1));
            }
            finally { pin.Free(); }
        }
        if (Members().Contains(config.WindowsSid) != blocked)
            throw new InvalidDataException("Restriction membership verification failed");
        if (blocked)
        {
            foreach (var session in WindowsSessions.ForChild(config.WindowsSid))
                if (!WindowsSessions.WTSLogoffSession(IntPtr.Zero, session.Id, false))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Child session sign-out failed");
            if (WindowsSessions.ForChild(config.WindowsSid).Count != 0)
                throw new InvalidDataException("A child session remains; cutoff is not verified");
            VerifyRights(config.RestrictionGroupSid);
        }
    }
    public void RemoveOwnedGroup()
    {
        if (AlreadyRemoved())
            return;
        VerifyIdentity();
        if (Members().Count != 0)
            throw new InvalidDataException("Restore child access before removing restriction group");
        RemoveGroupRights(config.RestrictionGroupSid);
        Check(NetLocalGroupDel(null, GroupName));
        File.Delete(Storage.PathFor("restriction-group.json"));
    }
    private bool AlreadyRemoved()
    {
        // An interrupted uninstall may have removed the exact owned group and receipt already.
        // Never accept a replacement with the same name, even when the receipt is gone.
        if (File.Exists(Storage.PathFor("restriction-group.json")))
            return false;
        try
        {
            _ = GroupSid();
            return false;
        }
        catch (IdentityNotMappedException)
        {
            return true;
        }
    }
    public static void RemovePreparedGroup()
    {
        var saved = Storage.Read<GroupReceipt>("restriction-group.json").RestrictionGroupSid;
        if (GroupSid().Value != saved)
            throw new InvalidDataException("Prepared group does not match owned SID receipt");
        IntPtr resume = IntPtr.Zero;
        Check(NetLocalGroupGetMembers(null, GroupName, 0, out var buffer, -1, out var count, out _, ref resume));
        NetApiBufferFree(buffer);
        if (count != 0)
            throw new InvalidDataException("Prepared restriction group has members; enrollment config required for recovery");
        RemoveGroupRights(saved);
        Check(NetLocalGroupDel(null, GroupName));
        File.Delete(Storage.PathFor("restriction-group.json"));
    }
    private static void RemoveGroupRights(string sid) => WithLsa(sid, (handle, ptr) =>
    {
        var rights = Strings(DenyRights);
        try
        {
            CheckLsa(LsaRemoveAccountRights(handle, ptr, false, rights, rights.Length));
        }
        finally { foreach (var right in rights) Marshal.FreeHGlobal(right.Buffer); }
    });
    private static void AssignRights(string sid) => WithLsa(sid, (handle, ptr) =>
    {
        var allocated = Strings(DenyRights);
        try
        {
            CheckLsa(LsaAddAccountRights(handle, ptr, allocated, allocated.Length));
        }
        finally { foreach (var s in allocated) Marshal.FreeHGlobal(s.Buffer); }
        VerifyRights(sid);
    });
    private static void VerifyRights(string sid) => WithLsa(sid, (handle, ptr) =>
    {
        CheckLsa(LsaEnumerateAccountRights(handle, ptr, out var buffer, out var count));
        try
        {
            var rights = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < count; i++)
            {
                var entry = Marshal.PtrToStructure<LsaString>(buffer + i * Marshal.SizeOf<LsaString>());
                rights.Add(Marshal.PtrToStringUni(entry.Buffer, entry.Length / 2)!);
            }
            if (!DenyRights.All(rights.Contains) || rights.Any(r => !DenyRights.Contains(r)))
                throw new InvalidDataException("Unexpected restriction-group account rights");
        }
        finally { LsaFreeMemory(buffer); }
    });
    private static LsaString[] Strings(string[] rights) => rights.Select(s => new LsaString { Buffer = Marshal.StringToHGlobalUni(s), Length = checked((ushort)(s.Length * 2)), MaximumLength = checked((ushort)((s.Length + 1) * 2)) }).ToArray();
    private static void WithLsa(string sid, Action<IntPtr, IntPtr> action)
    {
        var attrs = new LsaAttributes { Length = Marshal.SizeOf<LsaAttributes>() };
        CheckLsa(LsaOpenPolicy(IntPtr.Zero, ref attrs, 0x00000800 | 0x00000010, out var handle));
        var id = new SecurityIdentifier(sid);
        var bytes = new byte[id.BinaryLength];
        id.GetBinaryForm(bytes, 0);
        var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try
        {
            action(handle, pin.AddrOfPinnedObject());
        }
        finally { pin.Free(); LsaClose(handle); }
    }
    private static void Check(int code)
    {
        if (code != 0)
            throw new Win32Exception(code);
    }
    private static void CheckLsa(uint status)
    {
        if (status != 0)
            throw new Win32Exception((int)LsaNtStatusToWinError(status));
    }
    private sealed record GroupReceipt(string RestrictionGroupSid);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct GroupInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string Name; [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MemberInfo
    {
        public IntPtr Sid;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct LsaString
    {
        public ushort Length; public ushort MaximumLength; public IntPtr Buffer;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct LsaAttributes
    {
        public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService;
    }
    [DllImport("netapi32", CharSet = CharSet.Unicode)] private static extern int NetLocalGroupAdd(string? server, int level, ref GroupInfo info, out int error);
    [DllImport("netapi32", CharSet = CharSet.Unicode)] private static extern int NetLocalGroupDel(string? server, string name);
    [DllImport("netapi32", CharSet = CharSet.Unicode)] private static extern int NetLocalGroupGetMembers(string? server, string group, int level, out IntPtr buffer, int preferred, out int read, out int total, ref IntPtr resume);
    [DllImport("netapi32", CharSet = CharSet.Unicode)] private static extern int NetLocalGroupAddMembers(string? server, string group, int level, ref MemberInfo info, int count);
    [DllImport("netapi32", CharSet = CharSet.Unicode)] private static extern int NetLocalGroupDelMembers(string? server, string group, int level, ref MemberInfo info, int count);
    [DllImport("netapi32", CharSet = CharSet.Unicode)] private static extern int NetUserGetLocalGroups(string? server, string user, int level, int flags, out IntPtr buffer, int preferred, out int read, out int total);
    [DllImport("netapi32")] private static extern int NetApiBufferFree(IntPtr buffer);
    [DllImport("advapi32")] private static extern uint LsaOpenPolicy(IntPtr system, ref LsaAttributes attrs, uint access, out IntPtr handle);
    [DllImport("advapi32")] private static extern uint LsaAddAccountRights(IntPtr handle, IntPtr sid, [In] LsaString[] rights, int count);
    [DllImport("advapi32")] private static extern uint LsaRemoveAccountRights(IntPtr handle, IntPtr sid, [MarshalAs(UnmanagedType.U1)] bool all, [In] LsaString[] rights, int count);
    [DllImport("advapi32")] private static extern uint LsaEnumerateAccountRights(IntPtr handle, IntPtr sid, out IntPtr rights, out int count);
    [DllImport("advapi32")] private static extern uint LsaFreeMemory(IntPtr buffer);
    [DllImport("advapi32")] private static extern uint LsaClose(IntPtr handle);
    [DllImport("advapi32")] private static extern uint LsaNtStatusToWinError(uint status);
}
