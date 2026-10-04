import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReminderMilestones, parseStoredReminderMilestones } from "../lib/reminder-policy.ts";

test("parses editable dashboard milestones into ordered, de-duplicated reminders", () => {
  assert.deepEqual(parseReminderMilestones("90:yellow, 30:blue, 60:blue, 90:red"), [
    { minutes: 30, color: "blue" },
    { minutes: 60, color: "blue" },
    { minutes: 90, color: "red" },
  ]);
});

test("rejects invalid milestone text instead of saving a partial policy", () => {
  assert.throws(() => parseReminderMilestones("30:purple, sixty:blue"), /minutes:color/);
  assert.throws(() => parseReminderMilestones("0:blue"), /between 1 and 1440/);
});

test("stored policies are validated before being returned to an agent", () => {
  assert.deepEqual(parseStoredReminderMilestones([
    { minutes: 30, color: "blue" },
    { minutes: 120, color: "red" },
  ]), [
    { minutes: 30, color: "blue" },
    { minutes: 120, color: "red" },
  ]);
  assert.deepEqual(parseStoredReminderMilestones({ bad: true }), []);
});
