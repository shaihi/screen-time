type Point = { hour: number; active: number; media: number; idle: number };

export function Timeline({ points }: { points: Point[] }) {
  const max = Math.max(1, ...points.map((point) => point.active + point.media + point.idle));
  return (
    <div className="timeline" aria-label="Usage by hour">
      {points.map((point) => {
        const activeHeight = (point.active / max) * 100;
        const mediaHeight = (point.media / max) * 100;
        const idleHeight = (point.idle / max) * 100;
        return (
          <div className="timeline-column" key={point.hour} title={`${String(point.hour).padStart(2, "0")}:00`}>
            <div className="bar-shell">
              <span className="bar idle" style={{ height: `${idleHeight}%` }} />
              <span className="bar media" style={{ height: `${mediaHeight}%` }} />
              <span className="bar active" style={{ height: `${activeHeight}%` }} />
            </div>
            {point.hour % 3 === 0 ? <small>{String(point.hour).padStart(2, "0")}</small> : <small>&nbsp;</small>}
          </div>
        );
      })}
    </div>
  );
}

