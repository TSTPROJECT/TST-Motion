import { test } from "node:test";
import assert from "node:assert/strict";
import { letterCount, letters, pictureAt, baseId } from "../src/model/anim.ts";
import type { Layer } from "../src/model/types.ts";

test("Thai letters keep their vowels and tone marks", () => {
  assert.deepEqual(letters("ก๊ก"), ["ก๊", "ก"]);
  assert.equal(letterCount("ก๊ก\nขา"), 4);
});

test("typewriter shows a growing share of the letters", () => {
  const l: Layer = {
    id: "t", name: "t", asset: "A", parent: null, px: 0, py: 0, base: { x: 0, y: 0, rot: 0, sx: 1, sy: 1, o: 1 },
    tracks: { type: [{ f: 0, v: 0, e: "linear" }, { f: 10, v: 1, e: "linear" }] }, visible: true, locked: false,
    text: { s: "abcd", font: "x", size: 10, bold: false, italic: false, color: "#fff", align: "left", line: 1, spacing: 0, stroke: 0, strokeColor: "#000", box: 0, boxColor: "#000", boxRound: 0 },
  };
  assert.equal(pictureAt(l, 0), null);
  assert.equal(pictureAt(l, 5), "A#2");
  assert.equal(pictureAt(l, 10), "A");
  assert.equal(baseId("A#2"), "A");
});
