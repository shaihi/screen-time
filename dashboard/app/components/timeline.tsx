import type { TimelinePoint } from "@/lib/types";

export function Timeline({ points, label }: { points: TimelinePoint[]; label: string }) {
  const max = Math.max(1, ...points.map((point) => point.active + point.media + point.idle));
  return (
    <div className="timeline" aria-label={label} style={{ gridTemplateColumns: `repeat(${points.length}, 1fr)` }}>
      {points.map((point) => {
        const activeHeight = (point.active / max) * 100;
        const mediaHeight = (point.media / max) * 100;
        const idleHeight = (point.idle / max) * 100;
        return (
          <div className="timeline-column" key={point.key} title={point.title}>
            <div className="bar-shell">
              <span className="bar idle" style={{ height: `${idleHeight}%` }} />
              <span className="bar media" style={{ height: `${mediaHeight}%` }} />
              <span className="bar active" style={{ height: `${activeHeight}%` }} />
            </div>
            <small>{point.label || " "}</small>
          </div>
        );
      })}
    </div>
  );
}
