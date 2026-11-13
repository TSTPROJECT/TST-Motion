// Run with: npm test  (Node 24 runs TypeScript directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleKeys, solve, apply, invert, mul, localMatrix, wouldCycle, keyFrames } from "../src/model/anim.ts";
import type { Layer, Project } from "../src/model/types.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function layer(id: string, over: Partial<Layer> = {}): Layer {
  return { id, name: id, asset: null, parent: null, px: 0, py: 0, base: { x: 0, y: 0, rot: 0, sx: 1, sy: 1, o: 1 }, tracks: {}, visible: true, locked: false, ...over } as Layer;
}
function proj(layers: Layer[]): Project {
  return { format: "tst-motion", version: 1, id: "p", name: "t", w: 100, h: 100, fps: 30, frames: 60, bg: "alpha", layers, assets: [], created: 0, modified: 0 } as Project;
}

test("keys: hold before the first, after the last, linear in between", () => {
  const k = [{ f: 10, v: 0, e: "linear" as const }, { f: 20, v: 100, e: "linear" as const }];
  assert.equal(sampleKeys(k, 0, 5), 0);
  assert.equal(sampleKeys(k, 30, 5), 100);
  near(sampleKeys(k, 15, 5), 50);
  assert.equal(sampleKeys(undefined, 15, 7), 7);
});

test("hold ease keeps the value until the next key", () => {
  const k = [{ f: 0, v: 1, e: "hold" as const }, { f: 10, v: 9, e: "linear" as const }];
  assert.equal(sampleKeys(k, 9.9, 0), 1);
  assert.equal(sampleKeys(k, 10, 0), 9);
});

test("smooth ease is symmetric and passes the middle", () => {
  const k = [{ f: 0, v: 0, e: "smooth" as const }, { f: 10, v: 10, e: "linear" as const }];
  near(sampleKeys(k, 5, 0), 5);
  near(sampleKeys(k, 2, 0) + sampleKeys(k, 8, 0), 10);
});

test("matrix inverse undoes the matrix", () => {
  const m = localMatrix({ x: 30, y: 40, rot: 33, sx: 1.5, sy: 0.7, o: 1 }, 12, 8);
  const [x, y] = apply(mul(invert(m), m), 3, -4);
  near(x, 3); near(y, -4);
});

test("pivot lands on the layer position", () => {
  const m = localMatrix({ x: 50, y: 60, rot: 90, sx: 2, sy: 2, o: 1 }, 10, 20);
  const [x, y] = apply(m, 10, 20);
  near(x, 50); near(y, 60);
});

test("a child follows its parent's rotation", () => {
  const parent = layer("a", { base: { x: 0, y: 0, rot: 90, sx: 1, sy: 1, o: 0.5 } });
  const child = layer("b", { parent: "a", base: { x: 10, y: 0, rot: 0, sx: 1, sy: 1, o: 0.5 } });
  const s = solve(proj([parent, child]), 0);
  const [x, y] = apply(s.world.get("b")!, 0, 0);
  near(x, 0); near(y, 10);
  near(s.alpha.get("b")!, 0.25);
});

test("parent loops are detected and do not hang", () => {
  const a = layer("a", { parent: "b" }), b = layer("b", { parent: "a" });
  const s = solve(proj([a, b]), 0);
  assert.equal(s.world.size, 2);
  assert.equal(wouldCycle(proj([layer("x"), layer("y", { parent: "x" })]), "x", "y"), true);
});

test("keyFrames merges frames from every track", () => {
  const l = layer("a", { tracks: { x: [{ f: 0, v: 0, e: "linear" }, { f: 10, v: 1, e: "linear" }], rot: [{ f: 10, v: 0, e: "linear" }, { f: 5, v: 0, e: "linear" }] } });
  assert.deepEqual(keyFrames(l), [0, 5, 10]);
});

test("a soft joint knows where the part would be without its own turn", () => {
  const a = layer("a", { base: { x: 50, y: 50, rot: 30, sx: 1, sy: 1, o: 1 } });
  const b = layer("b", { parent: "a", bend: 20, base: { x: 10, y: 0, rot: 0, sx: 1, sy: 1, o: 1 }, tracks: { rot: [{ f: 0, v: 45, e: "linear" }] } });
  const S = solve(proj([a, b]), 0);
  const f = S.follow.get("b")!, w = S.world.get("b")!;
  // the joint itself sits in the same place either way
  const pf = apply(f, b.px, b.py), pw = apply(w, b.px, b.py);
  assert.ok(Math.hypot(pf[0] - pw[0], pf[1] - pw[1]) < 1e-9);
  // without its own 45° turn, the follow matrix turns only with the parent (30°)
  assert.ok(Math.abs(Math.atan2(f[1], f[0]) * 180 / Math.PI - 30) < 1e-9);
  assert.ok(Math.abs(Math.atan2(w[1], w[0]) * 180 / Math.PI - 75) < 1e-9);
  assert.equal(S.follow.has("a"), false);
});

