"use client";

import { useState } from "react";
import { formatClock, formatDay, formatShortDuration } from "@/lib/format";
import type { PageTotal, PageVisit } from "@/lib/pages";

type View = "visits" | "totals";

const matches = (title: string, query: string) => title.toLowerCase().includes(query.trim().toLowerCase());

export function PagesPanel({ visits, totals, timeZone, showDate }: {
  visits: PageVisit[];
  totals: PageTotal[];
  timeZone: string;
  showDate: boolean;
}) {
  const [view, setView] = useState<View>("visits");
  const [query, setQuery] = useState("");
  const shownVisits = visits.filter((visit) => matches(visit.title, query));
  const shownTotals = totals.filter((total) => matches(total.title, query));
  const count = view === "visits" ? shownVisits.length : shownTotals.length;

  return (
    <>
      <div className="panel-heading">
        <div><p className="eyebrow">BROWSER</p><h2>Pages viewed</h2></div>
        {visits.length ? (
          <div className="panel-controls">
            <input
              className="app-filter"
              type="search"
              placeholder="Search titles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search page titles"
            />
            <select className="app-filter" value={view} onChange={(event) => setView(event.target.value as View)} aria-label="View">
              <option value="visits">When</option>
              <option value="totals">Most time</option>
            </select>
          </div>
        ) : null}
      </div>
      {!visits.length ? (
        <p className="empty">No page titles yet. They appear once the Windows agent is updated to 1.3.</p>
      ) : !count ? (
        <p className="empty">No pages match “{query}”.</p>
      ) : (
        <>
          <p className="panel-note">Titles of the browser tab in front, as the browser shows them. Addresses are not recorded.</p>
          <div className="table-scroll">
            {view === "visits" ? (
              <table className="usage-table pages-table">
                <thead><tr>{showDate ? <th>Day</th> : null}<th>Page</th><th>Browser</th><th>From</th><th>To</th><th>In use</th></tr></thead>
                <tbody>
                  {shownVisits.map((visit) => (
                    <tr key={`${visit.app}-${visit.title}-${visit.start}`}>
                      {showDate ? <td>{formatDay(visit.start, timeZone)}</td> : null}
                      <td className="page-title"><strong title={visit.title}>{visit.title}</strong></td>
                      <td>{visit.app}</td>
                      <td>{formatClock(visit.start, timeZone)}</td>
                      <td>{formatClock(visit.end, timeZone)}</td>
                      <td>{formatShortDuration(visit.seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="usage-table pages-table">
                <thead><tr><th>Page</th><th>Browser</th><th>Visits</th><th>In use</th></tr></thead>
                <tbody>
                  {shownTotals.map((total) => (
                    <tr key={total.title}>
                      <td className="page-title"><strong title={total.title}>{total.title}</strong></td>
                      <td>{total.apps.join(", ")}</td>
                      <td>{total.visits}</td>
                      <td>{formatShortDuration(total.seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
