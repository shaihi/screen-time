namespace ScreenTime.Agent;

/// <summary>Pure naming rules, kept free of Windows APIs so they can be unit-tested anywhere.</summary>
internal static class AppNames
{
    public const int MaxLength = 120;

    // Shell and host processes that own a foreground window without being something the user chose to run.
    private static readonly HashSet<string> SystemProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "ApplicationFrameHost", "explorer", "SearchHost", "SearchApp", "SearchUI", "StartMenuExperienceHost",
        "ShellExperienceHost", "ShellHost", "PickerHost", "LockApp", "LogonUI", "TextInputHost", "dwm",
        "gamingservicesui", "GameBar", "GameBarFTServer", "RuntimeBroker", "sihost", "ctfmon", "consent",
        "CredentialUIBroker", "UserOOBEBroker", "Widgets", "WidgetBoard", "ScreenClippingHost",
        "NotificationCenter", "ScreenTime.Agent", "Idle", "System",
    };

    private static readonly (string Needle, string Name)[] KnownApps =
    [
        ("roblox", "Roblox"),
        ("minecraft", "Minecraft"),
        ("fortnite", "Fortnite"),
        ("codex", "Codex"),
        ("chatgpt", "ChatGPT"),
        ("chrome", "Google Chrome"),
        ("msedge", "Microsoft Edge"),
        ("firefox", "Firefox"),
        ("netflix", "Netflix"),
        ("disneyplus", "Disney+"),
        ("youtube", "YouTube"),
        ("vlc", "VLC"),
        ("spotify", "Spotify"),
        ("discord", "Discord"),
        ("whatsapp", "WhatsApp"),
        ("tiktok", "TikTok"),
        ("steam", "Steam"),
        ("visualstudiocode", "Visual Studio Code"),
    ];

    public static bool IsSystemProcess(string processName) => SystemProcesses.Contains(processName);

    /// <summary>Returns a curated name when any identifier (process, package, AUMID) matches a known app.</summary>
    public static string? Known(string? identifier)
    {
        if (string.IsNullOrWhiteSpace(identifier)) return null;
        var value = identifier.ToLowerInvariant();
        if (value is "code" or "code.exe") return "Visual Studio Code";
        foreach (var (needle, name) in KnownApps)
            if (value.Contains(needle)) return name;
        return null;
    }

    /// <summary>Turns an AppUserModelId such as "Contoso.Player_8wekyb3d8bbwe!App" into "Player".</summary>
    public static string FromAppUserModelId(string aumid)
    {
        if (aumid.Contains('\\')) return Clean(Path.GetFileNameWithoutExtension(aumid.Replace('\\', '/'))) ?? aumid;
        var family = aumid.Split('!')[0];
        var name = family.Split('_')[0];
        var lastDot = name.LastIndexOf('.');
        if (lastDot >= 0 && lastDot < name.Length - 1) name = name[(lastDot + 1)..];
        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        return Clean(name) ?? aumid;
    }

    public static string? Clean(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var trimmed = name.Trim();
        if (trimmed.StartsWith("ms-resource:", StringComparison.OrdinalIgnoreCase)) return null;
        return trimmed.Length > MaxLength ? trimmed[..MaxLength] : trimmed;
    }
}
