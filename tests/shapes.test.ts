import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeParts } from "../src/cut/shapes.ts";

/** A side-view animal: oval body, four legs, a neck with a head, a tail. */
function animal(w = 400, h = 300) {
  const a = new Uint8Array(w * h);
  const set = (f: (x: number, y: number) => boolean) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f(x, y)) a[y * w + x] = 255; };
  set((x, y) => ((x - 200) / 100) ** 2 + ((y - 130) / 50) ** 2 <= 1); // body
  for (const lx of [125, 160, 240, 275]) set((x, y) => x >= lx - 9 && x <= lx + 9 && y >= 150 && y <= 280); // legs
  set((x, y) => x >= 280 && x <= 300 && y >= 60 && y <= 110 && x - 280 >= (110 - y) * 0.1); // neck
  set((x, y) => ((x - 305) / 34) ** 2 + ((y - 50) / 26) ** 2 <= 1); // head
  set((x, y) => x >= 50 && x <= 105 && Math.abs(y - (120 - (105 - x) * 0.5)) <= 5); // tail
  return { a, w, h };
}

test("an animal splits into body, legs, head and tail", () => {
  const { a, w, h } = animal();
  const r = shapeParts(a, w, h, 0);
  assert.ok(r);
  const kinds = r.parts.map((p) => p.kind);
  assert.equal(kinds[0], "body");
  assert.equal(kinds.filter((k) => k === "leg").length, 4, JSON.stringify(r.parts));
  assert.ok(kinds.filter((k) => k === "top" || k === "side").length >= 2, "head and tail");

  // legs turn where they meet the body
  for (const p of r.parts.filter((q) => q.kind === "leg")) { assert.equal(p.parent, 0); assert.ok(Math.abs(p.pivot[1] - 165) < 25, `leg pivot ${p.pivot}`); }
  // every solid pixel has a part
  for (let i = 0; i < a.length; i++) if (a[i]) assert.ok(r.labels[i] > 0);
});

test("long legs get a knee with more detail", () => {
  const { a, w, h } = animal();
  const r = shapeParts(a, w, h, 1)!;
  const legs = r.parts.filter((p) => p.kind === "leg");
  assert.equal(legs.filter((p) => p.tip === 1).length, 4);
  for (const lo of legs.filter((p) => p.tip === 1)) assert.equal(r.parts[lo.parent].kind, "leg");
});

test("a plain ball has no parts", () => {
  const w = 200, h = 200, a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - 100) ** 2 + (y - 100) ** 2 < 80 ** 2) a[y * w + x] = 255;
  assert.equal(shapeParts(a, w, h, 1), null);
});
