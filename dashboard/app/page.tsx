import { AppsPanel } from "@/app/components/apps-panel";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { DashboardBoard, type BoardPanel } from "@/app/components/dashboard-board";
import { MetricsPanel } from "@/app/components/metrics-panel";
import { OverlapsPanel } from "@/app/components/overlaps-panel";
import { RangeShell } from "@/app/components/range-shell";
import { SessionsPanel } from "@/app/components/sessions-panel";
import { Timeline } from "@/app/components/timeline";
import { formatDuration, formatLastSeen } from "@/lib/format";
import { parseRange, rangeLabels } from "@/lib/range";
import { getSummary } from "@/lib/summary";
import { agentOfflineAfterMinutes } from "@/lib/system-apps";

export const dynamic = "force-dynamic";

function isOnline(lastSeenAt: string | null) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < agentOfflineAfterMinutes * 60_000;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const range = parseRange((await searchParams).range);
  const summary = await getSummary(range);
  const usedSeconds = summary ? summary.activeSeconds + summary.mediaSeconds : 0;
  const online = isOnline(summary?.lastSeenAt || null);
  const timeZone = summary?.timeZone || "UTC";
  const showDate = range !== "day";

  const panels: BoardPanel[] = [
    { id: "metrics", title: "Totals", wide: true, plain: true, content: <MetricsPanel summary={summary} /> },
    {
      id: "timeline",
      title: "Rhythm",
      wide: false,
      content: (
        <>
          <div className="panel-heading">
            <div><p className="eyebrow">ACTIVITY</p><h2>{range === "day" ? "Daily rhythm" : "Day by day"}</h2></div>
            <div className="legend"><span className="key active" /> Active <span className="key media" /> Media <span className="key idle" /> Idle</div>
          </div>
          {summary
            ? <Timeline points={summary.timeline} label={range === "day" ? "Usage by hour" : "Usage by day"} />
            : <p className="empty">No activity yet.</p>}
        </>
      ),
    },
    { id: "apps", title: "Apps", wide: false, content: <AppsPanel summary={summary} range={range} /> },
    {
      id: "sessions",
      title: "Sessions",
      wide: true,
      content: <SessionsPanel sessions={summary?.sessions || []} timeZone={timeZone} showDate={showDate} />,
    },
    {
      id: "overlaps",
      title: "Overlap",
      wide: true,
      content: <OverlapsPanel overlaps={summary?.overlaps || []} timeZone={timeZone} showDate={showDate} />,
    },
  ];

  return (
    <main>
      <AutoRefresh />
      <header>
        <div className="brand"><span className="brand-mark" /> Screen Time</div>
        <div className="header-actions"><div className="live"><span /> Live · refreshes every minute</div><form action="/api/auth/logout" method="post"><button className="logout" type="submit">Sign out</button></form></div>
      </header>

      <RangeShell range={range}>
      <section className="hero">
        <div>
          <p className="eyebrow">{rangeLabels[range].eyebrow} · {summary?.deviceId || "WAITING FOR DEVICE"}</p>
          <h1>{summary ? formatDuration(usedSeconds) : "—"}</h1>
          <p className="subtitle">meaningful screen time</p>
        </div>
        <div className="connection">
          <span className={online ? "status-dot online" : "status-dot"} />
          <div><strong>{summary ? (online ? "Agent connected" : "Agent offline") : "No data received"}</strong><small>{formatLastSeen(summary?.lastSeenAt || null)}</small></div>
        </div>
      </section>

      <DashboardBoard panels={panels} />
      </RangeShell>
      <footer>Private by design · no screenshots, keystrokes, URLs, or media titles</footer>
    </main>
  );
}
