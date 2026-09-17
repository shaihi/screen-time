import assert from "node:assert/strict";
import { test } from "node:test";
import { formatShortDuration } from "../lib/format.ts";

test("detail durations keep seconds so rows add up", () => {
  assert.equal(formatShortDuration(46), "46s");
  assert.equal(formatShortDuration(60), "1m");
  assert.equal(formatShortDuration(380), "6m 20s");
  assert.equal(formatShortDuration(3900), "1h 5m");
});
