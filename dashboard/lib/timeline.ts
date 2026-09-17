// Builds the per-hour or per-day chart points. Relative imports keep it runnable under `node --test`.
import { categories, categoryOf, type Category } from "./categories.ts";
import { dayLabel, daysBetween, type RangeKey } from "./range.ts";

export const OTHER_APPS = "Other apps";

export type TimelineSegment = { app: string; category: Category; seconds: number };

export type AppSeconds = { app: string; seconds: number };

/** `idleApps`: named apps that were in front while idle, i.e. left running. */
export type TimelinePoint = {
  key: string;
  label: string;
  title: string;
  idle: number;
  idleApps: AppSeconds[];
  segments: TimelineSegment[];
};

/** `app` is null for time that has no listed app (system or hidden apps). */
export type TimelineRow = { bucket: string; state: string; app: string | null; seconds: number };

function emptyPoints(range: RangeKey, startDay: string, today: string) {
  if (range === "day") {
    return Array.from({ length: 24 }, (_, hour) => {
      const label = String(hour).padStart(2, "0");
      return { key: String(hour), label: hour % 3 === 0 ? label : "", title: `${label}:00–${label}:59` };
    });
  }
  return daysBetween(startDay, today).map((day) => ({
    key: day,
    label: dayLabel(day, range),
    title: new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
  }));
}

const rank = (segment: TimelineSegment) => categories.indexOf(segment.category);

/** Active and media time is split by app and ordered by category so each colour sits together. */
export function buildTimelinePoints(
  range: RangeKey,
  bounds: { startDay: string; today: string },
  rows: TimelineRow[],
): TimelinePoint[] {
  return emptyPoints(range, bounds.startDay, bounds.today).map((point) => {
    const own = rows.filter((row) => row.bucket === point.key);
    const idle = own.filter((row) => row.state === "idle").reduce((sum, row) => sum + Number(row.seconds), 0);
    const byApp = new Map<string, number>();
    for (const row of own) {
      if (row.state !== "active" && row.state !== "media") continue;
      const app = row.app ?? OTHER_APPS;
      byApp.set(app, (byApp.get(app) ?? 0) + Number(row.seconds));
    }
    const segments = [...byApp]
      .filter(([, seconds]) => seconds > 0)
      .map(([app, seconds]) => ({ app, category: app === OTHER_APPS ? "other" as const : categoryOf(app), seconds }))
      .sort((a, b) => rank(a) - rank(b) || b.seconds - a.seconds);
    const idleApps = own
      .filter((row) => row.state === "idle" && row.app && Number(row.seconds) > 0)
      .map((row) => ({ app: row.app as string, seconds: Number(row.seconds) }))
      .sort((a, b) => b.seconds - a.seconds);
    return { ...point, idle, idleApps, segments };
  });
}
