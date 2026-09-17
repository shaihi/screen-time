import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPageSessions, totalsByPage } from "../lib/pages.ts";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 17, 14, minute)).toISOString();

test("back-to-back minutes on the same page form one visit, per browser", () => {
  const visits = buildPageSessions([
    { startedAt: at(0), app: "Google Chrome", title: "YouTube", seconds: 50 },
    { startedAt: at(1), app: "Google Chrome", title: "YouTube", seconds: 30 },
    { startedAt: at(1), app: "Firefox", title: "YouTube", seconds: 10 },
    { startedAt: at(5), app: "Google Chrome", title: "YouTube", seconds: 5 },
  ]);
  assert.deepEqual(visits, [
    { app: "Google Chrome", title: "YouTube", start: at(5), end: at(6), seconds: 5 },
    { app: "Firefox", title: "YouTube", start: at(1), end: at(2), seconds: 10 },
    { app: "Google Chrome", title: "YouTube", start: at(0), end: at(2), seconds: 80 },
  ]);
});

test("titles containing tabs stay intact", () => {
  const [visit] = buildPageSessions([{ startedAt: at(0), app: "Firefox", title: "a\tb", seconds: 3 }]);
  assert.equal(visit.title, "a\tb");
});

test("totals add up each title across browsers and visits, largest first", () => {
  const totals = totalsByPage([
    { app: "Google Chrome", title: "Docs", start: at(0), end: at(1), seconds: 20 },
    { app: "Firefox", title: "YouTube", start: at(0), end: at(1), seconds: 30 },
    { app: "Google Chrome", title: "YouTube", start: at(3), end: at(4), seconds: 15 },
  ]);
  assert.deepEqual(totals, [
    { title: "YouTube", apps: ["Firefox", "Google Chrome"], visits: 2, seconds: 45 },
    { title: "Docs", apps: ["Google Chrome"], visits: 1, seconds: 20 },
  ]);
});
