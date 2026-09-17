namespace ScreenTime.Agent;

internal enum ActivityState { Active, Media, Idle, Locked }
internal sealed record Classification(ActivityState State, string? AppName);
internal sealed record ActivitySample(DateTimeOffset StartedAt, int DurationSeconds, string State, string? AppName);
internal sealed record UploadBatch(Guid BatchId, string DeviceId, IReadOnlyList<ActivitySample> Samples);
