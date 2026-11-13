import { test } from "node:test";
import assert from "node:assert/strict";
import { pinPoint, unpinPoint, facePoint, warpGrid, GRID } from "../src/model/warp.ts";

test("pins: a pin goes exactly where it was dragged, one pin just moves the picture", () => {
  const src: [number, number][] = [[0, 0], [100, 0]], dst: [number, number][] = [[0, 0], [100, 40]];
  assert.deepEqual(pinPoint(src, dst, [100, 0]), [100, 40]);
  const one = pinPoint([[10, 10]], [[15, 30]], [50, 50]);
  assert.ok(Math.abs(one[0] - 55) < 1e-9 && Math.abs(one[1] - 70) < 1e-9);
  // a point beside the held pin hardly moves; one beside the dragged pin moves almost as far
  const near0 = pinPoint(src, dst, [5, 0]), near1 = pinPoint(src, dst, [95, 0]);
  assert.ok(Math.hypot(near0[0] - 5, near0[1]) < 6);
  assert.ok(near1[1] > 30);
});

test("pins: unpinPoint undoes pinPoint", () => {
  const src: [number, number][] = [[0, 0], [100, 0], [50, 80]], dst: [number, number][] = [[0, 0], [110, 30], [50, 80]];
  const q = pinPoint(src, dst, [60, 20]), r = unpinPoint(src, dst, q);
  assert.ok(Math.hypot(r[0] - 60, r[1] - 20) < 0.01);
});

test("3D turn: the face centre slides toward the turn, nothing moves at 0", () => {
  const f = { cx: 50, cy: 50, rx: 40, ry: 40 };
  assert.deepEqual(facePoint(f, 0, 0, 50, 50), [50, 50]);
  assert.ok(facePoint(f, 1, 0, 50, 50)[0] > 70);
  assert.ok(facePoint(f, -1, 0, 50, 50)[0] < 30);
  assert.ok(facePoint(f, 0, 1, 50, 50)[1] > 60);
  assert.equal(warpGrid(100, 100, null, { f, turn: 0, nod: 0 }), null);
  assert.equal(warpGrid(100, 100, null, { f, turn: 0.5, nod: 0 })!.length, (GRID + 1) * (GRID + 1) * 2);
});
