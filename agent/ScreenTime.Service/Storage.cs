using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using ScreenTime.Control;

namespace ScreenTime.Service;

internal sealed record ServiceConfig
{
    public string ApiBaseUrl { get; init; } = "";
    public string DeviceId { get; init; } = "";
    public string HouseholdId { get; init; } = "";
    public string WindowsSid { get; init; } = "";
    public string ParentSid { get; init; } = "";
    public string Credential { get; init; } = "";
    public string PolicyPublicKeyPem { get; init; } = "";
    public string RestrictionGroupSid { get; init; } = "";
    public void Validate(bool recovery = false)
    {
        if (!PolicyValidation.IsChildSid(WindowsSid) || !PolicyValidation.IsChildSid(ParentSid) || WindowsSid == ParentSid || !PolicyValidation.IsChildSid(RestrictionGroupSid))
            throw new InvalidDataException("Invalid child, parent, or restriction-group SID");
        _ = new SecurityIdentifier(WindowsSid);
        _ = new SecurityIdentifier(ParentSid);
        _ = new SecurityIdentifier(RestrictionGroupSid);
        if (!recovery && (!Uri.TryCreate(ApiBaseUrl, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) || Convert.FromBase64String(Credential).Length != 32 || string.IsNullOrEmpty(PolicyPublicKeyPem)))
            throw new InvalidDataException("Invalid HTTPS enrollment configuration");
    }
}
internal sealed class DurableState
{
    public PolicyCache Policies { get; set; } = new();
    public UsageLedger Ledger { get; set; } = new();
    public SignedEnvelope? AcceptedEnvelope
    {
        get; set;
    }
    public SignedEnvelope? CurrentEnvelope
    {
        get; set;
    }
    public DateTimeOffset TrustedUtc
    {
        get; set;
    }
    public DateTimeOffset WallUtc
    {
        get; set;
    }
    public bool RestrictionDesired
    {
        get; set;
    }
    public long AppliedRevision
    {
        get; set;
    }
}
internal static class Storage
{
    public static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ScreenTime", "Control");
    public static string PathFor(string name) => Path.Combine(Root, name);
    public static T Read<T>(string name) => JsonSerializer.Deserialize<T>(File.ReadAllText(PathFor(name)), ControlJson.Options) ?? throw new InvalidDataException($"Empty {name}");
    public static void Save<T>(string name, T data)
    {
        var path = PathFor(name);
        var temp = path + ".tmp";
        var bytes = JsonSerializer.SerializeToUtf8Bytes(data, ControlJson.Options);
        using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        {
            stream.Write(bytes);
            stream.Flush(true);
        }
        File.Move(temp, path, true);
    }
    // Never trust a child-writable root, reparse point, or inherited permissive ACL.
    public static void VerifyProtectedRoot()
    {
        var current = new DirectoryInfo(Root);
        if (!current.Exists)
            throw new InvalidDataException("Protected installer state is missing");
        for (var d = current; d is not null; d = d.Parent)
            if (d.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidDataException("Reparse points are forbidden in state path");
        foreach (var target in new[] { Root, PathFor("service.json"), PathFor("policy.json"), PathFor("state.json"), PathFor("restriction-group.json") })
        {
            if (!File.Exists(target) && target != Root)
                continue;
            if (target != Root && new FileInfo(target).Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidDataException("State file is a reparse point");
            FileSystemSecurity acl = target == Root ? new DirectoryInfo(target).GetAccessControl() : new FileInfo(target).GetAccessControl();
            foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            {
                if (rule.AccessControlType != AccessControlType.Allow)
                    continue;
                var sid = (SecurityIdentifier)rule.IdentityReference;
                var write = FileSystemRights.Write | FileSystemRights.Modify | FileSystemRights.Delete | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
                if ((rule.FileSystemRights & write) != 0 && !sid.IsWellKnown(WellKnownSidType.LocalSystemSid) && !sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid))
                    throw new InvalidDataException("State is writable outside SYSTEM/Administrators");
            }
        }
    }
    public static void Log(string message)
    {
        try
        {
            var path = PathFor("service.log");
            if (File.Exists(path) && new FileInfo(path).Length > 1024 * 1024)
                File.Move(path, path + ".old", true);
            File.AppendAllText(path, $"{DateTimeOffset.UtcNow:O} {message.Replace('\r', ' ').Replace('\n', ' ')}\n");
        }
        catch { /* Never expose credentials through a fallback console. */ }
    }
}
