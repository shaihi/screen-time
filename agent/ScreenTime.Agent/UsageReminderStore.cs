using System.Text.Json;

namespace ScreenTime.Agent;

internal sealed class UsageReminderStore
{
    private readonly string _statePath;
    private readonly string _policyPath;

    public UsageReminderStore()
    {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenTimeAgent");
        Directory.CreateDirectory(directory);
        _statePath = Path.Combine(directory, "usage-reminder-state.json");
        _policyPath = Path.Combine(directory, "usage-reminder-policy.json");
    }

    public DailyUsageReminderState? LoadState() => Read<DailyUsageReminderState>(_statePath);

    public UsageReminderPolicy? LoadPolicy()
    {
        var stored = Read<StoredReminderPolicy>(_policyPath);
        return stored is null ? null : new UsageReminderPolicy(stored.Milestones);
    }

    public void SaveState(DailyUsageReminderState state) => Write(_statePath, state);

    public void SavePolicy(UsageReminderPolicy policy) => Write(_policyPath, new StoredReminderPolicy(policy.Milestones.ToList()));

    private static T? Read<T>(string path)
    {
        try { return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), JsonOptions.Default) : default; }
        catch { return default; }
    }

    private static void Write<T>(string path, T value)
    {
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(value, JsonOptions.Default));
        File.Move(temporary, path, true);
    }

    private sealed record StoredReminderPolicy(List<UsageReminderMilestone> Milestones);
}
