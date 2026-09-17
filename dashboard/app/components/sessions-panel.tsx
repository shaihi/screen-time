"use client";

import { useMemo, useState } from "react";
import { formatClock, formatDay, formatShortDuration } from "@/lib/format";
import type { AppSession } from "@/lib/sessions";

const ALL_APPS = "";

export function SessionsPanel({ sessions, timeZone, showDate }: { sessions: AppSession[]; timeZone: string; showDate: boolean }) {
  const [app, setApp] = useState(ALL_APPS);
  const apps = useMemo(() => [...new Set(sessions.map((session) => session.app))].sort(), [sessions]);
  const visible = app === ALL_APPS ? sessions : sessions.filter((session) => session.app === app);
  const total = visible.reduce((sum, session) => sum + session.seconds, 0);

  return (
    <>
      <div className="panel-heading">
        <div><p className="eyebrow">SESSIONS</p><h2>When each app was used</h2></div>
        {apps.length > 1 ? (
          <select className="app-filter" value={app} onChange={(event) => setApp(event.target.value)} aria-label="Filter by app">
            <option value={ALL_APPS}>All apps</option>
            {apps.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        ) : null}
      </div>
      {visible.length ? (
        <>
          <p className="panel-note">
            {visible.length} {visible.length === 1 ? "session" : "sessions"} · {formatShortDuration(total)} in use.
            From/To are whole minutes; “In use” counts only the seconds the app was actually in front.
          </p>
          <div className="table-scroll">
            <table className="usage-table">
              <thead><tr>{showDate ? <th>Day</th> : null}<th>App</th><th>From</th><th>To</th><th>In use</th></tr></thead>
              <tbody>
                {visible.map((session) => (
                  <tr key={`${session.app}-${session.start}`}>
                    {showDate ? <td>{formatDay(session.start, timeZone)}</td> : null}
                    <td><strong>{session.app}</strong></td>
                    <td>{formatClock(session.start, timeZone)}</td>
                    <td>{formatClock(session.end, timeZone)}</td>
                    <td>{formatShortDuration(session.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="empty">No app sessions in this period.</p>}
    </>
  );
}
