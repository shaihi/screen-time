using System.Text.Json;

namespace ScreenTime.Agent;

internal static class LifecycleEventKinds
{
    public const string Started = "started";
    public const string UserExit = "user_exit";
    public const string ApplicationExit = "application_exit";
    public const string SignOut = "sign_out";
    public const string SystemShutdown = "system_shutdown";
    public const string Updating = "updating";
    public const string UnexpectedStop = "unexpected_stop";
    public const string UnexpectedSystemRestart = "unexpected_system_restart";
}

internal sealed record AgentLifecycleState(
    Guid RunId,
    DateTimeOffset StartedAt,
    DateTimeOffset LastSeenAt,
    string AgentVersion,
    bool CleanExit);

/// <summary>
/// Persists a small run marker. A marker left open after the process disappears lets the next
/// launch report an unexpected stop even though the stopped process could not upload anything.
/// </summary>
internal sealed class AgentLifecycleTracker
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromMinutes(1);
    private readonly string _statePath;
    private readonly object _stateLock = new();
    private AgentLifecycleState? _current;
    private DateTimeOffset _lastPersistedAt;

    public AgentLifecycleTracker(string? statePath = null)
    {
        if (statePath is not null)
        {
            _statePath = statePath;
            return;
        }

        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ScreenTimeAgent");
        Directory.CreateDirectory(directory);
        _statePath = Path.Combine(directory, "lifecycle.json");
    }

    public IReadOnlyList<AgentLifecycleEvent> BeginRun(
        DateTimeOffset now,
        DateTimeOffset bootedAt,
        string agentVersion)
    {
        lock (_stateLock)
        {
            var events = new List<AgentLifecycleEvent>();
            var previous = Load();
            if (previous is { CleanExit: false })
            {
                var restarted = bootedAt > previous.StartedAt;
                events.Add(new AgentLifecycleEvent(
                    Guid.NewGuid(),
                    previous.LastSeenAt,
                    restarted ? LifecycleEventKinds.UnexpectedSystemRestart : LifecycleEventKinds.UnexpectedStop,
                    previous.RunId,
                    previous.AgentVersion,
                    restarted
                        ? "The previous run ended across a Windows restart or power interruption."
                        : "The previous run ended without a clean exit; possible crash or forced termination."));
            }

            _current = new AgentLifecycleState(Guid.NewGuid(), now, now, agentVersion, false);
            _lastPersistedAt = now;
            Save(_current);
            events.Add(new AgentLifecycleEvent(
                Guid.NewGuid(), now, LifecycleEventKinds.Started, _current.RunId, agentVersion));
            return events;
        }
    }

    public void Heartbeat(DateTimeOffset now)
    {
        lock (_stateLock)
        {
            if (_current is null || now - _lastPersistedAt < HeartbeatInterval) return;
            _current = _current with { LastSeenAt = now };
            _lastPersistedAt = now;
            Save(_current);
        }
    }

    public AgentLifecycleEvent? EndRun(DateTimeOffset now, string kind, string? detail = null)
    {
        lock (_stateLock)
        {
            if (_current is null || _current.CleanExit) return null;
            _current = _current with { LastSeenAt = now, CleanExit = true };
            _lastPersistedAt = now;
            Save(_current);
            return new AgentLifecycleEvent(
                Guid.NewGuid(), now, kind, _current.RunId, _current.AgentVersion, detail);
        }
    }

    private AgentLifecycleState? Load()
    {
        try
        {
            return File.Exists(_statePath)
                ? JsonSerializer.Deserialize<AgentLifecycleState>(File.ReadAllText(_statePath), JsonOptions.Default)
                : null;
        }
        catch { return null; }
    }

    private void Save(AgentLifecycleState state)
    {
        try
        {
            var directory = Path.GetDirectoryName(_statePath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            var temporary = _statePath + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(state, JsonOptions.Default));
            File.Move(temporary, _statePath, true);
        }
        catch { /* Lifecycle telemetry must never prevent monitoring. */ }
    }
}
