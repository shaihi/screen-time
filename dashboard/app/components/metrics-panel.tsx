"use client";

import { categoryOf } from "@/lib/categories";
import { formatDuration, formatShortDuration } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types";
import { headline, usageBreakdown } from "@/lib/usage";
import { UnattendedSwitch, useUsageMode } from "@/app/components/usage-mode";

const empty = { activeSeconds: 0, mediaSeconds: 0, idleSeconds: 0, leftRunningSeconds: 0 };

/** Leads with the three numbers that answer "what was the real usage?": real use, unattended, idle. */
export function MetricsPanel({ summary }: { summary: DashboardSummary | null }) {
  const { include } = useUsageMode();
  const usage = usageBreakdown(summary ?? empty);
  const top = headline(usage, include);
  const topLeftRunning = summary?.leftRunning[0];

  return (
    <div className="usage-summary">
      <div className="usage-bar-row">
      <div
        className="usage-bar"
        role="img"
        aria-label={`Of ${formatDuration(usage.screenOn)} with the screen on: ${formatDuration(usage.realUse)} real use, ${formatDuration(usage.unattended)} unattended, ${formatDuration(usage.idle)} idle`}
      >
        <span className="seg real" style={{ flexGrow: usage.realUse }} />
        <span className={include ? "seg unattended counted" : "seg unattended"} style={{ flexGrow: usage.unattended }} />
        <span className="seg idle" style={{ flexGrow: usage.idle }} />
      </div>
      <UnattendedSwitch />
      </div>

      <div className="metric-grid">
        <article className="metric lime">
          <p>Real use</p>
          <strong>{formatDuration(usage.realUse)}</strong>
          <small>
            hands-on {formatShortDuration(summary?.activeSeconds || 0)}
            {summary?.mediaSeconds ? ` · watching ${formatShortDuration(summary.mediaSeconds)}` : ""}
          </small>
        </article>

        <article className={include ? "metric warn counted" : "metric warn"}>
          <p>Unattended on{include ? " · counted" : ""}</p>
          <strong>{formatDuration(usage.unattended)}</strong>
          <small>
            {topLeftRunning
              ? <><i className={`swatch cat-${categoryOf(topLeftRunning.name)}`} />{topLeftRunning.name} left running, no input</>
              : "nothing left running"}
          </small>
        </article>

        <article className="metric slate">
          <p>Idle</p>
          <strong>{formatDuration(usage.idle)}</strong>
          <small>screen on, nothing in front</small>
        </article>

        <article className="metric ring-card">
          <div className="ring" style={{ "--progress": `${top.percent * 3.6}deg` } as React.CSSProperties}>
            <span>{top.percent}%</span>
          </div>
          <div><p>{include ? "Real use + unattended" : "Real use"}</p><small>of {formatDuration(usage.screenOn)} with the screen on</small></div>
        </article>
      </div>
    </div>
  );
}
