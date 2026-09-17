import { formatDuration } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types";

export function MetricsPanel({ summary }: { summary: DashboardSummary | null }) {
  const usedSeconds = summary ? summary.activeSeconds + summary.mediaSeconds : 0;
  const observedSeconds = summary ? usedSeconds + summary.idleSeconds : 0;
  const focusPercent = observedSeconds ? Math.round(usedSeconds / observedSeconds * 100) : 0;
  return (
    <div className="metric-grid">
      <article className="metric lime"><p>Hands-on</p><strong>{formatDuration(summary?.activeSeconds || 0)}</strong><small>keyboard & mouse activity</small></article>
      <article className="metric violet"><p>Watching</p><strong>{formatDuration(summary?.mediaSeconds || 0)}</strong><small>video or media playback</small></article>
      <article className="metric slate"><p>Idle</p><strong>{formatDuration(summary?.idleSeconds || 0)}</strong><small>screen open, no activity</small></article>
      <article className="metric ring-card"><div className="ring" style={{ "--progress": `${focusPercent * 3.6}deg` } as React.CSSProperties}><span>{focusPercent}%</span></div><div><p>Engagement</p><small>active vs. observed</small></div></article>
    </div>
  );
}
