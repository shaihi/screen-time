using System.Text.Json;

namespace ScreenTime.Agent;

internal sealed record AgentConfig(
    string ApiUrl,
    string IngestSecret,
    string DeviceId,
    int IdleThresholdSeconds = 120,
    int SampleIntervalSeconds = 2,
    int UploadIntervalMinutes = 1)
{
    public static AgentConfig Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        if (!File.Exists(path)) throw new InvalidOperationException($"Configuration is missing: {path}");
        var config = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(path), JsonOptions.Default)
            ?? throw new InvalidOperationException("Configuration is invalid.");
        if (!Uri.TryCreate(config.ApiUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("ApiUrl must be an HTTPS URL.");
        if (config.IngestSecret.Length < 32) throw new InvalidOperationException("IngestSecret must contain at least 32 characters.");
        if (config.DeviceId.Length is < 1 or > 64 || config.DeviceId.Any(c => !(char.IsLetterOrDigit(c) || c is '.' or '_' or '-')))
            throw new InvalidOperationException("DeviceId may only contain letters, numbers, dots, underscores, and hyphens.");
        if (config.SampleIntervalSeconds is < 2 or > 30) throw new InvalidOperationException("SampleIntervalSeconds must be between 2 and 30.");
        if (config.UploadIntervalMinutes is < 1 or > 60) throw new InvalidOperationException("UploadIntervalMinutes must be between 1 and 60.");
        return config;
    }
}

internal static class JsonOptions
{
    public static readonly JsonSerializerOptions Default = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };
}