test("speed curve: a custom curve key eases between keys", async () => {
  const { bezier, sampleKeys } = await import("../src/model/anim.ts");
  assert.ok(Math.abs(bezier([0, 0, 1, 1], 0.3) - 0.3) < 1e-6);
  assert.ok(bezier([0.9, 0, 1, 0.1], 0.5) < 0.2, "slow start");
  const keys = [{ f: 0, v: 0, e: "curve" as const, c: [0, 0.9, 0.1, 1] as [number, number, number, number] }, { f: 10, v: 100, e: "linear" as const }];
  assert.ok(sampleKeys(keys, 3, 0) > 70, "fast start");
  assert.equal(sampleKeys(keys, 10, 0), 100);
});

test("camera: zoom keeps the looked-at point in the middle; parts that follow it stay on screen", async () => {
  const { solve, apply } = await import("../src/model/anim.ts");
  const mk = (id: string, parent: string | null, x: number, y: number) => ({ id, name: id, asset: null, parent, px: 0, py: 0, base: { x, y, rot: 0, sx: 1, sy: 1, o: 1 }, tracks: {}, visible: true, locked: false });
  const cam = { ...mk("c", null, 300, 200), px: 500, py: 400, camera: { shakeSpeed: 6 } };
  cam.base.sx = 2; cam.base.sy = 2;
  const p = { format: "tst-motion" as const, version: 1 as const, id: "p", name: "p", w: 1000, h: 800, fps: 30, frames: 30, bg: "alpha" as const, layers: [mk("a", null, 300, 200), mk("b", null, 350, 200), cam, mk("hud", "c", 20, 30)], assets: [], created: 0, modified: 0 };
  const S = solve(p, 0, null, true);
  assert.deepEqual(apply(S.world.get("a")!, 0, 0).map(Math.round), [500, 400]);
  assert.deepEqual(apply(S.world.get("b")!, 0, 0).map(Math.round), [600, 400]);
  assert.deepEqual(apply(S.world.get("hud")!, 0, 0).map(Math.round), [20, 30]);
  const off = solve(p, 0, null, false);
  assert.deepEqual(apply(off.world.get("a")!, 0, 0).map(Math.round), [300, 200]);
});

test("motion path: a curve goes through every key, and orient faces the way it moves", async () => {
  const { posAt, headingAt } = await import("../src/model/anim.ts");
  const l = { id: "a", name: "a", asset: null, parent: null, px: 0, py: 0, base: { x: 0, y: 0, rot: 0, sx: 1, sy: 1, o: 1 }, visible: true, locked: false,
    tracks: { x: [{ f: 0, v: 0, e: "linear" as const }, { f: 10, v: 100, e: "linear" as const }, { f: 20, v: 200, e: "linear" as const }], y: [{ f: 0, v: 0, e: "linear" as const }, { f: 10, v: 100, e: "linear" as const }, { f: 20, v: 0, e: "linear" as const }] },
    path: { curve: true, orient: true } };
  assert.deepEqual(posAt(l, 10).map(Math.round), [100, 100]);
  // between keys the curve bulges past the straight line (which would give y = 50 at frame 5)
  assert.ok(posAt(l, 5)[1] > 50);
  near(headingAt(l, 10), 0, 1);
  assert.ok(headingAt(l, 2) > 0 && headingAt(l, 18) < 0);
});

test("lip sync: the mouth follows loudness, holds each shape at least 2 frames, and is -1 outside the sound", async () => {
  const { mouthPlan } = await import("../src/audio/lip.ts");
  const loud = new Float32Array([-1, 0, 0, 1, 1, 1, 0.4, 0.4, 0, 0, 0, -1]);
  const m = Array.from(mouthPlan(loud, 0.5));
  assert.equal(m[0], -1); assert.equal(m[11], -1);
  assert.ok(m.includes(2) && m.includes(0));
  for (let i = 1; i < 10; i++) if (m[i] !== m[i - 1] && m[i - 1] >= 0) assert.ok(i >= 3);
});
