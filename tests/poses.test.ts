import { test } from "node:test";
import assert from "node:assert/strict";
import { mirrorName, mirrorPose, poseValues, family } from "../src/model/poses.ts";
import { applyPreset } from "../src/model/presets.ts";
import type { Chan, Ease, Key, Layer, Project } from "../src/model/types.ts";

const L = (id: string, name: string, parent: string | null, x = 0): Layer => ({ id, name, asset: null, parent, px: 0, py: 0, base: { x, y: 0, rot: 0, sx: 1, sy: 1, o: 1 }, tracks: {}, visible: true, locked: false });
const proj = (layers: Layer[]): Project => ({ format: "tst-motion", version: 1, id: "p", name: "t", w: 1000, h: 1000, fps: 30, frames: 150, bg: "alpha", layers, assets: [], created: 0, modified: 0 });
const put = (l: Layer, ch: Chan, v: number, f: number, e?: Ease) => {
  const k = (l.tracks[ch] ??= []); const i = k.findIndex((q) => q.f === f);
  const key: Key = { f, v, e: e ?? "smooth" }; if (i >= 0) k[i] = key; else { k.push(key); k.sort((a, b) => a.f - b.f); }
};

test("mirror names swap left and right in Thai and English", () => {
  assert.equal(mirrorName("แขนซ้าย"), "แขนขวา");
  assert.equal(mirrorName("Right forearm"), "Left forearm");
  assert.equal(mirrorName("arm_L"), "arm_R");
  assert.equal(mirrorName("หัว"), null);
});

test("mirror pose: left and right arms trade turns, the middle turns the other way", () => {
  const body = L("b", "ตัว", null), la = L("l", "แขนซ้าย", "b"), ra = L("r", "แขนขวา", "b");
  la.tracks.rot = [{ f: 0, v: 30, e: "smooth" }]; body.tracks.rot = [{ f: 0, v: 5, e: "smooth" }];
  const p = proj([body, la, ra]);
  const m = mirrorPose(p, poseValues(p, 0));
  assert.equal(m.r.rot, -30);
  assert.equal(m.l.rot, 0);
  assert.equal(m.b.rot, -5);
  assert.deepEqual([...family(p, "b")].sort(), ["b", "l", "r"]);
});

test("quick motions find parts by name and write keys from the current frame", () => {
  const body = L("b", "ตัว", null), head = L("h", "หัว", "b"), ra = L("r", "ต้นแขนขวา", "b", -50), fa = L("f", "แขนท่อนล่างขวา", "r");
  const p = proj([body, head, ra, fa]);
  assert.deepEqual(applyPreset(p, "nod", 10, false, null, put), ["หัว"]);
  assert.equal(head.tracks.y![0].f, 10);
  const waved = applyPreset(p, "wave", 0, false, null, put);
  assert.ok(waved.includes("ต้นแขนขวา") && waved.includes("แขนท่อนล่างขวา"));
  assert.ok(Math.abs(Math.max(...ra.tracks.rot!.map((k) => Math.abs(k.v)))) >= 100, "arm goes up");
  const n = applyPreset(p, "breathe", 0, true, null, put);
  assert.ok(n.includes("ตัว") && body.tracks.sy!.length > 6, "repeats to the end");
});
