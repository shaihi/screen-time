import assert from "node:assert/strict";
import { test } from "node:test";
import { categories, categoryOf } from "../lib/categories.ts";
import { averageLinePosition, buildTimelinePoints, realUseForPoint } from "../lib/timeline.ts";

test("known apps map to their category", () => {
  assert.equal(categoryOf("Roblox"), "gaming");
  assert.equal(categoryOf("Minecraft Launcher"), "gaming");
  assert.equal(categoryOf("WhatsApp"), "social");
  assert.equal(categoryOf("Netflix"), "video");
  assert.equal(categoryOf("Spotify"), "music");
  assert.equal(categoryOf("Google Chrome"), "web");
  assert.equal(categoryOf("Visual Studio Code"), "productivity");
  assert.equal(categoryOf("ChatGPT"), "productivity");
  assert.equal(categoryOf("Some Tool"), "other");
});

test("every category is listed once, other last", () => {
  assert.equal(new Set(categories).size, categories.length);
  assert.equal(categories.at(-1), "other");
});

test("day points split each hour by app, grouped by category, and keep idle apart", () => {
  const points = buildTimelinePoints("day", { startDay: "2026-09-17", today: "2026-09-17" }, [
    { bucket: "9", state: "active", app: "Google Chrome", seconds: 100 },
    { bucket: "9", state: "active", app: "Roblox", seconds: 50 },
    { bucket: "9", state: "media", app: "Roblox", seconds: 10 },
    { bucket: "9", state: "active", app: null, seconds: 5 },
    { bucket: "9", state: "idle", app: null, seconds: 30 },
    { bucket: "9", state: "idle", app: "Roblox", seconds: 200 },
    { bucket: "9", state: "idle", app: "ChatGPT", seconds: 20 },
    { bucket: "9", state: "locked", app: null, seconds: 99 },
    { bucket: "30", state: "active", app: "Roblox", seconds: 99 },
  ]);
  assert.equal(points.length, 24);
  assert.equal(points[9].idle, 250);
  assert.deepEqual(points[9].idleApps, [{ app: "Roblox", seconds: 200 }, { app: "ChatGPT", seconds: 20 }]);
  assert.deepEqual(points[10].idleApps, []);
  assert.deepEqual(points[9].segments, [
    { app: "Roblox", category: "gaming", seconds: 60 },
    { app: "Google Chrome", category: "web", seconds: 100 },
    { app: "Other apps", category: "other", seconds: 5 },
  ]);
  assert.deepEqual(points[10].segments, []);
});

test("week points are one per day", () => {
  const points = buildTimelinePoints("week", { startDay: "2026-09-13", today: "2026-09-15" }, [
    { bucket: "2026-09-14", state: "active", app: "Discord", seconds: 20 },
  ]);
  assert.deepEqual(points.map((point) => point.key), ["2026-09-13", "2026-09-14", "2026-09-15"]);
  assert.deepEqual(points[1].segments, [{ app: "Discord", category: "social", seconds: 20 }]);
  assert.match(points[1].title, /^Mon 14 Sept?$/);
});

test("weekly average line is positioned against the tallest day and stays in the chart", () => {
  assert.equal(averageLinePosition(7_200, 14_400), 50);
  assert.equal(averageLinePosition(18_000, 14_400), 100);
  assert.equal(averageLinePosition(0, 14_400), 0);
  assert.equal(averageLinePosition(3_600, 0), 0);
});

test("daily usage labels include active and media time but exclude idle time", () => {
  const [point] = buildTimelinePoints("week", { startDay: "2026-09-13", today: "2026-09-13" }, [
    { bucket: "2026-09-13", state: "active", app: "Google Chrome", seconds: 3_000 },
    { bucket: "2026-09-13", state: "media", app: "Google Chrome", seconds: 600 },
    { bucket: "2026-09-13", state: "idle", app: "Google Chrome", seconds: 2_400 },
  ]);
  assert.equal(realUseForPoint(point), 3_600);
});
