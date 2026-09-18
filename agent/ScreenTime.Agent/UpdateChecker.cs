using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace ScreenTime.Agent;

internal sealed record UpdateManifest(string Version, string Url, string Sha256);

internal enum UpdateCheckStatus { UpdateAvailable, UpToDate, Unavailable }

internal sealed record UpdateCheckResult(UpdateCheckStatus Status, UpdateManifest? Manifest = null);

internal sealed class UpdateChecker : IDisposable
{
    public const string ManifestUrl =
        "https://github.com/shaihi/screen-time/releases/latest/download/manifest.json";

    private readonly HttpClient _http;
    private readonly bool _ownsHttpClient;

    public event Action<UpdateManifest>? UpdateAvailable;

    public UpdateChecker()
    {
        _http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        _ownsHttpClient = true;
    }

    internal UpdateChecker(HttpClient http)
    {
        _http = http;
    }

    public async Task<UpdateCheckResult> CheckAsync(
        Version currentVersion,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await _http.GetAsync(ManifestUrl, cancellationToken);
            response.EnsureSuccessStatusCode();
            var manifest = ParseManifest(await response.Content.ReadAsStringAsync(cancellationToken));
            if (manifest is null) return new(UpdateCheckStatus.Unavailable);
            if (!IsNewerVersion(manifest.Version, currentVersion))
                return new(UpdateCheckStatus.UpToDate, manifest);

            UpdateAvailable?.Invoke(manifest);
            return new(UpdateCheckStatus.UpdateAvailable, manifest);
        }
        catch
        {
            // Background update checks are deliberately silent. The tray maps this to a friendly
            // message only when the user explicitly asks for a check.
            return new(UpdateCheckStatus.Unavailable);
        }
    }

    public async Task StartInstallAsync(
        UpdateManifest manifest,
        AgentConfig config,
        CancellationToken cancellationToken = default)
    {
        var temporaryDirectory = Path.Combine(
            Path.GetTempPath(),
            $"ScreenTimeAgent-update-{Guid.NewGuid():N}");
        var zipPath = Path.Combine(temporaryDirectory, "update.zip");
        var extractPath = Path.Combine(temporaryDirectory, "package");
        Directory.CreateDirectory(temporaryDirectory);

        using (var response = await _http.GetAsync(
                   manifest.Url,
                   HttpCompletionOption.ResponseHeadersRead,
                   cancellationToken))
        {
            response.EnsureSuccessStatusCode();
            await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using var destination = new FileStream(
                zipPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                81920,
                FileOptions.Asynchronous);
            await source.CopyToAsync(destination, cancellationToken);
        }

        await using (var zip = File.OpenRead(zipPath))
        {
            var actualHash = Convert.ToHexString(
                await SHA256.HashDataAsync(zip, cancellationToken));
            if (!actualHash.Equals(manifest.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The downloaded update failed SHA-256 verification.");
        }

        ZipFile.ExtractToDirectory(zipPath, extractPath);
        var installer = Directory
            .EnumerateFiles(extractPath, "install-release.ps1", SearchOption.AllDirectories)
            .SingleOrDefault()
            ?? throw new InvalidDataException("The update package does not contain install-release.ps1.");
        var packageDirectory = Path.GetDirectoryName(installer)
            ?? throw new InvalidDataException("The update package directory is invalid.");
        if (!File.Exists(Path.Combine(packageDirectory, "ScreenTime.Agent.exe")))
            throw new InvalidDataException("The update package does not contain ScreenTime.Agent.exe.");

        var startInfo = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = packageDirectory,
        };
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-WindowStyle");
        startInfo.ArgumentList.Add("Hidden");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(installer);
        startInfo.ArgumentList.Add("-ApiUrl");
        startInfo.ArgumentList.Add(config.ApiUrl);
        startInfo.ArgumentList.Add("-IngestSecret");
        startInfo.ArgumentList.Add(config.IngestSecret);
        startInfo.ArgumentList.Add("-DeviceId");
        startInfo.ArgumentList.Add(config.DeviceId);

        using var installerProcess = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The update installer could not be started.");
    }

    internal static UpdateManifest? ParseManifest(string json)
    {
        try
        {
            var manifest = JsonSerializer.Deserialize<UpdateManifest>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
            if (manifest is null ||
                string.IsNullOrWhiteSpace(manifest.Version) ||
                string.IsNullOrWhiteSpace(manifest.Url) ||
                string.IsNullOrWhiteSpace(manifest.Sha256) ||
                !TryNormalizeVersion(manifest.Version, out _) ||
                !Uri.TryCreate(manifest.Url, UriKind.Absolute, out var uri) ||
                uri.Scheme != Uri.UriSchemeHttps)
                return null;

            var hash = manifest.Sha256.Trim();
            if (hash.Length != 64 || hash.Any(character => !Uri.IsHexDigit(character)))
                return null;
            return new(manifest.Version.Trim(), uri.AbsoluteUri, hash);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    internal static bool IsNewerVersion(string candidate, Version currentVersion) =>
        TryNormalizeVersion(candidate, out var candidateVersion) &&
        candidateVersion > NormalizeVersion(currentVersion);

    private static bool TryNormalizeVersion(string value, out Version normalized)
    {
        normalized = new Version(0, 0, 0, 0);
        if (string.IsNullOrWhiteSpace(value) ||
            !Version.TryParse(value.Trim(), out var parsed) ||
            parsed.Major < 0 ||
            parsed.Minor < 0)
            return false;
        normalized = NormalizeVersion(parsed);
        return true;
    }

    private static Version NormalizeVersion(Version version) => new(
        version.Major,
        version.Minor,
        Math.Max(0, version.Build),
        Math.Max(0, version.Revision));

    public void Dispose()
    {
        if (_ownsHttpClient) _http.Dispose();
    }
}
