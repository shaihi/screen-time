using System.Text.RegularExpressions;

namespace ScreenTime.Agent;

internal static class PageTitles
{
    public const int MaxLength = 300;

    private static readonly HashSet<string> Browsers = new(StringComparer.OrdinalIgnoreCase)
    {
        "Google Chrome",
        "Microsoft Edge",
        "Mozilla Firefox",
        "Firefox",
        "Brave",
        "Opera",
    };

    private static readonly HashSet<string> BlankTitles = new(Browsers, StringComparer.OrdinalIgnoreCase)
    {
        "New Tab",
        "New Private Tab",
        "Start",
        "Untitled",
    };

    private static readonly Regex BrowserSuffix = new(
        @"\s[-–—]\s(?<browser>Google Chrome|Microsoft Edge|Mozilla Firefox|Firefox|Brave|Opera)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex EdgeProfileSuffix = new(
        @"\s[-–—]\s(?:Personal|Work|Profile \d+)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex EdgeTabCountSuffix = new(
        @"\s+and \d+ more pages?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static bool IsBrowser(string? appName) =>
        appName is not null && Browsers.Contains(appName);

    public static string? Clean(string? windowTitle)
    {
        if (string.IsNullOrWhiteSpace(windowTitle)) return null;

        var title = new string(windowTitle
            .Where(character => !char.IsControl(character) && character != '\u200B')
            .ToArray()).Trim();
        if (title.Length == 0) return null;

        var browserMatch = BrowserSuffix.Match(title);
        var isEdge = browserMatch.Success &&
            browserMatch.Groups["browser"].Value.Equals("Microsoft Edge", StringComparison.OrdinalIgnoreCase);
        if (browserMatch.Success) title = title[..browserMatch.Index].Trim();

        if (isEdge)
        {
            title = EdgeProfileSuffix.Replace(title, string.Empty).Trim();
            title = EdgeTabCountSuffix.Replace(title, string.Empty).Trim();
        }

        if (title.Length == 0 || BlankTitles.Contains(title)) return null;
        return title[..Math.Min(MaxLength, title.Length)];
    }
}
