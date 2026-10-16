type Window = { dayOfWeek: number; startMinute: number; endMinute: number };

function minute(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("Enter a valid time.");
  const [hour, minutes] = value.split(":").map(Number);
  return hour * 60 + minutes;
}

export function dailySchedule(start: string, end: string): Window[] {
  const startMinute = minute(start);
  const endMinute = minute(end);
  if (endMinute <= startMinute) throw new Error("End time must be later than start time.");
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute, endMinute }));
}

export function clockLabel(minutes: number) {
  return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

export function scheduleSummary(windows: Window[]) {
  if (!windows.length) return "Any time of day";
  if (windows.length === 7 && new Set(windows.map((window) => window.dayOfWeek)).size === 7
    && windows.every((window) => window.startMinute === windows[0].startMinute && window.endMinute === windows[0].endMinute)) {
    return `Every day, ${clockLabel(windows[0].startMinute)}–${clockLabel(windows[0].endMinute)}`;
  }
  return "Custom weekly schedule";
}

export function displayControlState(
  status: { state: string; appliedRevision: number; lastSeenAt?: string } | null,
  revision: number,
  now = Date.now(),
) {
  if (!status || !status.lastSeenAt) return "Waiting for first contact";
  if (now - Date.parse(status.lastSeenAt) > 120_000) return `Offline · last reported ${status.state}`;
  if (status.state === "error") return "Needs attention";
  if (status.state === "countdown") return "Closing apps in 30 seconds";
  if (status.appliedRevision !== revision) return "Waiting for computer";
  return ({ blocked: "Blocked · confirmed", allowed: "Allowed · confirmed", warning: "Time nearly up", monitoring: "Monitoring · no blocking" })[status.state] ?? "Unknown state";
}

export function secondsLabel(seconds: number | null) {
  return seconds === null ? "No daily cap" : `${Math.ceil(Math.max(0, seconds) / 60)} min`;
}
