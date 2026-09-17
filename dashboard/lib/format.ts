export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatLastSeen(value: string | null) {
  if (!value) return "No data yet";
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (deltaSeconds < 60) return "Just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  return `${Math.floor(deltaSeconds / 3600)}h ago`;
}


export function formatClock(iso: string, timeZone: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}

export function formatDay(iso: string, timeZone: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
}

/** Exact duration for detail rows: "45s", "6m 20s", "1h 05m". */
export function formatShortDuration(totalSeconds: number) {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds >= 3600) return formatDuration(totalSeconds);
  const seconds = totalSeconds % 60;
  return seconds ? `${Math.floor(totalSeconds / 60)}m ${seconds}s` : `${totalSeconds / 60}m`;
}
