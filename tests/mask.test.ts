import { test } from "node:test";
import assert from "node:assert/strict";
import { boxMean, wand, background, combine, islands, bounds, extract, soften, invert, amount, type Img } from "../src/cut/mask.ts";

/** Make a w×h picture from a function returning [r,g,b,a]. */
function img(w: number, h: number, px: (x: number, y: number) => number[]): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  return { w, h, data };
}
const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255], WHITE = [255, 255, 255, 255], NONE = [0, 0, 0, 0];

test("wand picks the touching area of similar colour only", () => {
  // two red squares split by a blue column
  const im = img(9, 4, (x) => (x === 4 ? BLUE : RED));
  const m = wand(im, 1, 1, 10, true);
  assert.equal(amount(m), 16);
  assert.equal(m[0], 255); assert.equal(m[4], 0); assert.equal(m[5], 0);
  const g = wand(im, 1, 1, 10, false);
  assert.equal(amount(g), 32);
});

test("wand tolerance lets near colours in", () => {
  const im = img(4, 1, (x) => [200 + x * 10, 0, 0, 255]);
  assert.equal(amount(wand(im, 0, 0, 5, true)), 1);
  assert.equal(amount(wand(im, 0, 0, 30, true)), 4);
});

test("background takes the plain edge colour but not a subject touching the edge", () => {
  // white background, red figure in the middle that reaches the bottom edge
  const im = img(10, 10, (x, y) => (x >= 4 && x <= 5 && y >= 3 ? RED : WHITE));
  const m = background(im, 20);
  assert.equal(m[0], 255);
  assert.equal(m[9 * 10 + 4], 0, "figure pixel on the edge stays");
  assert.equal(amount(m), 100 - 14);
});

test("combine add / sub / replace, full and boxed", () => {
  const m = new Uint8Array([0, 255, 0, 0]);
  combine(m, new Uint8Array([255, 0, 0, 0]), "add"); assert.deepEqual([...m], [255, 255, 0, 0]);
  combine(m, new Uint8Array([0, 255, 0, 0]), "sub"); assert.deepEqual([...m], [255, 0, 0, 0]);
  combine(m, new Uint8Array([255]), "add", { x: 1, y: 1, w: 1, h: 1 }, 2); assert.deepEqual([...m], [255, 0, 0, 255]);
  combine(m, new Uint8Array([255]), "replace", { x: 0, y: 1, w: 1, h: 1 }, 2); assert.deepEqual([...m], [0, 0, 255, 0]);
  invert(m); assert.deepEqual([...m], [255, 255, 0, 255]);
});

test("islands splits separate pieces and folds specks into the nearest piece", () => {
  // two 4×4 blocks far apart, plus a single-pixel speck next to the right one
  const im = img(20, 6, (x, y) => ((y >= 1 && y <= 4 && ((x >= 1 && x <= 4) || (x >= 12 && x <= 15))) || (x === 17 && y === 2) ? RED : NONE));
  const { labels, count } = islands(im, 4);
  assert.equal(count, 2);
  const left = labels[1 * 20 + 1], right = labels[1 * 20 + 12];
  assert.notEqual(left, right);
  assert.equal(labels[2 * 20 + 17], right, "speck joins the right piece");
  assert.equal(labels[0], 0);
});

test("islands keeps faint edge pixels with their piece", () => {
  const im = img(5, 3, (x) => (x <= 2 ? RED : x === 3 ? [255, 0, 0, 8] : NONE));
  const { labels, count } = islands(im, 1);
  assert.equal(count, 1);
  assert.equal(labels[3], 1);
});

test("bounds, extract and soften", () => {
  const im = img(4, 4, (x, y) => (x >= 1 && x <= 2 && y >= 1 && y <= 2 ? BLUE : NONE));
  const b = bounds(4, 4, (i) => im.data[i * 4 + 3]);
  assert.deepEqual(b, { x: 1, y: 1, w: 2, h: 2 });
  const half = extract(im, b!, () => 128);
  assert.equal(half.length, 16); assert.equal(half[2], 255); assert.equal(half[3], 128);
  assert.equal(bounds(3, 3, () => 0), null);
  const s = soften(new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 0]), 3, 3);
  assert.equal(s[4], Math.round(255 / 9)); assert.equal(s[0], Math.round(255 / 4));
});

test("grow adds one ring of pixels", async () => {
  const { grow } = await import("../src/cut/mask.ts");
  const m = new Uint8Array(25); m[12] = 255;
  const g = grow(m, 5, 5);
  assert.equal(amount(g), 9); assert.equal(g[0], 0); assert.equal(g[6], 255);
});

test("tidy keeps the tapped part, drops loose crumbs and fills small holes", async () => {
  const { tidy } = await import("../src/cut/mask.ts");
  const w = 20, h = 10, m = new Uint8Array(w * h);
  for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) m[y * w + x] = 255; // the part
  m[4 * w + 4] = 0;                                                            // a hole inside it
  m[2 * w + 15] = 255; m[2 * w + 16] = 255;                                    // a crumb far away
  const t = tidy(m, w, h, [[3, 3]], 4);
  assert.equal(t[4 * w + 4], 255, "hole filled");
  assert.equal(t[2 * w + 15], 0, "crumb dropped");
  assert.equal(amount(t), 64);
});

test("absorbCrumbs gives tiny cut-off leftovers to the selection", async () => {
  const { absorbCrumbs } = await import("../src/cut/mask.ts");
  // a solid 10×3 strip; the selection is columns 0..6, column 7 is a crumb split from 8..9 by a gap
  const im = img(10, 3, (x) => (x === 8 ? NONE : RED));
  const m = new Uint8Array(30); for (let y = 0; y < 3; y++) for (let x = 0; x <= 6; x++) m[y * 10 + x] = 255;
  absorbCrumbs(m, im, 3);
  assert.equal(m[7], 255, "crumb touching the selection joins it");
  assert.equal(m[9], 0, "a separate piece not touching stays");
});

test("guided smoothing moves a blurry edge onto the picture's edge", async () => {
  const { guided } = await import("../src/cut/mask.ts");
  const w = 40, h = 1, g = new Float32Array(w), p = new Float32Array(w);
  for (let x = 0; x < w; x++) { g[x] = x < 20 ? 0 : 1; p[x] = Math.min(1, Math.max(0, (x - 14) / 12)); } // edge at 20, answer ramps 14..26
  const q = guided(g, p, w, h, 6, 1e-4);
  assert.ok(q[18] < 0.5 && q[21] > 0.5, `edge snapped: q18=${q[18].toFixed(2)} q21=${q[21].toFixed(2)}`);
});

test("boxMean matches a plain average over the box (cut at the picture's edges)", () => {
  const w = 13, h = 9, r = 2, src = Float32Array.from({ length: w * h }, (_, i) => (i * 37) % 11);
  const got = boxMean(src, w, h, r);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { s += src[yy * w + xx]; n++; }
    assert.ok(Math.abs(got[y * w + x] - s / n) < 1e-4);
  }
});
