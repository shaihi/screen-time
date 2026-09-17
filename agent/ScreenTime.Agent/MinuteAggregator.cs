namespace ScreenTime.Agent;

internal sealed class MinuteAggregator
{
    private DateTimeOffset? _minute;
    private readonly Dictionary<(ActivityState State, string App), int> _seconds = new();
    private readonly Dictionary<(string App, string Title), int> _pages = new();

    public IReadOnlyList<ActivitySample> Observe(DateTimeOffset observedAt, Classification classification, int seconds)
    {
        var currentMinute = new DateTimeOffset(observedAt.Year, observedAt.Month, observedAt.Day, observedAt.Hour, observedAt.Minute, 0, TimeSpan.Zero);
        var completed = Array.Empty<ActivitySample>();
        if (_minute is not null && currentMinute > _minute) completed = Flush().ToArray();
        _minute ??= currentMinute;
        Add((classification.State, classification.AppName ?? string.Empty), seconds);
        if (classification.BackgroundApp is not null) Add((ActivityState.Background, classification.BackgroundApp), seconds);
        if (classification.State == ActivityState.Active &&
            !string.IsNullOrEmpty(classification.AppName) &&
            !string.IsNullOrEmpty(classification.PageTitle))
        {
            var page = (classification.AppName, classification.PageTitle);
            _pages[page] = _pages.GetValueOrDefault(page) + seconds;
        }
        return completed;
    }

    private void Add((ActivityState State, string App) key, int seconds)
    {
        _seconds[key] = _seconds.GetValueOrDefault(key) + seconds;
    }

    /// <summary>Completes the current minute and resets.</summary>
    public IReadOnlyList<ActivitySample> Flush()
    {
        var samples = Snapshot();
        _seconds.Clear();
        _pages.Clear();
        _minute = null;
        return samples;
    }

    /// <summary>
    /// Cumulative totals for the minute still in progress. The server keeps the largest value per
    /// minute/state/app, so sending a snapshot and later the completed minute never double-counts.
    /// </summary>
    public IReadOnlyList<ActivitySample> Snapshot()
    {
        if (_minute is null || (_seconds.Count == 0 && _pages.Count == 0)) return Array.Empty<ActivitySample>();
        var activity = _seconds.Select(item => new ActivitySample(
            _minute.Value, Math.Min(60, item.Value), item.Key.State.ToString().ToLowerInvariant(),
            string.IsNullOrEmpty(item.Key.App) ? null : item.Key.App));
        var pages = _pages.Select(item => new ActivitySample(
            _minute.Value, Math.Min(60, item.Value), "active", item.Key.App, item.Key.Title));
        return activity.Concat(pages).ToArray();
    }
}
