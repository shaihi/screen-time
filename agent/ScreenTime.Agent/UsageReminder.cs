namespace ScreenTime.Agent;

// The dashboard controls both the milestones and their Windows notification style.
internal enum ReminderSeverity { Information, Warning, Error }

internal sealed record UsageReminderMilestone(int Minutes, ReminderSeverity Severity);
internal sealed record UsageNotification(int ActualUseSeconds, ReminderSeverity Severity);
internal sealed record DailyUsageReminderState(DateOnly Date, int ActualUseSeconds, int LastNotifiedActualUseSeconds);

internal sealed class UsageReminderPolicy
{
    public static readonly UsageReminderPolicy Disabled = new([]);

    public IReadOnlyList<UsageReminderMilestone> Milestones { get; }

    public UsageReminderPolicy(IEnumerable<UsageReminderMilestone> milestones)
    {
        Milestones = milestones
            .Where(milestone => milestone.Minutes is >= 1 and <= 24 * 60)
            .OrderBy(milestone => milestone.Minutes)
            .GroupBy(milestone => milestone.Minutes)
            .Select(group => group.Last())
            .ToArray();
    }

    public UsageReminderMilestone? NextMilestone(int actualUseSeconds, int lastNotifiedActualUseSeconds) =>
        Milestones.LastOrDefault(milestone =>
            milestone.Minutes * 60 <= actualUseSeconds && milestone.Minutes * 60 > lastNotifiedActualUseSeconds);
}

internal sealed class DailyUsageReminder
{
    private UsageReminderPolicy _policy;
    private DailyUsageReminderState? _state;

    public DailyUsageReminder(UsageReminderPolicy policy, DailyUsageReminderState? state = null)
    {
        _policy = policy;
        _state = state;
    }

    public void UpdatePolicy(UsageReminderPolicy policy) => _policy = policy;

    public UsageNotification? Observe(DateTimeOffset observedAt, ActivityState activityState, int seconds)
    {
        var localDate = DateOnly.FromDateTime(observedAt.LocalDateTime);
        if (_state is null || _state.Date != localDate)
            _state = new DailyUsageReminderState(localDate, 0, 0);

        if (activityState is not (ActivityState.Active or ActivityState.Media) || seconds <= 0) return null;

        _state = _state with { ActualUseSeconds = _state.ActualUseSeconds + seconds };
        var milestone = _policy.NextMilestone(_state.ActualUseSeconds, _state.LastNotifiedActualUseSeconds);
        if (milestone is null) return null;

        _state = _state with { LastNotifiedActualUseSeconds = _state.ActualUseSeconds };
        return new UsageNotification(_state.ActualUseSeconds, milestone.Severity);
    }

    public DailyUsageReminderState Snapshot() => _state ?? new DailyUsageReminderState(DateOnly.FromDateTime(DateTime.Now), 0, 0);
}
