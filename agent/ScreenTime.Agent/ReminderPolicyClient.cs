using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ScreenTime.Agent;

internal sealed class ReminderPolicyClient
{
    private readonly AgentConfig _config;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };

    public ReminderPolicyClient(AgentConfig config) => _config = config;

    public async Task<UsageReminderPolicy?> FetchAsync(CancellationToken cancellationToken = default)
    {
        var ingestUri = new Uri(_config.ApiUrl);
        var policyUri = new UriBuilder(ingestUri) { Path = "/api/agent/reminder-policy", Query = "" }.Uri;
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var signature = Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(_config.IngestSecret), Encoding.UTF8.GetBytes($"{timestamp}."))).ToLowerInvariant();

        using var request = new HttpRequestMessage(HttpMethod.Get, policyUri);
        request.Headers.Add("x-screen-time-timestamp", timestamp);
        request.Headers.Add("x-screen-time-signature", signature);
        request.Headers.Add("x-screen-time-device-id", _config.DeviceId);
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("ScreenTime-Agent", "1.5"));
        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) return null;

        var payload = await response.Content.ReadAsStringAsync(cancellationToken);
        var document = JsonSerializer.Deserialize<ReminderPolicyDocument>(payload, JsonOptions.Default);
        if (document?.Milestones is null) return UsageReminderPolicy.Disabled;
        var milestones = new List<UsageReminderMilestone>();
        foreach (var item in document.Milestones)
        {
            var severity = item.Color?.ToLowerInvariant() switch
            {
                "blue" => ReminderSeverity.Information,
                "yellow" => ReminderSeverity.Warning,
                "red" => ReminderSeverity.Error,
                _ => (ReminderSeverity?)null,
            };
            if (severity is not null) milestones.Add(new UsageReminderMilestone(item.Minutes, severity.Value));
        }
        return new UsageReminderPolicy(milestones);
    }

    private sealed record ReminderPolicyDocument(List<ReminderPolicyItem>? Milestones);
    private sealed record ReminderPolicyItem(int Minutes, string? Color);
}
