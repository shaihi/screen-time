import assert from "node:assert/strict";
import { test } from "node:test";
import { headline, usageBreakdown } from "../lib/usage.ts";

const totals = { activeSeconds: 3000, mediaSeconds: 600, idleSeconds: 5400, leftRunningSeconds: 4000 };

test("real use is hands-on plus watching; unattended is time left running", () => {
  const usage = usageBreakdown(totals);
  assert.equal(usage.realUse, 3600);
  assert.equal(usage.unattended, 4000);
  assert.equal(usage.idle, 1400);
  assert.equal(usage.screenOn, 9000);
  assert.equal(usage.realUsePercent, 40);
});

test("left running never exceeds idle, and the parts always add up to screen on", () => {
  const usage = usageBreakdown({ ...totals, leftRunningSeconds: 9999 });
  assert.equal(usage.unattended, 5400);
  assert.equal(usage.idle, 0);
  assert.equal(usage.realUse + usage.unattended + usage.idle, usage.screenOn);
});

test("no data reads as zero, not NaN", () => {
  const usage = usageBreakdown({ activeSeconds: 0, mediaSeconds: 0, idleSeconds: 0, leftRunningSeconds: 0 });
  assert.equal(usage.realUsePercent, 0);
  assert.deepEqual(usage.shares, { realUse: 0, unattended: 0, idle: 0 });
});

test("shares are percentages of screen-on time", () => {
  const { shares } = usageBreakdown({ activeSeconds: 1800, mediaSeconds: 0, idleSeconds: 1800, leftRunningSeconds: 900 });
  assert.deepEqual(shares, { realUse: 50, unattended: 25, idle: 25 });
});

test("the unattended switch changes the headline number and its share", () => {
  const usage = usageBreakdown(totals);
  assert.deepEqual(headline(usage, false), { seconds: 3600, percent: 40, label: "real use" });
  assert.deepEqual(headline(usage, true), { seconds: 7600, percent: 84, label: "real use + unattended" });
});
