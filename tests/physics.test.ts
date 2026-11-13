import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/model/physics.ts";
import type { Layer, Project } from "../src/model/types.ts";

const layer = (id: string, parent: string | null, asset: string | null): Layer => ({ id, name: id, asset, parent, px: 50, py: 0, base: { x: 100, y: 100, rot: 0, sx: 1, sy: 1, o: 1 }, tracks: {}, visible: true, locked: false });

test("sway: hair lags when the head moves, then settles; nothing moves without motion", () => {
  const head = layer("head", null, null), hair = layer("hair", "head", "a");
  hair.base.x = 0; hair.base.y = 0; hair.sway = { amt: 1, stiff: 0.4, damp: 0.4, wind: 0 };
  const p: Project = { format: "tst-motion", version: 1, id: "p", name: "t", w: 500, h: 500, fps: 30, frames: 120, bg: "alpha", layers: [head, hair], assets: [{ id: "a", name: "a", type: "image/png", w: 100, h: 300 }], created: 0, modified: 0 };
  assert.ok(simulate(p).get("hair")!.every((v) => v === 0));
  head.tracks.x = [{ f: 0, v: 100, e: "linear" }, { f: 10, v: 400, e: "hold" }];
  const a = simulate(p).get("hair")!;
  const peak = Math.max(...a.map(Math.abs));
  assert.ok(peak > 5, `swings (peak ${peak})`);
  assert.ok(Math.abs(a[119]) < peak * 0.2, "settles down");
});
