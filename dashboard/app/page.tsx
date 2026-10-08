import { headers } from "next/headers";
import { AppsPanel } from "@/app/components/apps-panel";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { DashboardBoard, type BoardPanel } from "@/app/components/dashboard-board";
import { MetricsPanel } from "@/app/components/metrics-panel";
import { OverlapsPanel } from "@/app/components/overlaps-panel";
import { PagesPanel } from "@/app/components/pages-panel";
import { UsageHero } from "@/app/components/usage-hero";
import { UsageModeProvider } from "@/app/components/usage-mode";
import { RangeShell } from "@/app/components/range-shell";
import { SessionsPanel } from "@/app/components/sessions-panel";
import { Timeline, TimelineLegend } from "@/app/components/timeline";
import { RemindersPanel } from "@/app/components/reminders-panel";
import { formatLastSeen } from "@/lib/format";
import { getHouseholdById } from "@/lib/households";
import { parseRange, parseWeekOffset, rangeLabels } from "@/lib/range";
import { householdIdHeader } from "@/lib/session";
import { getSummary } from "@/lib/summary";
import { averagePerDay } from "@/lib/usage";

import { agentOfflineAfterMinutes } from "@/lib/system-apps";

export const dynamic = "force-dynamic";

function eyebrowFor(range: ReturnType<typeof parseRange>, weekOffset: number, startDay: string | undefined) {
  if (range !== "week" || weekOffset === 0) return rangeLabels[range].eyebrow;
  if (!startDay) return "PAST WEEK";
  const start = new Date(`${startDay}T00:00:00Z`);
  return `WEEK OF ${start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase()}`;
}

function isOnline(lastSeenAt: string | null) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < agentOfflineAfterMinutes * 60_000;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ range?: string | string[]; weekOffset?: string | string[] }> }) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const weekOffset = range === "week" ? parseWeekOffset(params.weekOffset) : 0;
  // proxy.ts (the auth middleware) has already verified the session and set this header;
  // it's never trusted from an unauthenticated request since proxy.ts gates every route.
  const householdId = (await headers()).get(householdIdHeader);
  const household = householdId ? getHouseholdById(householdId) : null;
  const summary = household ? await getSummary(range, household.id, household.deviceIds, weekOffset) : null;
  const online = isOnline(summary?.lastSeenAt || null);
  const timeZone = summary?.timeZone || "UTC";
  const showDate = range !== "day";
  const weeklyAverage = summary && range === "week"
    ? averagePerDay(summary.activeSeconds + summary.mediaSeconds, summary.daysInRange)
    : undefined;

  const panels: BoardPanel[] = [
    { id: "metrics", title: "Real usage", wide: true, plain: true, content: <MetricsPanel summary={summary} /> },
    {
      id: "timeline",
      title: "Rhythm",
      wide: false,
      content: (
        <>
          <div className="panel-heading">
            <div><p className="eyebrow">ACTIVITY</p><h2>{range === "day" ? "Daily rhythm" : "Day by day"}</h2></div>
            {summary ? <TimelineLegend points={summary.timeline} /> : null}
          </div>
          {summary
            ? <Timeline points={summary.timeline} label={range === "day" ? "Usage by hour" : "Usage by day"} averageSeconds={weeklyAverage} />
            : <p className="empty">No activity yet.</p>}
        </>
      ),
    },
    { id: "apps", title: "Apps", wide: false, content: <AppsPanel summary={summary} range={range} /> },
    {
      id: "pages",
      title: "Pages",
      wide: true,
      content: (
        <PagesPanel visits={summary?.pages || []} totals={summary?.pageTotals || []} timeZone={timeZone} showDate={showDate} />
      ),
    },
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
    { id: "reminders", title: "Usage reminders", wide: false, content: <RemindersPanel householdId={household?.id ?? null} /> },
  ];

  return (
    <main>
      <AutoRefresh />
      <header>
        <div className="brand"><span className="brand-mark" /> Screen Time</div>
        <div className="header-actions"><div className="live"><span /> Live · refreshes every minute</div><form action="/api/auth/logout" method="post"><button className="logout" type="submit">Sign out</button></form></div>
      </header>

      <UsageModeProvider>
      <RangeShell range={range} weekOffset={weekOffset}>
      <section className="hero">
        <div>
          <p className="eyebrow">{eyebrowFor(range, weekOffset, summary?.rangeStartDay)} · {summary?.deviceId || "WAITING FOR DEVICE"}</p>
          <UsageHero summary={summary} />
        </div>
        <div className="connection">
          <span className={online ? "status-dot online" : "status-dot"} />
          <div><strong>{summary ? (online ? "Agent connected" : "Agent offline") : "No data received"}</strong><small>{formatLastSeen(summary?.lastSeenAt || null)}</small></div>
        </div>
      </section>

      <DashboardBoard panels={panels} />
      </RangeShell>
      </UsageModeProvider>
      <footer>Private by design · no screenshots, keystrokes, or web addresses</footer>
    </main>
  );
}
