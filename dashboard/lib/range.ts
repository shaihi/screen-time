export const rangeKeys = ["day", "week", "month"] as const;
export type RangeKey = (typeof rangeKeys)[number];

export const rangeLabels: Record<RangeKey, { tab: string; eyebrow: string }> = {
  day: { tab: "Day", eyebrow: "TODAY" },
  week: { tab: "Week", eyebrow: "THIS WEEK" },
  month: { tab: "Month", eyebrow: "THIS MONTH" },
};

export function parseRange(value: unknown): RangeKey {
  return rangeKeys.includes(value as RangeKey) ? (value as RangeKey) : "day";
}

/**
 * SQL for the local start of the range as timestamptz; `$1` is the display time zone.
 * Weeks start on Sunday. Only these fixed strings are ever interpolated into queries.
 */
export function rangeStartSql(range: RangeKey) {
  const localNow = "(NOW() AT TIME ZONE $1)";
  switch (range) {
    case "day":
      return `(date_trunc('day', ${localNow}) AT TIME ZONE $1)`;
    case "week":
      return `((date_trunc('day', ${localNow}) - EXTRACT(DOW FROM ${localNow})::int * interval '1 day') AT TIME ZONE $1)`;
    case "month":
      return `(date_trunc('month', ${localNow}) AT TIME ZONE $1)`;
  }
}

/** Inclusive list of ISO dates (YYYY-MM-DD) from `startDay` to `endDay`. */
export function daysBetween(startDay: string, endDay: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${endDay}T00:00:00Z`);
  for (let time = Date.parse(`${startDay}T00:00:00Z`); time <= end; time += 86_400_000) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

export function dayLabel(day: string, range: RangeKey) {
  const date = new Date(`${day}T00:00:00Z`);
  if (range === "week") return date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const dayOfMonth = date.getUTCDate();
  return dayOfMonth === 1 || dayOfMonth % 5 === 0 ? String(dayOfMonth) : "";
}
