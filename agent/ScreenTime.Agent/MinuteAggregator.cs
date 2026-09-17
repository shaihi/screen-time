namespace ScreenTime.Agent;

internal sealed class MinuteAggregator
{
    private DateTimeOffset? _minute;
    private readonly Dictionary<(ActivityState State, string App), int> _seconds = new();

    public IReadOnlyList<ActivitySample> Observe(DateTimeOffset observedAt, Classification classification, int seconds)
    {
        var currentMinute = new DateTimeOffset(observedAt.Year, observedAt.Month, observedAt.Day, observedAt.Hour, observedAt.Minute, 0, TimeSpan.Zero);
        var completed = Array.Empty<ActivitySample>();
        if (_minute is not null && currentMinute > _minute) completed = Flush().ToArray();
        _minute ??= currentMinute;
        Add((classification.State, classification.AppName ?? string.Empty), seconds);
        if (classification.BackgroundApp is not null) Add((ActivityState.Background, classification.BackgroundApp), seconds);
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
        _minute = null;
        return samples;
    }

    /// <summary>
    /// Cumulative totals for the minute still in progress. The server keeps the largest value per
    /// minute/state/app, so sending a snapshot and later the completed minute never double-counts.
    /// </summary>
    public IReadOnlyList<ActivitySample> Snapshot()
    {
        if (_minute is null || _seconds.Count == 0) return Array.Empty<ActivitySample>();
        return _seconds.Select(item => new ActivitySample(
            _minute.Value, Math.Min(60, item.Value), item.Key.State.ToString().ToLowerInvariant(),
            string.IsNullOrEmpty(item.Key.App) ? null : item.Key.App)).ToArray();
    }
}
