// Browser page titles grouped into visits. Relative imports keep it runnable under `node --test`.
import { buildSessions } from "./sessions.ts";

export type PageMinute = { startedAt: string; app: string; title: string; seconds: number };

export type PageVisit = { app: string; title: string; start: string; end: string; seconds: number };

export type PageTotal = { title: string; apps: string[]; visits: number; seconds: number };

/** Groups each browser + title's minutes into visits, newest first. */
export function buildPageSessions(rows: PageMinute[]): PageVisit[] {
  const sessions = buildSessions(rows.map((row) => ({
    startedAt: row.startedAt,
    app: JSON.stringify([row.app, row.title]),
    seconds: row.seconds,
  })));
  return sessions.map(({ app: key, ...session }) => {
    const [app, title] = JSON.parse(key) as [string, string];
    return { app, title, ...session };
  });
}

/** Time per title across all browsers and visits, largest first. */
export function totalsByPage(visits: PageVisit[]): PageTotal[] {
  const totals = new Map<string, PageTotal>();
  for (const visit of visits) {
    const current = totals.get(visit.title) ?? { title: visit.title, apps: [], visits: 0, seconds: 0 };
    totals.set(visit.title, {
      title: visit.title,
      apps: current.apps.includes(visit.app) ? current.apps : [...current.apps, visit.app].sort(),
      visits: current.visits + 1,
      seconds: current.seconds + visit.seconds,
    });
  }
  return [...totals.values()].sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
}
