"use client";

import { useEffect, useRef, useState } from "react";
import { categoryLabels } from "@/lib/categories";
import { formatDuration, formatShortDuration } from "@/lib/format";
import { averageLinePosition, realUseForPoint } from "@/lib/timeline";
import type { TimelinePoint } from "@/lib/types";

type Hovered = { column: number; segment: number | "idle" };

/**
 * Stacked bars coloured by app category. Hovering (or tapping) a coloured block shows that app's time
 * in the hour or day; the idle block shows idle time.
 */
export function Timeline({ points, label, averageSeconds }: { points: TimelinePoint[]; label: string; averageSeconds?: number }) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const chart = useRef<HTMLDivElement>(null);

  // A tap outside the chart closes the tooltip on touch screens.
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!chart.current?.contains(event.target as Node)) setHovered(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const totals = points.map((point) => point.idle + point.segments.reduce((sum, segment) => sum + segment.seconds, 0));
  const max = Math.max(1, ...totals);
  const height = (seconds: number) => `${(seconds / max) * 100}%`;
  const averagePosition = averageSeconds === undefined ? null : averageLinePosition(averageSeconds, max);
  const gridStyle = { gridTemplateColumns: `repeat(${points.length}, 1fr)` };

  return (
    <div
      ref={chart}
      className="timeline"
      role="img"
      aria-label={averageSeconds === undefined ? label : `${label}; average use ${formatDuration(averageSeconds)}`}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setHovered(null); }}
    >
      <div className="timeline-plot">
        <div className="timeline-bars" style={gridStyle}>
          {points.map((point, column) => {
            const tip = hovered?.column === column ? tooltipFor(point, hovered.segment) : null;
            const edge = column < 3 ? "start" : column >= points.length - 3 ? "end" : "";
            return (
              <div className="timeline-column" key={point.key}>
                <div className="bar-shell">
                  {point.idle > 0 ? (
                    <span
                      className={`bar idle${tip && hovered?.segment === "idle" ? " hot" : ""}`}
                      style={{ height: height(point.idle) }}
                      onPointerEnter={() => setHovered({ column, segment: "idle" })}
                      onPointerDown={() => setHovered({ column, segment: "idle" })}
                    />
                  ) : null}
                  {point.segments.map((segment, index) => (
                    <span
                      key={segment.app}
                      className={`bar cat-${segment.category}${tip && hovered?.segment === index ? " hot" : ""}`}
                      style={{ height: height(segment.seconds) }}
                      onPointerEnter={() => setHovered({ column, segment: index })}
                      onPointerDown={() => setHovered({ column, segment: index })}
                    />
                  ))}
                  {tip ? (
                    <div className={`chart-tip ${edge}`} role="status" style={{ bottom: `calc(${(tip.top / max) * 100}% + 8px)` }}>
                      <span className="tip-when">{point.title}</span>
                      <strong>{tip.name}</strong>
                      {tip.leftRunning.map((item) => (
                        <span className="tip-row sub" key={item.app}>{item.app} left running<b>{formatShortDuration(item.seconds)}</b></span>
                      ))}
                      <span className="tip-row">
                        {tip.category ? <><i className={`swatch cat-${tip.category}`} />{categoryLabels[tip.category]}</> : "No input, total"}
                        <b>{formatShortDuration(tip.seconds)}</b>
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {averagePosition !== null ? (
          <div className="timeline-average" style={{ bottom: `${averagePosition}%` }}>
            <span>Average use <strong>{formatDuration(averageSeconds!)}</strong></span>
          </div>
        ) : null}
      </div>
      <div className="timeline-labels" style={gridStyle}>
        {points.map((point) => (
          <small className="timeline-label" key={point.key}>
            <span>{point.label || " "}</span>
            {averageSeconds !== undefined ? <b>{formatDuration(realUseForPoint(point))}</b> : null}
          </small>
        ))}
      </div>
    </div>
  );
}

// `top` is the seconds stacked up to the top of the hovered block, so the tooltip sits just above it.
function tooltipFor(point: TimelinePoint, segment: number | "idle") {
  if (segment === "idle") return { name: "Idle", category: null, seconds: point.idle, top: point.idle, leftRunning: point.idleApps.slice(0, 4) };
  const found = point.segments[segment];
  if (!found) return null;
  const top = point.idle + point.segments.slice(0, segment + 1).reduce((sum, item) => sum + item.seconds, 0);
  return { name: found.app, category: found.category, seconds: found.seconds, top, leftRunning: [] };
}

export function TimelineLegend({ points }: { points: TimelinePoint[] }) {
  const present = new Set(points.flatMap((point) => point.segments.map((segment) => segment.category)));
  const shown = (Object.keys(categoryLabels) as Array<keyof typeof categoryLabels>).filter((category) => present.has(category));
  return (
    <div className="legend">
      {shown.map((category) => (
        <span key={category}><i className={`swatch cat-${category}`} />{categoryLabels[category]}</span>
      ))}
      <span><i className="swatch idle" />Idle</span>
    </div>
  );
}
