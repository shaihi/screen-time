using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ScreenTime.Agent;

internal sealed class UploadQueue
{
    private readonly AgentConfig _config;
    private readonly string _queuePath;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly List<ActivitySample> _pending = new();
    private readonly SemaphoreSlim _gate = new(1, 1);

    public UploadQueue(AgentConfig config)
    {
        _config = config;
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenTimeAgent");
        Directory.CreateDirectory(directory);
        _queuePath = Path.Combine(directory, "pending.json");
        LoadPending();
    }

    private const int MaxBatchSize = 500;
    private readonly object _pendingLock = new();

    public void Enqueue(IEnumerable<ActivitySample> samples)
    {
        lock (_pendingLock)
        {
            _pending.AddRange(samples);
            SavePending();
        }
    }

    /// <summary>Uploads batches until the queue is empty. Returns the number of records sent.</summary>
    public async Task<int> SendAllAsync(CancellationToken cancellationToken = default)
    {
        var total = 0;
        while (true)
        {
            var sent = await SendAsync(cancellationToken);
            total += sent;
            if (sent < MaxBatchSize) return total;
        }
    }

    private async Task<int> SendAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            ActivitySample[] toSend;
            lock (_pendingLock) toSend = _pending.Take(MaxBatchSize).ToArray();
            if (toSend.Length == 0) return 0;
            var body = JsonSerializer.Serialize(new UploadBatch(Guid.NewGuid(), _config.DeviceId, toSend), JsonOptions.Default);
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            var signature = Convert.ToHexString(HMACSHA256.HashData(
                Encoding.UTF8.GetBytes(_config.IngestSecret), Encoding.UTF8.GetBytes($"{timestamp}.{body}"))).ToLowerInvariant();

            using var request = new HttpRequestMessage(HttpMethod.Post, _config.ApiUrl);
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            request.Headers.Add("x-screen-time-timestamp", timestamp);
            request.Headers.Add("x-screen-time-signature", signature);
            request.Headers.UserAgent.Add(new ProductInfoHeaderValue("ScreenTime-Agent", "1.5"));
            using var response = await _http.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();

            lock (_pendingLock)
            {
                _pending.RemoveRange(0, toSend.Length);
                SavePending();
            }
            return toSend.Length;
        }
        finally { _gate.Release(); }
    }

    private void LoadPending()
    {
        try
        {
            if (File.Exists(_queuePath))
                _pending.AddRange(JsonSerializer.Deserialize<List<ActivitySample>>(File.ReadAllText(_queuePath), JsonOptions.Default) ?? []);
        }
        catch { }
    }

    private void SavePending()
    {
        var temporary = _queuePath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(_pending, JsonOptions.Default));
        File.Move(temporary, _queuePath, true);
    }
}
