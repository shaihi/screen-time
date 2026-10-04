using Xunit;

namespace ScreenTime.Agent.Tests;

public class UsageReminderTests
{
    private static readonly DateTimeOffset Morning = new(2026, 10, 4, 9, 0, 0, TimeSpan.FromHours(3));
    private static readonly UsageReminderPolicy Policy = new([
        new UsageReminderMilestone(30, ReminderSeverity.Information),
        new UsageReminderMilestone(60, ReminderSeverity.Information),
        new UsageReminderMilestone(90, ReminderSeverity.Warning),
        new UsageReminderMilestone(120, ReminderSeverity.Warning),
        new UsageReminderMilestone(150, ReminderSeverity.Error),
    ]);

    [Fact]
    public void Active_use_notifies_at_the_first_interval()
    {
        var reminder = new DailyUsageReminder(Policy);

        var notification = reminder.Observe(Morning, ActivityState.Active, 30 * 60);

        Assert.Equal(new UsageNotification(30 * 60, ReminderSeverity.Information), notification);
    }

    [Fact]
    public void Media_playback_counts_as_actual_use()
    {
        var reminder = new DailyUsageReminder(Policy);

        var notification = reminder.Observe(Morning, ActivityState.Media, 30 * 60);

        Assert.Equal(new UsageNotification(30 * 60, ReminderSeverity.Information), notification);
    }

    [Theory]
    [InlineData("Idle")]
    [InlineData("Locked")]
    [InlineData("Background")]
    public void Non_use_states_do_not_advance_the_reminder(string stateName)
    {
        var reminder = new DailyUsageReminder(Policy);

        var notification = reminder.Observe(Morning, Enum.Parse<ActivityState>(stateName), 3 * 60 * 60);

        Assert.Null(notification);
        Assert.Equal(0, reminder.Snapshot().ActualUseSeconds);
    }

    [Fact]
    public void Each_interval_is_notified_once_and_the_next_interval_is_reported()
    {
        var reminder = new DailyUsageReminder(Policy);

        Assert.Equal(new UsageNotification(30 * 60, ReminderSeverity.Information),
            reminder.Observe(Morning, ActivityState.Active, 30 * 60));
        Assert.Null(reminder.Observe(Morning.AddMinutes(1), ActivityState.Active, 60));
        Assert.Equal(new UsageNotification(60 * 60, ReminderSeverity.Information),
            reminder.Observe(Morning.AddMinutes(2), ActivityState.Active, 29 * 60));
    }

    [Theory]
    [InlineData(60, "Information")]
    [InlineData(90, "Warning")]
    [InlineData(120, "Warning")]
    [InlineData(150, "Error")]
    public void Notification_severity_increases_with_daily_use(int totalMinutes, string expectedSeverityName)
    {
        var reminder = new DailyUsageReminder(Policy);

        var notification = reminder.Observe(Morning, ActivityState.Active, totalMinutes * 60);

        Assert.Equal(new UsageNotification(totalMinutes * 60, Enum.Parse<ReminderSeverity>(expectedSeverityName)), notification);
    }

    [Fact]
    public void Saved_state_continues_to_the_next_milestone_without_repeating_the_previous_one()
    {
        var saved = new DailyUsageReminderState(DateOnly.FromDateTime(Morning.DateTime), 45 * 60, 30 * 60);
        var reminder = new DailyUsageReminder(Policy, saved);

        var notification = reminder.Observe(Morning.AddHours(1), ActivityState.Active, 15 * 60);

        Assert.Equal(new UsageNotification(60 * 60, ReminderSeverity.Information), notification);
    }

    [Fact]
    public void A_new_local_day_starts_a_fresh_total()
    {
        var saved = new DailyUsageReminderState(DateOnly.FromDateTime(Morning.DateTime), 150 * 60, 150 * 60);
        var reminder = new DailyUsageReminder(Policy, saved);

        var notification = reminder.Observe(Morning.AddDays(1), ActivityState.Active, 30 * 60);

        Assert.Equal(new UsageNotification(30 * 60, ReminderSeverity.Information), notification);
        Assert.Equal(30 * 60, reminder.Snapshot().ActualUseSeconds);
    }
}
