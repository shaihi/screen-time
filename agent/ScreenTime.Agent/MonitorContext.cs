using Microsoft.Win32;

namespace ScreenTime.Agent;

internal sealed class MonitorContext : ApplicationContext
{
    private static readonly Version AssemblyVersion =
        typeof(MonitorContext).Assembly.GetName().Version ?? new Version(0, 0, 0, 0);
    private static readonly string DisplayVersion = FormatVersion(AssemblyVersion);
    private const int DailyUpdateIntervalMilliseconds = 24 * 60 * 60 * 1000;
    private readonly AgentConfig _config;
    private readonly WindowsActivity _activity = new();
    private readonly MinuteAggregator _aggregator = new();
    private readonly UploadQueue _uploads;
    private readonly UpdateChecker _updates = new();
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _sampleTimer;
    private readonly System.Windows.Forms.Timer _uploadTimer;
    private readonly System.Windows.Forms.Timer _updateTimer;
    private static readonly TimeSpan ShutdownUploadTimeout = TimeSpan.FromSeconds(4);
    private readonly object _aggregatorLock = new();
    private bool _sampling;
    private int _checkingForUpdates;
    private int _installingUpdate;
    private volatile bool _stopping;
    private DateTimeOffset? _pausedUntil;
    private UpdateManifest? _availableUpdate;

    public MonitorContext(AgentConfig config)
    {
        _config = config;
        _uploads = new UploadQueue(config);
        var menu = new ContextMenuStrip();
        menu.Items.Add("Send now", null, async (_, _) => await SendNowAsync());
        menu.Items.Add("Pause for 30 minutes", null, (_, _) => Pause(TimeSpan.FromMinutes(30)));
        menu.Items.Add("Resume", null, (_, _) => { _pausedUntil = null; UpdateTooltip("Monitoring"); });
        menu.Items.Add("Check for updates", null, async (_, _) => await CheckForUpdatesAsync(manual: true));
        menu.Items.Add(new ToolStripSeparator());
        var versionItem = menu.Items.Add($"Version {DisplayVersion}");
        versionItem.Enabled = false;
        menu.Items.Add("Exit", null, (_, _) => ExitThread());

        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Information,
            Text = $"Screen Time {DisplayVersion} — Monitoring",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _tray.BalloonTipClicked += OnBalloonTipClicked;
        _updates.UpdateAvailable += OnUpdateAvailable;

        _sampleTimer = new System.Windows.Forms.Timer { Interval = config.SampleIntervalSeconds * 1000 };
        _sampleTimer.Tick += async (_, _) => await SampleAsync();
        _uploadTimer = new System.Windows.Forms.Timer { Interval = config.UploadIntervalMinutes * 60 * 1000 };
        _uploadTimer.Tick += async (_, _) => await SendNowAsync();
        _updateTimer = new System.Windows.Forms.Timer { Interval = DailyUpdateIntervalMilliseconds };
        _updateTimer.Tick += async (_, _) => await CheckForUpdatesAsync(manual: false);
        _sampleTimer.Start();
        _uploadTimer.Start();
        _updateTimer.Start();
        SystemEvents.SessionEnding += OnSessionEnding;
        Application.Idle += OnApplicationIdle;
        _ = SampleAsync();
    }

    private void OnApplicationIdle(object? sender, EventArgs e)
    {
        Application.Idle -= OnApplicationIdle;
        _ = CheckForUpdatesAsync(manual: false);
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
        var text = $"Screen Time {DisplayVersion} — {status}";
        _tray.Text = text[..Math.Min(63, text.Length)];
    }

    private async Task CheckForUpdatesAsync(bool manual)
    {
        if (_stopping || Interlocked.CompareExchange(ref _checkingForUpdates, 1, 0) != 0) return;
        try
        {
            if (manual) UpdateTooltip("Checking for updates");
            var result = await _updates.CheckAsync(AssemblyVersion);
            if (!manual) return;
            if (result.Status == UpdateCheckStatus.UpToDate)
                ShowBalloon("Screen Time", $"Version {DisplayVersion} is up to date.", ToolTipIcon.Info);
            else if (result.Status == UpdateCheckStatus.Unavailable)
                ShowBalloon("Update check unavailable", "Try again later.", ToolTipIcon.Warning);
        }
        finally
        {
            Interlocked.Exchange(ref _checkingForUpdates, 0);
            if (manual && Volatile.Read(ref _installingUpdate) == 0) UpdateTooltip("Monitoring");
        }
    }

    private void OnUpdateAvailable(UpdateManifest manifest)
    {
        _availableUpdate = manifest;
        ShowBalloon(
            "Screen Time update available",
            $"Screen Time {manifest.Version} is available — click to install.",
            ToolTipIcon.Info);
    }

    private async void OnBalloonTipClicked(object? sender, EventArgs e)
    {
        if (_availableUpdate is null || _stopping ||
            Interlocked.CompareExchange(ref _installingUpdate, 1, 0) != 0) return;
        UpdateTooltip("Installing update");
        try
        {
            await _updates.StartInstallAsync(_availableUpdate, _config);
        }
        catch
        {
            UpdateTooltip("Update failed");
            ShowBalloon(
                "Screen Time update failed",
                "The update was not installed. Try again later.",
                ToolTipIcon.Error);
        }
        finally
        {
            Interlocked.Exchange(ref _installingUpdate, 0);
        }
    }

    private void ShowBalloon(string title, string text, ToolTipIcon icon)
    {
        _tray.BalloonTipTitle = title;
        _tray.BalloonTipText = text;
        _tray.BalloonTipIcon = icon;
        _tray.ShowBalloonTip(10_000);
    }

    private static string FormatVersion(Version? version) => version is null
        ? "unknown"
        : $"{version.Major}.{version.Minor}.{version.Build}";

    protected override void ExitThreadCore()
    {
        _sampleTimer.Stop();
        _uploadTimer.Stop();
        _updateTimer.Stop();
        Application.Idle -= OnApplicationIdle;
        SystemEvents.SessionEnding -= OnSessionEnding;
        _updates.UpdateAvailable -= OnUpdateAvailable;
        _tray.BalloonTipClicked -= OnBalloonTipClicked;
        _stopping = true;
        FlushAndUpload();
        _tray.Visible = false;
        _tray.Dispose();
        _updates.Dispose();
        base.ExitThreadCore();
    }
}
