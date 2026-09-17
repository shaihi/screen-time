namespace ScreenTime.Agent;

internal enum ActivityState { Active, Media, Idle, Locked, Background }
// BackgroundApp: media playing in another app while the user is active in AppName.
internal sealed record Classification(ActivityState State, string? AppName, string? BackgroundApp = null);
internal sealed record ActivitySample(DateTimeOffset StartedAt, int DurationSeconds, string State, string? AppName);
internal sealed record UploadBatch(Guid BatchId, string DeviceId, IReadOnlyList<ActivitySample> Samples);
