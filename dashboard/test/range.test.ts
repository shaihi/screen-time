import assert from "node:assert/strict";
import { test } from "node:test";
import { dayLabel, daysBetween, parseRange, rangeStartSql } from "../lib/range.ts";

test("parseRange accepts known ranges and defaults to day", () => {
  assert.equal(parseRange("week"), "week");
  assert.equal(parseRange("month"), "month");
  assert.equal(parseRange("year"), "day");
  assert.equal(parseRange(undefined), "day");
  assert.equal(parseRange(["week"]), "day");
});

test("rangeStartSql only references the time zone parameter", () => {
  for (const range of ["day", "week", "month"] as const) {
    const sql = rangeStartSql(range);
    assert.match(sql, /AT TIME ZONE \$1\)$/);
    assert.doesNotMatch(sql, /\$[02-9]/);
  }
});

test("daysBetween is inclusive and crosses month ends", () => {
  assert.deepEqual(daysBetween("2026-08-30", "2026-09-02"), ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  assert.deepEqual(daysBetween("2026-09-17", "2026-09-17"), ["2026-09-17"]);
  assert.deepEqual(daysBetween("2026-09-18", "2026-09-17"), []);
});

test("dayLabel shows weekdays for weeks and sparse day numbers for months", () => {
  assert.equal(dayLabel("2026-09-13", "week"), "Sun");
  assert.equal(dayLabel("2026-09-01", "month"), "1");
  assert.equal(dayLabel("2026-09-10", "month"), "10");
  assert.equal(dayLabel("2026-09-11", "month"), "");
});
