import { formatClock, formatDay, formatShortDuration } from "@/lib/format";
import type { OverlapPeriod } from "@/lib/sessions";

export function OverlapsPanel({ overlaps, timeZone, showDate }: { overlaps: OverlapPeriod[]; timeZone: string; showDate: boolean }) {
  return (
    <>
      <div className="panel-heading"><div><p className="eyebrow">OVERLAP</p><h2>Used at the same time</h2></div></div>
      {overlaps.length ? (
        <div className="table-scroll">
          <table className="usage-table">
            <thead><tr>{showDate ? <th>Day</th> : null}<th>Playing in background</th><th>While using</th><th>From</th><th>To</th><th>Together</th></tr></thead>
            <tbody>
              {overlaps.map((overlap) => (
                <tr key={`${overlap.background}-${overlap.foreground}-${overlap.start}`}>
                  {showDate ? <td>{formatDay(overlap.start, timeZone)}</td> : null}
                  <td><strong className="violet-text">{overlap.background}</strong></td>
                  <td><strong>{overlap.foreground}</strong></td>
                  <td>{formatClock(overlap.start, timeZone)}</td>
                  <td>{formatClock(overlap.end, timeZone)}</td>
                  <td>{formatShortDuration(overlap.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          No overlapping use in this period. Windows gives keyboard focus to one window at a time, so overlap here means
          audio or video playing in one app while another app is in use.
        </p>
      )}
    </>
  );
}
