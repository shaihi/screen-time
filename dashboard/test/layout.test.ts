import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeLayout, movePanel, toggleWidth, type PanelLayout } from "../lib/layout.ts";

const defaults: PanelLayout[] = [
  { id: "a", wide: true },
  { id: "b", wide: false },
  { id: "c", wide: false },
];

test("invalid saved layouts fall back to the defaults", () => {
  assert.deepEqual(mergeLayout(null, defaults), defaults);
  assert.deepEqual(mergeLayout("junk", defaults), defaults);
  assert.deepEqual(mergeLayout([1, { id: 3 }], defaults), defaults);
});

test("saved order and widths are kept, unknown and duplicate panels dropped, new panels appended", () => {
  const saved = [{ id: "c", wide: true }, { id: "gone", wide: true }, { id: "a" }, { id: "c", wide: false }];
  assert.deepEqual(mergeLayout(saved, defaults), [
    { id: "c", wide: true },
    { id: "a", wide: true },
    { id: "b", wide: false },
  ]);
});

test("movePanel moves without mutating the input", () => {
  const moved = movePanel(defaults, "a", 2);
  assert.deepEqual(moved.map((panel) => panel.id), ["b", "c", "a"]);
  assert.deepEqual(defaults.map((panel) => panel.id), ["a", "b", "c"]);
  assert.deepEqual(movePanel(defaults, "c", -5).map((panel) => panel.id), ["c", "a", "b"]);
  assert.equal(movePanel(defaults, "missing", 0), defaults);
});

test("toggleWidth flips only the chosen panel", () => {
  assert.deepEqual(toggleWidth(defaults, "b").map((panel) => panel.wide), [true, true, false]);
  assert.equal(defaults[1].wide, false);
});
