using Microsoft.Win32;

namespace ScreenTime.Agent;

internal sealed class MonitorContext : ApplicationContext
{
    private readonly AgentConfig _config;
    private readonly WindowsActivity _activity = new();
    private readonly MinuteAggregator _aggregator = new();
    private readonly UploadQueue _uploads;
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _sampleTimer;
    private readonly System.Windows.Forms.Timer _uploadTimer;
    private static readonly TimeSpan ShutdownUploadTimeout = TimeSpan.FromSeconds(4);
    private readonly object _aggregatorLock = new();
    private bool _sampling;
    private volatile bool _stopping;
    private DateTimeOffset? _pausedUntil;

    public MonitorContext(AgentConfig config)
    {
        _config = config;
        _uploads = new UploadQueue(config);
        var menu = new ContextMenuStrip();
        menu.Items.Add("Send now", null, async (_, _) => await SendNowAsync());
        menu.Items.Add("Pause for 30 minutes", null, (_, _) => Pause(TimeSpan.FromMinutes(30)));
        menu.Items.Add("Resume", null, (_, _) => { _pausedUntil = null; UpdateTooltip("Monitoring"); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());

        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Information,
            Text = "Screen Time — Monitoring",
            ContextMenuStrip = menu,
            Visible = true,
        };

        _sampleTimer = new System.Windows.Forms.Timer { Interval = config.SampleIntervalSeconds * 1000 };
        _sampleTimer.Tick += async (_, _) => await SampleAsync();
        _uploadTimer = new System.Windows.Forms.Timer { Interval = config.UploadIntervalMinutes * 60 * 1000 };
        _uploadTimer.Tick += async (_, _) => await SendNowAsync();
        _sampleTimer.Start();
        _uploadTimer.Start();
        SystemEvents.SessionEnding += OnSessionEnding;
        _ = SampleAsync();
    }

    private async Task SampleAsync()
    {
        if (_sampling || _stopping) return;
        if (_pausedUntil is not null && _pausedUntil > DateTimeOffset.Now) return;
        if (_pausedUntil is not null) { _pausedUntil = null; UpdateTooltip("Monitoring"); }
        _sampling = true;
        try
        {
            var classification = await _activity.ClassifyAsync(
                _config.IdleThresholdSeconds,
                _config.CollectPageTitles);
            if (_stopping) return;
            IReadOnlyList<ActivitySample> completed;
            lock (_aggregatorLock) completed = _aggregator.Observe(DateTimeOffset.UtcNow, classification, _config.SampleIntervalSeconds);
            if (completed.Count > 0) _uploads.Enqueue(completed);
            UpdateTooltip(classification.State.ToString());
        }
        catch { UpdateTooltip("Temporary sensor error"); }
        finally { _sampling = false; }
    }

    private async Task SendNowAsync()
    {
        try
        {
            IReadOnlyList<ActivitySample> inProgress;
            lock (_aggregatorLock) inProgress = _aggregator.Snapshot();
            if (inProgress.Count > 0) _uploads.Enqueue(inProgress);
            var sent = await _uploads.SendAllAsync();
            UpdateTooltip(sent > 0 ? $"Sent {sent} minute records" : "Up to date");
        }
        catch { UpdateTooltip("Offline — data queued"); }
    }

    // Windows is signing out or shutting down: persist the unfinished minute and try one quick upload.
    // Sampling keeps going in case the shutdown is cancelled.
    private void OnSessionEnding(object? sender, SessionEndingEventArgs e) => FlushAndUpload();

    private void FlushAndUpload()
    {
        try
        {
            IReadOnlyList<ActivitySample> remaining;
            lock (_aggregatorLock) remaining = _aggregator.Flush();
            if (remaining.Count > 0) _uploads.Enqueue(remaining);
            using var timeout = new CancellationTokenSource(ShutdownUploadTimeout);
            Task.Run(() => _uploads.SendAllAsync(timeout.Token)).Wait(ShutdownUploadTimeout);
        }
        catch { /* Unsent records stay in pending.json and upload on the next start. */ }
    }

    private void Pause(TimeSpan duration)
    {
        _pausedUntil = DateTimeOffset.Now.Add(duration);
        UpdateTooltip("Paused for 30 minutes");
    }

    private void UpdateTooltip(string status)
    {
        var text = $"Screen Time — {status}";
        _tray.Text = text[..Math.Min(63, text.Length)];
    }

    protected override void ExitThreadCore()
    {
        _sampleTimer.Stop();
        _uploadTimer.Stop();
        SystemEvents.SessionEnding -= OnSessionEnding;
        _stopping = true;
        FlushAndUpload();
        _tray.Visible = false;
        _tray.Dispose();
        base.ExitThreadCore();
    }
}
