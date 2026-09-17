import { AutoRefresh } from "@/app/components/auto-refresh";
import { Timeline } from "@/app/components/timeline";
import { database, ensureSchema } from "@/lib/db";
import { formatDuration, formatLastSeen } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type TotalsRow = {
  device_id: string;
  last_seen_at: string;
  active_seconds: string;
  media_seconds: string;
  idle_seconds: string;
  locked_seconds: string;
};

async function getSummary(): Promise<DashboardSummary | null> {
  if (!process.env.DATABASE_URL) return null;
  await ensureSchema();
  const sql = database();
  const timeZone = process.env.DISPLAY_TIME_ZONE || "UTC";
  const totals = await sql.query(
    `SELECT device_id, MAX(received_at)::text AS last_seen_at,
      COALESCE(SUM(duration_seconds) FILTER (WHERE state = 'active'), 0)::text AS active_seconds,
      COALESCE(SUM(duration_seconds) FILTER (WHERE state = 'media'), 0)::text AS media_seconds,
      COALESCE(SUM(duration_seconds) FILTER (WHERE state = 'idle'), 0)::text AS idle_seconds,
      COALESCE(SUM(duration_seconds) FILTER (WHERE state = 'locked'), 0)::text AS locked_seconds
    FROM activity_segments
    WHERE started_at >= (date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1)
      AND started_at < ((date_trunc('day', NOW() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1)
    GROUP BY device_id ORDER BY MAX(received_at) DESC LIMIT 1`,
    [timeZone],
  ) as TotalsRow[];
  if (!totals[0]) return null;
  const deviceId = totals[0].device_id;

  const hourly = await sql.query(
    `SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE $1)::int AS hour, state,
      SUM(duration_seconds)::int AS seconds
    FROM activity_segments
    WHERE device_id = $2
      AND started_at >= (date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1)
      AND started_at < ((date_trunc('day', NOW() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1)
    GROUP BY 1, 2 ORDER BY 1`,
    [timeZone, deviceId],
  ) as Array<{ hour: number; state: string; seconds: number }>;

  const apps = await sql.query(
    `SELECT COALESCE(app_name, 'Unknown') AS name, SUM(duration_seconds)::int AS seconds
    FROM activity_segments
    WHERE device_id = $2 AND state IN ('active', 'media')
      AND NOT EXISTS (
        SELECT 1 FROM excluded_apps excluded
        WHERE excluded.app_name = COALESCE(activity_segments.app_name, 'Unknown')
      )
      AND started_at >= (date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1)
      AND started_at < ((date_trunc('day', NOW() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1)
    GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    [timeZone, deviceId],
  ) as Array<{ name: string; seconds: number }>;

  const hiddenApps = await sql`SELECT app_name FROM excluded_apps ORDER BY app_name` as Array<{ app_name: string }>;

  const points = Array.from({ length: 24 }, (_, hour) => ({ hour, active: 0, media: 0, idle: 0 }));
  for (const row of hourly) {
    if (row.state === "active" || row.state === "media" || row.state === "idle") {
      points[row.hour][row.state] = Number(row.seconds);
    }
  }
  const used = Number(totals[0].active_seconds) + Number(totals[0].media_seconds);
  return {
    deviceId,
    lastSeenAt: totals[0].last_seen_at,
    activeSeconds: Number(totals[0].active_seconds),
    mediaSeconds: Number(totals[0].media_seconds),
    idleSeconds: Number(totals[0].idle_seconds),
    lockedSeconds: Number(totals[0].locked_seconds),
    timeline: points,
    apps: apps.map((app) => ({ ...app, seconds: Number(app.seconds), percent: used ? Number(app.seconds) / used * 100 : 0 })),
    hiddenApps: hiddenApps.map((app) => app.app_name),
  };
}

export default async function Home() {
  const summary = await getSummary();
  const usedSeconds = summary ? summary.activeSeconds + summary.mediaSeconds : 0;
  const observedSeconds = summary ? usedSeconds + summary.idleSeconds : 0;
  const focusPercent = observedSeconds ? Math.round(usedSeconds / observedSeconds * 100) : 0;

  return (
    <main>
      <AutoRefresh />
      <header>
        <div className="brand"><span className="brand-mark" /> Screen Time</div>
        <div className="live"><span /> Live · refreshes every minute</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">TODAY · {summary?.deviceId || "WAITING FOR DEVICE"}</p>
          <h1>{summary ? formatDuration(usedSeconds) : "—"}</h1>
          <p className="subtitle">meaningful screen time</p>
        </div>
        <div className="connection">
          <span className={summary ? "status-dot online" : "status-dot"} />
          <div><strong>{summary ? "Agent connected" : "No data received"}</strong><small>{formatLastSeen(summary?.lastSeenAt || null)}</small></div>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric lime"><p>Hands-on</p><strong>{formatDuration(summary?.activeSeconds || 0)}</strong><small>keyboard & mouse activity</small></article>
        <article className="metric violet"><p>Watching</p><strong>{formatDuration(summary?.mediaSeconds || 0)}</strong><small>video or media playback</small></article>
        <article className="metric slate"><p>Idle</p><strong>{formatDuration(summary?.idleSeconds || 0)}</strong><small>screen open, no activity</small></article>
        <article className="metric ring-card"><div className="ring" style={{ "--progress": `${focusPercent * 3.6}deg` } as React.CSSProperties}><span>{focusPercent}%</span></div><div><p>Engagement</p><small>active vs. observed</small></div></article>
      </section>

      <section className="content-grid">
        <article className="panel timeline-panel">
          <div className="panel-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Daily rhythm</h2></div><div className="legend"><span className="key active" /> Active <span className="key media" /> Media <span className="key idle" /> Idle</div></div>
          <Timeline points={summary?.timeline || Array.from({ length: 24 }, (_, hour) => ({ hour, active: 0, media: 0, idle: 0 }))} />
        </article>
        <article className="panel app-panel">
          <div className="panel-heading"><div><p className="eyebrow">APPS</p><h2>Where time went</h2></div></div>
          <div className="app-list">
            {summary?.apps.length ? summary.apps.map((app, index) => (
              <div className="app-row" key={app.name}>
                <span className="app-rank">{String(index + 1).padStart(2, "0")}</span>
                <div className="app-name"><strong>{app.name}</strong><span><i style={{ width: `${app.percent}%` }} /></span></div>
                <time>{formatDuration(app.seconds)}</time>
                <form action="/api/settings/excluded-apps" method="post">
                  <input type="hidden" name="action" value="hide" />
                  <input type="hidden" name="appName" value={app.name} />
                  <button className="hide-app" type="submit" title={`Hide ${app.name} from this list`} aria-label={`Hide ${app.name} from this list`}>×</button>
                </form>
              </div>
            )) : <p className="empty">Usage will appear after the first five-minute upload.</p>}
          </div>
          {summary?.hiddenApps.length ? (
            <details className="hidden-apps">
              <summary>{summary.hiddenApps.length} hidden {summary.hiddenApps.length === 1 ? "app" : "apps"}</summary>
              {summary.hiddenApps.map((app) => (
                <form action="/api/settings/excluded-apps" method="post" key={app}>
                  <input type="hidden" name="action" value="show" />
                  <input type="hidden" name="appName" value={app} />
                  <span>{app}</span><button type="submit">Restore</button>
                </form>
              ))}
            </details>
          ) : null}
        </article>
      </section>
      <footer>Private by design · no screenshots, keystrokes, URLs, or media titles</footer>
    </main>
  );
}
