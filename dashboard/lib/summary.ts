import { database, ensureSchema } from "@/lib/db";
import { rangeStartSql, type RangeKey } from "@/lib/range";
import { buildOverlaps, buildSessions, type MinuteUsage } from "@/lib/sessions";
import { systemAppNames } from "@/lib/system-apps";
import { buildTimelinePoints, type TimelineRow } from "@/lib/timeline";
import type { DashboardSummary } from "@/lib/types";

// Caps how much detail the page renders for long ranges.
const MAX_SESSIONS = 300;
const MAX_OVERLAPS = 100;
const TOP_APPS = 8;

type Bounds = { start_at: string; start_day: string; today: string };

type TotalsRow = {
  device_id: string;
  last_seen_at: string;
  active_seconds: string;
  media_seconds: string;
  idle_seconds: string;
  locked_seconds: string;
};

type MinuteRow = { epoch: number; app_name: string; seconds: number };

// Neon returns untyped rows; this narrows a query's rows to the shape selected.
async function rows<T>(query: PromiseLike<Array<Record<string, unknown>>>): Promise<T[]> {
  return (await query) as T[];
}

const systemNamesParam = () => systemAppNames.map((name) => name.toLowerCase());

// True for rows without a listed app; `names` is the parameter holding the system names.
const hiddenAppCondition = (names: string) => `(app_name IS NULL
  OR lower(app_name) = ANY(${names}::text[])
  OR EXISTS (SELECT 1 FROM excluded_apps excluded WHERE excluded.app_name = activity_segments.app_name))`;

// Rows that should appear as named apps. Queries using it take [deviceId, rangeStart, systemNames].
const visibleAppFilter = `device_id = $1 AND started_at >= $2::timestamptz AND NOT ${hiddenAppCondition("$3")}`;

const toMinuteUsage = (row: MinuteRow): MinuteUsage => ({
  startedAt: new Date(Number(row.epoch) * 1000).toISOString(),
  app: row.app_name,
  seconds: Number(row.seconds),
});

export async function getSummary(range: RangeKey): Promise<DashboardSummary | null> {
  if (!process.env.DATABASE_URL) return null;
  await ensureSchema();
  const sql = database();
  const timeZone = process.env.DISPLAY_TIME_ZONE || "UTC";

  const [bounds] = await sql.query(
    `SELECT ${rangeStartSql(range)}::text AS start_at,
      (${rangeStartSql(range)} AT TIME ZONE $1)::date::text AS start_day,
      (NOW() AT TIME ZONE $1)::date::text AS today`,
    [timeZone],
  ) as Bounds[];

  const totals = await sql.query(
    `SELECT device_id, MAX(received_at)::text AS last_seen_at,
      COALESCE(SUM(duration_seconds) FILTER (WHERE state = 'active'), 0)::text AS active_seconds,
      COALESCE(SUM(duration_seconds) FILTER (WHERE state = 'media'), 0)::text AS media_seconds,
      COALESCE(SUM(duration_seconds) FILTER (WHERE state = 'idle'), 0)::text AS idle_seconds,
      COALESCE(SUM(duration_seconds) FILTER (WHERE state = 'locked'), 0)::text AS locked_seconds
    FROM activity_segments
    WHERE started_at >= $1::timestamptz
    GROUP BY device_id ORDER BY MAX(received_at) DESC LIMIT 1`,
    [bounds.start_at],
  ) as TotalsRow[];
  if (!totals[0]) return null;
  const deviceId = totals[0].device_id;
  const appParams = [deviceId, bounds.start_at, systemNamesParam()];

  const [timelineRows, apps, foregroundRows, backgroundRows, hiddenApps] = await Promise.all([
    rows<TimelineRow>(sql.query(
      `SELECT ${range === "day"
        ? "EXTRACT(HOUR FROM started_at AT TIME ZONE $1)::int::text"
        : "(started_at AT TIME ZONE $1)::date::text"} AS bucket,
        state,
        CASE WHEN ${hiddenAppCondition("$4")} THEN NULL ELSE app_name END AS app,
        SUM(duration_seconds)::int AS seconds
      FROM activity_segments
      WHERE device_id = $2 AND started_at >= $3::timestamptz AND state IN ('active', 'media', 'idle')
      GROUP BY 1, 2, 3`,
      [timeZone, deviceId, bounds.start_at, systemNamesParam()],
    )),
    rows<{ name: string; seconds: number }>(sql.query(
      `SELECT app_name AS name, SUM(duration_seconds)::int AS seconds
      FROM activity_segments
      WHERE state IN ('active', 'media') AND ${visibleAppFilter}
      GROUP BY 1 ORDER BY 2 DESC LIMIT ${TOP_APPS}`,
      appParams,
    )),
    rows<MinuteRow>(sql.query(
      `SELECT EXTRACT(EPOCH FROM started_at)::float8 AS epoch, app_name, SUM(duration_seconds)::int AS seconds
      FROM activity_segments
      WHERE state IN ('active', 'media') AND ${visibleAppFilter}
      GROUP BY 1, 2`,
      appParams,
    )),
    rows<MinuteRow>(sql.query(
      `SELECT EXTRACT(EPOCH FROM started_at)::float8 AS epoch, app_name, SUM(duration_seconds)::int AS seconds
      FROM activity_segments
      WHERE state = 'background' AND ${visibleAppFilter}
      GROUP BY 1, 2`,
      appParams,
    )),
    rows<{ app_name: string }>(sql`SELECT app_name FROM excluded_apps ORDER BY app_name`),
  ]);

  const used = Number(totals[0].active_seconds) + Number(totals[0].media_seconds);
  const foreground = foregroundRows.map(toMinuteUsage);
  return {
    range,
    timeZone,
    deviceId,
    lastSeenAt: totals[0].last_seen_at,
    activeSeconds: Number(totals[0].active_seconds),
    mediaSeconds: Number(totals[0].media_seconds),
    idleSeconds: Number(totals[0].idle_seconds),
    lockedSeconds: Number(totals[0].locked_seconds),
    timeline: buildTimelinePoints(range, { startDay: bounds.start_day, today: bounds.today }, timelineRows),
    apps: apps.map((app) => ({ ...app, seconds: Number(app.seconds), percent: used ? Number(app.seconds) / used * 100 : 0 })),
    hiddenApps: hiddenApps.map((app) => app.app_name),
    sessions: buildSessions(foreground).slice(0, MAX_SESSIONS),
    overlaps: buildOverlaps(foreground, backgroundRows.map(toMinuteUsage)).slice(0, MAX_OVERLAPS),
  };
}

