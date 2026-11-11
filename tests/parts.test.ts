import { test } from "node:test";
import assert from "node:assert/strict";
import { planParts, assignParts, cleanLabels, jointOverlap, meeting, seamFill, snapPivot, type Joint } from "../src/cut/parts.ts";

// a person standing with arms out, in a 200×300 picture (COCO joint order)
const J: Joint[] = [
  [100, 40, 0.9], [95, 35, 0.9], [105, 35, 0.9], [90, 38, 0.9], [110, 38, 0.9], // face (left = their left)
  [80, 80, 0.9], [120, 80, 0.9],   // shoulders
  [55, 110, 0.9], [145, 110, 0.9], // elbows
  [30, 140, 0.9], [170, 140, 0.9], // wrists
  [88, 160, 0.9], [112, 160, 0.9], // hips
  [85, 220, 0.9], [115, 220, 0.9], // knees
  [85, 280, 0.9], [115, 280, 0.9], // ankles
];

test("planParts makes the right parts for each detail level", () => {
  assert.equal(planParts(J, 0)!.length, 6);
  assert.equal(planParts(J, 1)!.length, 10);
  const fine = planParts(J, 2)!.map((p) => p.key);
  assert.equal(fine.length, 13);
  assert.ok(fine.includes("part_hair") && fine.includes("part_hand_l"));
  const farm = planParts(J, 1)!.find((p) => p.key === "part_farm_l")!;
  assert.deepEqual(farm.pivot, [55, 110], "forearm turns at the elbow");
  assert.equal(farm.parent, "part_uarm_l");
});

test("planParts gives up without shoulders and copes without legs", () => {
  const noSh = J.map((j, i) => (i === 5 ? [j[0], j[1], 0.1] as Joint : j));
  assert.equal(planParts(noSh, 1), null);
  const noLegs = J.map((j, i) => (i >= 13 ? [j[0], j[1], 0.05] as Joint : j));
  assert.ok(!planParts(noLegs, 1)!.some((p) => p.key.startsWith("part_thigh")));
});

test("assignParts gives pixels to the nearest part, pulled by what the AI found", () => {
  const w = 200, h = 300, alpha = new Uint8Array(w * h).fill(255);
  const parts = planParts(J, 1)!, none = parts.map(() => null);
  const lab = assignParts(w, h, alpha, parts, none, 0);
  const keyAt = (x: number, y: number) => parts[lab[y * w + x] - 1].key;
  assert.equal(keyAt(40, 128), "part_farm_l");
  assert.equal(keyAt(100, 120), "part_body");
  assert.equal(keyAt(100, 30), "part_head");
  assert.equal(keyAt(116, 250), "part_shin_r");
  // the AI says this pixel near the body edge belongs to the right upper arm: the pull wins
  const found = parts.map((p) => (p.key === "part_uarm_r" ? (() => { const m = new Uint8Array(w * h); m[100 * w + 125] = 255; return m; })() : null));
  assert.equal(parts[assignParts(w, h, alpha, parts, found, 30)[100 * w + 125] - 1].key, "part_uarm_r");
  assert.equal(lab[0] > 0, true);
  const empty = new Uint8Array(w * h);
  assert.equal(assignParts(w, h, empty, parts, none, 0).some((v) => v), false, "see-through pixels get no part");
});

test("cleanLabels moves loose bits to the part they touch most", () => {
  // 6×3: part 1 left, part 2 right, one pixel of part 1 stranded inside part 2
  const l = new Uint8Array([1, 1, 1, 2, 2, 2, 1, 1, 1, 2, 1, 2, 1, 1, 1, 2, 2, 2]);
  cleanLabels(l, 6, 3);
  assert.equal(l[10], 2);
  assert.equal(l[0], 1);
});

test("jointOverlap gives the back part a band of the front part near the joint", () => {
  // a vertical limb 10 px wide: rows 0..19 part 1 (back), rows 20..39 part 2 (front, the child)
  const w = 30, h = 40, lab = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 10; x < 20; x++) lab[y * w + x] = y < 20 ? 1 : 2;
  const add = jointOverlap(lab, w, h, { back: 1, front: 2, child: 2, pivot: [15, 20] });
  assert.ok(add.length > 20);
  for (const i of add) { assert.equal(lab[i], 2); assert.ok(Math.floor(i / w) < 28); }
});
test("jointOverlap adds nothing when the parts do not meet", () => {
  const w = 30, h = 40, lab = new Uint8Array(w * h);
  for (let y = 0; y < 10; y++) for (let x = 10; x < 20; x++) lab[y * w + x] = 1;
  for (let y = 30; y < 40; y++) for (let x = 10; x < 20; x++) lab[y * w + x] = 2;
  assert.deepEqual(jointOverlap(lab, w, h, { back: 1, front: 2, child: 2, pivot: [15, 20] }), []);
});
test("seamFill gives the back part a thin edge of the front part where they touch", () => {
  // left half part 1 (z 0, back), right half part 2 (z 1, front)
  const w = 10, h = 4, lab = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lab[y * w + x] = x < 5 ? 1 : 2;
  const m = seamFill(lab, w, h, (k) => k - 1, 2);
  assert.equal(m.get(2), undefined);
  const xs = new Set(m.get(1)!.map((i) => i % w));
  assert.deepEqual([...xs].sort(), [5, 6]);
});
test("seamFill treats the lower number as further back when two parts are at the same height", () => {
  const w = 10, h = 4, lab = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lab[y * w + x] = x < 5 ? 1 : 2;
  const m = seamFill(lab, w, h, () => 0, 1);
  assert.equal(m.get(2), undefined);
  assert.equal(m.get(1)!.length, h);
});
test("snapPivot moves a joint guessed off the shared edge onto it, and keeps one that is on it", () => {
  const w = 30, h = 40, lab = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 10; x < 20; x++) lab[y * w + x] = y < 20 ? 1 : 2;
  const off = snapPivot(meeting(lab, w, h, 1, 2, 2, [26, 30]), [26, 30]);
  assert.ok(Math.abs(off[0] - 14.5) < 1.5 && Math.abs(off[1] - 19.5) < 1.5, String(off));
  assert.deepEqual(snapPivot(meeting(lab, w, h, 1, 2, 2, [15, 20]), [15, 20]), [15, 20]);
});
