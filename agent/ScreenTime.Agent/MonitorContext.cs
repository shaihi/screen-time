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
    private bool _sampling;
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
        _ = SampleAsync();
    }

    private async Task SampleAsync()
    {
        if (_sampling) return;
        if (_pausedUntil is not null && _pausedUntil > DateTimeOffset.Now) return;
        if (_pausedUntil is not null) { _pausedUntil = null; UpdateTooltip("Monitoring"); }
        _sampling = true;
        try
        {
            var classification = await _activity.ClassifyAsync(_config.IdleThresholdSeconds);
            var completed = _aggregator.Observe(DateTimeOffset.UtcNow, classification, _config.SampleIntervalSeconds);
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
            var sent = await _uploads.SendAsync();
            UpdateTooltip(sent > 0 ? $"Sent {sent} minute records" : "Up to date");
        }
        catch { UpdateTooltip("Offline — data queued"); }
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
        _uploads.Enqueue(_aggregator.Flush());
        _tray.Visible = false;
        _tray.Dispose();
        base.ExitThreadCore();
    }
}
