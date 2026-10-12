using Xunit;

namespace ScreenTime.Agent.Tests;

public sealed class AgentLifecycleTrackerTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"ScreenTimeAgent-tests-{Guid.NewGuid():N}");
    private string StatePath => Path.Combine(_directory, "lifecycle.json");

    [Fact]
    public void First_launch_reports_started()
    {
        var now = new DateTimeOffset(2026, 10, 12, 9, 0, 0, TimeSpan.Zero);
        var tracker = new AgentLifecycleTracker(StatePath);

        var events = tracker.BeginRun(now, now.AddHours(-1), "1.7.0");

        var started = Assert.Single(events);
        Assert.Equal(LifecycleEventKinds.Started, started.Kind);
        Assert.Equal(now, started.OccurredAt);
        Assert.Equal("1.7.0", started.AgentVersion);
    }

    [Fact]
    public void Clean_exit_does_not_create_an_unexpected_stop_on_next_launch()
    {
        var now = new DateTimeOffset(2026, 10, 12, 9, 0, 0, TimeSpan.Zero);
        var tracker = new AgentLifecycleTracker(StatePath);
        tracker.BeginRun(now, now.AddHours(-1), "1.7.0");
        var stopped = tracker.EndRun(now.AddMinutes(5), LifecycleEventKinds.UserExit);

        var events = new AgentLifecycleTracker(StatePath).BeginRun(
            now.AddMinutes(10), now.AddHours(-1), "1.7.0");

        Assert.Equal(LifecycleEventKinds.UserExit, stopped?.Kind);
        Assert.Equal(LifecycleEventKinds.Started, Assert.Single(events).Kind);
    }

    [Fact]
    public void Open_marker_on_the_same_boot_is_reported_as_an_unexpected_stop()
    {
        var now = new DateTimeOffset(2026, 10, 12, 9, 0, 0, TimeSpan.Zero);
        var first = new AgentLifecycleTracker(StatePath);
        first.BeginRun(now, now.AddHours(-1), "1.7.0");
        first.Heartbeat(now.AddMinutes(2));

        var events = new AgentLifecycleTracker(StatePath).BeginRun(
            now.AddMinutes(5), now.AddHours(-1), "1.7.0");

        Assert.Equal(2, events.Count);
        Assert.Equal(LifecycleEventKinds.UnexpectedStop, events[0].Kind);
        Assert.Equal(now.AddMinutes(2), events[0].OccurredAt);
        Assert.Equal(LifecycleEventKinds.Started, events[1].Kind);
    }

    [Fact]
    public void Open_marker_from_before_the_current_boot_is_reported_as_a_restart_or_power_loss()
    {
        var firstStart = new DateTimeOffset(2026, 10, 12, 9, 0, 0, TimeSpan.Zero);
        var first = new AgentLifecycleTracker(StatePath);
        first.BeginRun(firstStart, firstStart.AddHours(-1), "1.6.0");

        var events = new AgentLifecycleTracker(StatePath).BeginRun(
            firstStart.AddHours(3), firstStart.AddHours(2), "1.7.0");

        Assert.Equal(LifecycleEventKinds.UnexpectedSystemRestart, events[0].Kind);
        Assert.Equal("1.6.0", events[0].AgentVersion);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }
}
