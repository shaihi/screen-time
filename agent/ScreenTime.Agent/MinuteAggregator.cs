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
        var key = (classification.State, classification.AppName ?? string.Empty);
        _seconds[key] = _seconds.GetValueOrDefault(key) + seconds;
        return completed;
    }

    public IReadOnlyList<ActivitySample> Flush()
    {
        if (_minute is null || _seconds.Count == 0) return Array.Empty<ActivitySample>();
        var samples = _seconds.Select(item => new ActivitySample(
            _minute.Value, Math.Min(60, item.Value), item.Key.State.ToString().ToLowerInvariant(),
            string.IsNullOrEmpty(item.Key.App) ? null : item.Key.App)).ToArray();
        _seconds.Clear();
        _minute = null;
        return samples;
    }
}
