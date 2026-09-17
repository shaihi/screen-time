using Xunit;

namespace ScreenTime.Agent.Tests;

public class MinuteAggregatorTests
{
    private static readonly DateTimeOffset Minute = new(2026, 9, 17, 10, 6, 0, TimeSpan.Zero);
    private static readonly Classification Roblox = new(ActivityState.Active, "Roblox");

    [Fact]
    public void Snapshot_returns_the_minute_in_progress_without_resetting()
    {
        var aggregator = new MinuteAggregator();
        aggregator.Observe(Minute.AddSeconds(1), Roblox, 2);
        aggregator.Observe(Minute.AddSeconds(3), Roblox, 2);

        var first = Assert.Single(aggregator.Snapshot());
        Assert.Equal(new ActivitySample(Minute, 4, "active", "Roblox"), first);

        aggregator.Observe(Minute.AddSeconds(5), Roblox, 2);
        Assert.Equal(6, Assert.Single(aggregator.Snapshot()).DurationSeconds);
    }

    [Fact]
    public void Snapshot_is_empty_before_any_observation() =>
        Assert.Empty(new MinuteAggregator().Snapshot());

    [Fact]
    public void Completed_minute_is_returned_when_the_next_minute_starts()
    {
        var aggregator = new MinuteAggregator();
        aggregator.Observe(Minute.AddSeconds(58), Roblox, 2);

        var completed = aggregator.Observe(Minute.AddMinutes(1), new(ActivityState.Idle, null), 2);

        Assert.Equal(new ActivitySample(Minute, 2, "active", "Roblox"), Assert.Single(completed));
        Assert.Equal(new ActivitySample(Minute.AddMinutes(1), 2, "idle", null), Assert.Single(aggregator.Snapshot()));
    }

    [Fact]
    public void Flush_returns_the_partial_minute_and_resets()
    {
        var aggregator = new MinuteAggregator();
        aggregator.Observe(Minute, Roblox, 2);

        Assert.Single(aggregator.Flush());
        Assert.Empty(aggregator.Snapshot());
        Assert.Empty(aggregator.Flush());
    }

    [Fact]
    public void Durations_are_capped_at_sixty_seconds()
    {
        var aggregator = new MinuteAggregator();
        for (var i = 0; i < 40; i++) aggregator.Observe(Minute, Roblox, 2);
        Assert.Equal(60, Assert.Single(aggregator.Snapshot()).DurationSeconds);
    }

    [Fact]
    public void Background_media_is_recorded_alongside_the_foreground_app()
    {
        var aggregator = new MinuteAggregator();
        aggregator.Observe(Minute, new Classification(ActivityState.Active, "Roblox", "Spotify"), 2);
        aggregator.Observe(Minute.AddSeconds(2), Roblox, 2);

        var samples = aggregator.Snapshot();
        Assert.Contains(new ActivitySample(Minute, 4, "active", "Roblox"), samples);
        Assert.Contains(new ActivitySample(Minute, 2, "background", "Spotify"), samples);
        Assert.Equal(2, samples.Count);
    }

    [Fact]
    public void Active_browser_title_is_recorded_in_addition_to_normal_activity()
    {
        var aggregator = new MinuteAggregator();
        aggregator.Observe(Minute, new Classification(ActivityState.Active, "Google Chrome", PageTitle: "Roblox"), 2);

        var samples = aggregator.Snapshot();
        Assert.Contains(new ActivitySample(Minute, 2, "active", "Google Chrome"), samples);
        Assert.Contains(new ActivitySample(Minute, 2, "active", "Google Chrome", "Roblox"), samples);
        Assert.Equal(2, samples.Count);
    }

    [Fact]
    public void Two_page_titles_keep_their_own_durations()
    {
        var aggregator = new MinuteAggregator();
        aggregator.Observe(Minute, new Classification(ActivityState.Active, "Microsoft Edge", PageTitle: "First"), 2);
        aggregator.Observe(Minute.AddSeconds(2), new Classification(ActivityState.Active, "Microsoft Edge", PageTitle: "Second"), 2);
        aggregator.Observe(Minute.AddSeconds(4), new Classification(ActivityState.Active, "Microsoft Edge", PageTitle: "Second"), 2);

        var pages = aggregator.Snapshot().Where(sample => sample.PageTitle is not null).ToArray();
        Assert.Contains(new ActivitySample(Minute, 2, "active", "Microsoft Edge", "First"), pages);
        Assert.Contains(new ActivitySample(Minute, 4, "active", "Microsoft Edge", "Second"), pages);
        Assert.Equal(2, pages.Length);
    }

    [Fact]
    public void Idle_state_never_records_a_page_title()
    {
        var aggregator = new MinuteAggregator();
        aggregator.Observe(Minute, new Classification(ActivityState.Idle, "Google Chrome", PageTitle: "Ignored"), 2);

        Assert.DoesNotContain(aggregator.Snapshot(), sample => sample.PageTitle is not null);
    }

    [Fact]
    public void Flush_clears_page_titles()
    {
        var aggregator = new MinuteAggregator();
        aggregator.Observe(Minute, new Classification(ActivityState.Active, "Google Chrome", PageTitle: "Old page"), 2);

        Assert.Equal(2, aggregator.Flush().Count);
        Assert.Empty(aggregator.Snapshot());

        aggregator.Observe(Minute.AddMinutes(1), new Classification(ActivityState.Active, "Google Chrome"), 2);
        Assert.DoesNotContain(aggregator.Snapshot(), sample => sample.PageTitle is not null);
    }
}
