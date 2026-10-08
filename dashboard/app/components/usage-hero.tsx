"use client";

import { formatDuration } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types";
import { averagePerDay, headline, usageBreakdown } from "@/lib/usage";
import { useUsageMode } from "@/app/components/usage-mode";

export function UsageHero({ summary }: { summary: DashboardSummary | null }) {
  const { include } = useUsageMode();
  const usage = usageBreakdown(summary ?? { activeSeconds: 0, mediaSeconds: 0, idleSeconds: 0, leftRunningSeconds: 0 });
  const top = headline(usage, include);
  const dailyAverage = summary?.range === "week" ? averagePerDay(top.seconds, summary.daysInRange) : null;
  return (
    <>
      <h1>{summary ? formatDuration(top.seconds) : "—"}</h1>
      <p className="subtitle">
        {top.label}
        {summary ? <> · {top.percent}% of {formatDuration(usage.screenOn)} with the screen on</> : null}
        {!include && usage.unattended ? <> · {formatDuration(usage.unattended)} unattended</> : null}
      </p>
      {dailyAverage !== null ? <p className="daily-average">Daily average <strong>{formatDuration(dailyAverage)}</strong></p> : null}
    </>
  );
}
