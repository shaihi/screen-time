import assert from "node:assert/strict";
import test from "node:test";
import { dailySchedule, displayControlState, scheduleSummary, secondsLabel } from "../lib/control-ui.ts";

test("daily schedule applies a half-open window to all seven days", () => {
  const windows = dailySchedule("08:30", "21:00");
  assert.equal(windows.length, 7);
  assert.deepEqual(windows[0], { dayOfWeek: 0, startMinute: 510, endMinute: 1260 });
  assert.equal(windows[6].dayOfWeek, 6);
  assert.throws(() => dailySchedule("21:00", "08:00"), /later/);
  assert.throws(() => dailySchedule("25:00", "26:00"), /time/);
});

test("custom schedules are preserved and described rather than silently rewritten", () => {
  assert.equal(scheduleSummary([]), "Any time of day");
  assert.equal(scheduleSummary(dailySchedule("08:00", "21:00")), "Every day, 08:00–21:00");
  assert.equal(scheduleSummary([{ dayOfWeek: 1, startMinute: 600, endMinute: 900 }]), "Custom weekly schedule");
});

test("stale or unacknowledged state never appears as confirmed restriction", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const status = { state: "blocked", appliedRevision: 3, lastSeenAt: "2026-10-15T11:59:50Z" };
  assert.equal(displayControlState(status, 3, now), "Blocked · confirmed");
  assert.equal(displayControlState(status, 4, now), "Waiting for computer");
  assert.equal(displayControlState({ ...status, lastSeenAt: "2026-10-15T11:50:00Z" }, 3, now), "Offline · last reported blocked");
  assert.equal(displayControlState(null, 3, now), "Waiting for first contact");
  assert.equal(displayControlState({ ...status, state: "error" }, 3, now), "Needs attention");
  assert.equal(displayControlState({ ...status, state: "countdown", appliedRevision: 2 }, 3, now), "Closing apps in 30 seconds");
});

test("remaining time handles unlimited, zero, and partial minutes", () => {
  assert.equal(secondsLabel(null), "No daily cap");
  assert.equal(secondsLabel(0), "0 min");
  assert.equal(secondsLabel(61), "2 min");
});
