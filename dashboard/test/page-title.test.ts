import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPageTitle } from "../lib/page-title.ts";

test("browser suffix is removed even inside right-to-left marks", () => {
  assert.equal(cleanPageTitle("‪W family Wait \u{1f976} - YouTube - Google Chrome‬"), "W family Wait \u{1f976} - YouTube");
  assert.equal(cleanPageTitle("‫שלום - Google Chrome‬"), "שלום");
  assert.equal(cleanPageTitle("Home — Mozilla Firefox"), "Home");
  assert.equal(cleanPageTitle("YouTube and 3 more pages - Personal - Microsoft​ Edge"), "YouTube");
});

test("titles that only name the browser or an empty tab are dropped", () => {
  assert.equal(cleanPageTitle("‪YouTube - Google Chrome‬"), "YouTube");
  assert.equal(cleanPageTitle("Google Chrome"), null);
  assert.equal(cleanPageTitle("New Tab"), null);
  assert.equal(cleanPageTitle("   "), null);
  assert.equal(cleanPageTitle(null), null);
});

test("a title with a dash in the middle keeps it, and length is capped", () => {
  assert.equal(cleanPageTitle("Roblox - Wikipedia - Google Chrome"), "Roblox - Wikipedia");
  assert.equal(cleanPageTitle("x".repeat(400))?.length, 300);
});
