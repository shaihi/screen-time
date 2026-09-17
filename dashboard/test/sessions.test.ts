import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOverlaps, buildSessions } from "../lib/sessions.ts";

const at = (time: string) => `2026-09-17T${time}:00.000Z`;

test("consecutive minutes of one app form a single session", () => {
  const sessions = buildSessions([
    { startedAt: at("10:00"), app: "Roblox", seconds: 30 },
    { startedAt: at("10:01"), app: "Roblox", seconds: 60 },
    { startedAt: at("10:02"), app: "Roblox", seconds: 20 },
  ]);
  assert.deepEqual(sessions, [{ app: "Roblox", start: at("10:00"), end: at("10:03"), seconds: 110 }]);
});

test("any skipped minute starts a new session, newest first", () => {
  const sessions = buildSessions([
    { startedAt: at("10:00"), app: "Roblox", seconds: 60 },
    { startedAt: at("10:02"), app: "Roblox", seconds: 15 },
  ]);
  assert.deepEqual(sessions.map((session) => session.start), [at("10:02"), at("10:00")]);
  assert.equal(sessions.reduce((sum, session) => sum + session.seconds, 0), 75);
});

test("interleaved apps keep separate sessions", () => {
  const sessions = buildSessions([
    { startedAt: at("10:00"), app: "Roblox", seconds: 40 },
    { startedAt: at("10:00"), app: "ChatGPT", seconds: 20 },
    { startedAt: at("10:01"), app: "Roblox", seconds: 60 },
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions.find((session) => session.app === "Roblox")?.seconds, 100);
  assert.equal(sessions.find((session) => session.app === "ChatGPT")?.end, at("10:01"));
});

test("empty and zero-second rows produce no sessions", () => {
  assert.deepEqual(buildSessions([]), []);
  assert.deepEqual(buildSessions([{ startedAt: at("10:00"), app: "Roblox", seconds: 0 }]), []);
});

test("background media overlapping another app is reported with the shorter duration", () => {
  const overlaps = buildOverlaps(
    [
      { startedAt: at("10:00"), app: "Roblox", seconds: 50 },
      { startedAt: at("10:01"), app: "Roblox", seconds: 60 },
    ],
    [
      { startedAt: at("10:00"), app: "Spotify", seconds: 30 },
      { startedAt: at("10:01"), app: "Spotify", seconds: 60 },
    ],
  );
  assert.deepEqual(overlaps, [
    { background: "Spotify", foreground: "Roblox", start: at("10:00"), end: at("10:02"), seconds: 90 },
  ]);
});

test("media from the app in use or in a different minute is not an overlap", () => {
  const overlaps = buildOverlaps(
    [{ startedAt: at("10:00"), app: "Google Chrome", seconds: 60 }],
    [
      { startedAt: at("10:00"), app: "Google Chrome", seconds: 60 },
      { startedAt: at("10:05"), app: "Spotify", seconds: 60 },
    ],
  );
  assert.deepEqual(overlaps, []);
});
