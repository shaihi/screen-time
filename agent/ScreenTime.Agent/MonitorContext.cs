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
    private readonly ControlPipeClient _control = new();
    private string? _lastControlWarning;
    private readonly MinuteAggregator _aggregator = new();
    private readonly UploadQueue _uploads;
    private readonly AgentLifecycleTracker _lifecycle;
    private readonly UpdateChecker _updates = new();
    private readonly UsageReminderStore _reminderStore;
    private readonly DailyUsageReminder _usageReminder;
    private readonly ReminderPolicyClient _policyClient;
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _sampleTimer;
    private readonly System.Windows.Forms.Timer _uploadTimer;
    private readonly System.Windows.Forms.Timer _updateTimer;
    private readonly System.Windows.Forms.Timer _policyTimer;
    private static readonly TimeSpan ShutdownUploadTimeout = TimeSpan.FromSeconds(4);
    private readonly object _aggregatorLock = new();
    private bool _sampling;
    private int _checkingForUpdates;
    private int _installingUpdate;
    private int _stopEventRecorded;
    private bool _updateInstallPromptVisible;
    private volatile bool _stopping;
    private DateTimeOffset? _pausedUntil;
    private UpdateManifest? _availableUpdate;

    public MonitorContext(AgentConfig config)
    {
        _config = config;
        _uploads = new UploadQueue(config);
        _lifecycle = new AgentLifecycleTracker();
        var startedAt = DateTimeOffset.UtcNow;
        if (config.TelemetryEnabled) _uploads.EnqueueEvents(_lifecycle.BeginRun(startedAt, GetBootedAt(startedAt), DisplayVersion));
        _reminderStore = new UsageReminderStore();
        _usageReminder = new DailyUsageReminder(_reminderStore.LoadPolicy() ?? UsageReminderPolicy.Disabled, _reminderStore.LoadState());
        _policyClient = new ReminderPolicyClient(config);
        var menu = new ContextMenuStrip();
        menu.Items.Add("Send now", null, async (_, _) => await SendNowAsync());
        menu.Items.Add(config.ManagedInstallation ? "Pause reports for 30 minutes (rules stay on)" : "Pause for 30 minutes", null, (_, _) => Pause(TimeSpan.FromMinutes(30)));
        menu.Items.Add("Resume", null, (_, _) => { _pausedUntil = null; UpdateTooltip("Monitoring"); });
        if (!config.ManagedInstallation)
            menu.Items.Add("Check for updates", null, async (_, _) => await CheckForUpdatesAsync(manual: true));
        if (config.ManagedInstallation)
        {
            var managed = menu.Items.Add("Screen-time rules stay on when this icon closes");
            managed.Enabled = false;
        }
        menu.Items.Add(new ToolStripSeparator());
        var versionItem = menu.Items.Add($"Version {DisplayVersion}");
        versionItem.Enabled = false;
        menu.Items.Add(config.ManagedInstallation ? "Close icon (rules stay on)" : "Exit", null, (_, _) =>
        {
            RecordStop(LifecycleEventKinds.UserExit, "Exited from the notification tray.");
            ExitThread();
        });

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
        _policyTimer = new System.Windows.Forms.Timer { Interval = 15 * 60 * 1000 };
        _policyTimer.Tick += async (_, _) => await RefreshReminderPolicyAsync();
        _sampleTimer.Start();
        _uploadTimer.Start();
        _updateTimer.Start();
        _policyTimer.Start();
        SystemEvents.SessionEnding += OnSessionEnding;
        Application.Idle += OnApplicationIdle;
        _ = SampleAsync();
        _ = SendNowAsync();
        _ = RefreshReminderPolicyAsync();
    }

    private void OnApplicationIdle(object? sender, EventArgs e)
    {
        Application.Idle -= OnApplicationIdle;
        _ = CheckForUpdatesAsync(manual: false);
    }

    private async Task SampleAsync()
    {
        if (_stopping) return;
        _lifecycle.Heartbeat(DateTimeOffset.UtcNow);
        if (_sampling) return;
        if (!_config.ManagedInstallation && _pausedUntil is not null && _pausedUntil > DateTimeOffset.Now) return;
        if (_pausedUntil is not null && _pausedUntil <= DateTimeOffset.Now) { _pausedUntil = null; UpdateTooltip("Monitoring"); }
        _sampling = true;
        try
        {
            var classification = await _activity.ClassifyAsync(
                _config.IdleThresholdSeconds,
                _config.CollectPageTitles);
            if (_stopping) return;
            // Do not await IPC: stalled pipe traffic cannot block activity sampling.
            _ = SendControlObservationAsync(classification.State);
            if (!_config.TelemetryEnabled || _pausedUntil > DateTimeOffset.Now) return;
            var observedAt = DateTimeOffset.UtcNow;
            IReadOnlyList<ActivitySample> completed;
            lock (_aggregatorLock) completed = _aggregator.Observe(observedAt, classification, _config.SampleIntervalSeconds);
            if (completed.Count > 0) _uploads.Enqueue(completed);
            var reminder = _usageReminder.Observe(observedAt, classification.State, _config.SampleIntervalSeconds);
            if (completed.Count > 0 || reminder is not null) _reminderStore.SaveState(_usageReminder.Snapshot());
            if (reminder is not null) ShowUsageReminder(reminder);
            UpdateTooltip(classification.State.ToString());
        }
        catch { UpdateTooltip("Temporary sensor error"); }
        finally { _sampling = false; }
    }

    private async Task SendControlObservationAsync(ActivityState state)
    {
        var status = await _control.ObserveAsync(state);
        if (_stopping || !_config.ManagedInstallation) return;
        if (status is null) { UpdateTooltip("Rules service unavailable"); return; }
        var label = status.RemainingSeconds is int seconds ? $"{Math.Ceiling(seconds / 60d)} min left" : status.State;
        UpdateTooltip(label);
        if (status.WarningSeconds is int warning)
        {
            var key = $"{DateTime.Today:yyyy-MM-dd}:{warning}";
            if (_lastControlWarning == key) return;
            _lastControlWarning = key;
            ShowBalloon("Save your work", $"Screen time ends in {warning / 60} minute(s). Save your work now; apps will close at the limit.", ToolTipIcon.Warning);
        }
        else if (status.State == "allowed" && status.RemainingSeconds > 300) _lastControlWarning = null;
    }

    private async Task SendNowAsync()
    {
        if (!_config.TelemetryEnabled) return;
        try
        {
            IReadOnlyList<ActivitySample> inProgress;
            lock (_aggregatorLock) inProgress = _aggregator.Snapshot();
            if (inProgress.Count > 0) _uploads.Enqueue(inProgress);
            var sent = await _uploads.SendAllAsync();
            UpdateTooltip(sent > 0 ? $"Sent {sent} records" : "Up to date");
        }
        catch { UpdateTooltip("Offline — data queued"); }
    }

    // Windows is signing out or shutting down: persist the unfinished minute and try one quick upload.
    // Sampling keeps going in case the shutdown is cancelled.
    private void OnSessionEnding(object? sender, SessionEndingEventArgs e)
    {
        if (e.Reason == SessionEndReasons.Logoff)
            RecordStop(LifecycleEventKinds.SignOut, "Windows user signed out.");
        else
            RecordStop(LifecycleEventKinds.SystemShutdown, "Windows shutdown or restart was requested.");
        FlushAndUpload();
    }

    private void RecordStop(string kind, string? detail = null)
    {
        if (Interlocked.CompareExchange(ref _stopEventRecorded, 1, 0) != 0) return;
        var lifecycleEvent = _lifecycle.EndRun(DateTimeOffset.UtcNow, kind, detail);
        if (_config.TelemetryEnabled && lifecycleEvent is not null) _uploads.EnqueueEvents([lifecycleEvent]);
    }

    private void ResumeAfterCancelledStop()
    {
        var resumedAt = DateTimeOffset.UtcNow;
        if (_config.TelemetryEnabled) _uploads.EnqueueEvents(_lifecycle.BeginRun(resumedAt, GetBootedAt(resumedAt), DisplayVersion));
        Interlocked.Exchange(ref _stopEventRecorded, 0);
    }

    private void FlushAndUpload()
    {
        if (!_config.TelemetryEnabled) return;
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
        UpdateTooltip(_config.ManagedInstallation ? "Reports paused; rules stay on" : "Paused for 30 minutes");
    }

    private async Task RefreshReminderPolicyAsync()
    {
        if (!_config.TelemetryEnabled) return;
        try
        {
            var policy = await _policyClient.FetchAsync();
            if (policy is null) return;
            _usageReminder.UpdatePolicy(policy);
            _reminderStore.SavePolicy(policy);
        }
        catch { /* Continue using the last locally cached policy. */ }
    }

    private void ShowUsageReminder(UsageNotification notification)
    {
        var duration = TimeSpan.FromSeconds(notification.ActualUseSeconds);
        var text = duration.Hours > 0 ? $"{duration.Hours}h {duration.Minutes}m" : $"{duration.Minutes}m";
        ShowBalloon("Screen Time reminder", $"You have used {text} today.", notification.Severity switch
        {
            ReminderSeverity.Information => ToolTipIcon.Info,
            ReminderSeverity.Warning => ToolTipIcon.Warning,
            ReminderSeverity.Error => ToolTipIcon.Error,
            _ => ToolTipIcon.None,
        });
    }

    private void UpdateTooltip(string status)
    {
        var text = $"Screen Time {DisplayVersion} — {status}";
        _tray.Text = text[..Math.Min(63, text.Length)];
    }

    private async Task CheckForUpdatesAsync(bool manual)
    {
        if (_config.ManagedInstallation || _stopping || Interlocked.CompareExchange(ref _checkingForUpdates, 1, 0) != 0) return;
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
            ToolTipIcon.Info,
            opensUpdateInstaller: true);
    }

    private async void OnBalloonTipClicked(object? sender, EventArgs e)
    {
        if (!_updateInstallPromptVisible || _availableUpdate is null || _stopping ||
            Interlocked.CompareExchange(ref _installingUpdate, 1, 0) != 0) return;
        _updateInstallPromptVisible = false;
        UpdateTooltip("Installing update");
        try
        {
            RecordStop(LifecycleEventKinds.Updating, $"Installing version {_availableUpdate.Version}.");
            await _updates.StartInstallAsync(_availableUpdate, _config);
        }
        catch
        {
            ResumeAfterCancelledStop();
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

    private void ShowBalloon(string title, string text, ToolTipIcon icon, bool opensUpdateInstaller = false)
    {
        _updateInstallPromptVisible = opensUpdateInstaller;
        _tray.BalloonTipTitle = title;
        _tray.BalloonTipText = text;
        _tray.BalloonTipIcon = icon;
        _tray.ShowBalloonTip(10_000);
    }

    private static string FormatVersion(Version? version) => version is null
        ? "unknown"
        : $"{version.Major}.{version.Minor}.{version.Build}";

    private static DateTimeOffset GetBootedAt(DateTimeOffset now) =>
        now - TimeSpan.FromMilliseconds(Environment.TickCount64);

    protected override void ExitThreadCore()
    {
        _sampleTimer.Stop();
        _uploadTimer.Stop();
        _updateTimer.Stop();
        Application.Idle -= OnApplicationIdle;
        _policyTimer.Stop();
        SystemEvents.SessionEnding -= OnSessionEnding;
        _updates.UpdateAvailable -= OnUpdateAvailable;
        _tray.BalloonTipClicked -= OnBalloonTipClicked;
        _stopping = true;
        RecordStop(LifecycleEventKinds.ApplicationExit, "Agent application exited cleanly.");
        _reminderStore.SaveState(_usageReminder.Snapshot());
        FlushAndUpload();
        _tray.Visible = false;
        _tray.Dispose();
        _updates.Dispose();
        base.ExitThreadCore();
    }
}
