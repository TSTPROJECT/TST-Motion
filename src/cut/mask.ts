// Pixel work for cutting parts out of a picture. A mask holds 0..255 per pixel (255 = fully chosen).
// Everything here is plain arrays, so it runs the same in the program and in tests.

export interface Img { w: number; h: number; data: Uint8ClampedArray } // RGBA, not premultiplied
export interface Box { x: number; y: number; w: number; h: number }
export type Combine = "replace" | "add" | "sub";

/** Colour distance 0..255 (largest channel gap). Two nearly see-through pixels always match. */
function dist(d: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number) {
  const pa = d[i + 3];
  if (pa < 16 && a < 16) return 0;
  return Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b), Math.abs(pa - a));
}

/** Magic wand: pixels that look like the tapped one. `tol` 0..255. */
export function wand(img: Img, sx: number, sy: number, tol: number, contiguous: boolean): Uint8Array {
  const { w, h, data: d } = img, out = new Uint8Array(w * h);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const s = (sy * w + sx) * 4, r = d[s], g = d[s + 1], b = d[s + 2], a = d[s + 3];
  const ok = (p: number) => dist(d, p * 4, r, g, b, a) <= tol;
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (ok(p)) out[p] = 255;
    return out;
  }
  // scanline flood fill
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!;
    let x = x0; const row = y * w;
    if (out[row + x] || !ok(row + x)) continue;
    while (x > 0 && !out[row + x - 1] && ok(row + x - 1)) x--;
    let upOpen = false, downOpen = false;
    for (; x < w && !out[row + x] && ok(row + x); x++) {
      out[row + x] = 255;
      if (y > 0) { const q = row - w + x, f = !out[q] && ok(q); if (f && !upOpen) stack.push(x, y - 1); upOpen = f; }
      if (y < h - 1) { const q = row + w + x, f = !out[q] && ok(q); if (f && !downOpen) stack.push(x, y + 1); downOpen = f; }
    }
  }
  return out;
}

/**
 * The plain background: flood in from the picture's edges, starting only from the edge colours
 * that are common (so a character touching the edge is not taken). `tol` 0..255.
 */
export function background(img: Img, tol: number): Uint8Array {
  const { w, h, data: d } = img, n = w * h, out = new Uint8Array(n);
  const edge: number[] = [];
  for (let x = 0; x < w; x++) { edge.push(x, (h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { edge.push(y * w, y * w + w - 1); }
  // common edge colours: bins of 4 bits per channel (see-through pixels share one bin).
  // A bin counts when it holds 12% of the edge, so a figure that touches the edge is not taken.
  const bin = (p: number) => { const i = p * 4; return d[i + 3] < 16 ? -1 : ((d[i] >> 4) << 12) | ((d[i + 1] >> 4) << 8) | ((d[i + 2] >> 4) << 4) | (d[i + 3] >> 4); };
  const count = new Map<number, { n: number; sum: number[] }>();
  for (const p of edge) {
    const k = bin(p), i = p * 4; let c = count.get(k);
    if (!c) count.set(k, (c = { n: 0, sum: [0, 0, 0, 0] }));
    c.n++; for (let j = 0; j < 4; j++) c.sum[j] += d[i + j];
  }
  const ranked = [...count.values()].sort((a, b) => b.n - a.n);
  const common = ranked.filter((c, i) => i === 0 || c.n >= edge.length * 0.12).map((c) => c.sum.map((v) => v / c.n));
  // seeds: edge pixels close to one of the common colours
  const seedOf = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  let qh = 0, qt = 0;
  for (const p of edge) {
    if (seedOf[p] >= 0) continue;
    if (common.some((c) => dist(d, p * 4, c[0], c[1], c[2], c[3]) <= Math.max(tol, 8))) { seedOf[p] = p; out[p] = 255; queue[qt++] = p; }
  }
  while (qh < qt) {
    const p = queue[qh++], s = seedOf[p] * 4, x = p % w;
    const r = d[s], g = d[s + 1], b = d[s + 2], a = d[s + 3];
    const visit = (q: number) => { if (seedOf[q] < 0 && dist(d, q * 4, r, g, b, a) <= tol) { seedOf[q] = seedOf[p]; out[q] = 255; queue[qt++] = q; } };
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < n - w) visit(p + w);
  }
  return out;
}

/** Put a new selection into the current one. */
export function combine(mask: Uint8Array, add: Uint8Array, how: Combine, box?: Box, maskW?: number) {
  if (!box) {
    if (how === "replace") mask.set(add);
    else if (how === "add") for (let i = 0; i < mask.length; i++) mask[i] = Math.max(mask[i], add[i]);
    else for (let i = 0; i < mask.length; i++) mask[i] = Math.min(mask[i], 255 - add[i]);
    return;
  }
  // `add` covers only `box` (used for brush and lasso, which touch a small area)
  const W = maskW!;
  if (how === "replace") mask.fill(0);
  for (let y = 0; y < box.h; y++) {
    const mo = (box.y + y) * W + box.x, ao = y * box.w;
    for (let x = 0; x < box.w; x++) {
      const v = add[ao + x], m = mo + x;
      mask[m] = how === "sub" ? Math.min(mask[m], 255 - v) : Math.max(mask[m], v);
    }
  }
}

export function invert(mask: Uint8Array) { for (let i = 0; i < mask.length; i++) mask[i] = 255 - mask[i]; }

/** Keep the selection only where the picture has something (no point choosing empty pixels). */
export function onlySolid(mask: Uint8Array, img: Img) {
  const d = img.data;
  for (let i = 0; i < mask.length; i++) if (d[i * 4 + 3] === 0) mask[i] = 0;
}

/** Soften the edge by one pixel (3×3 average), so cut parts do not look jagged. */
export function soften(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; s += mask[yy * w + xx]; c++; } }
    out[y * w + x] = Math.round(s / c);
  }
  return out;
}

/** Grow the selection by one pixel, so the blended edge pixels around a colour area come along. */
export function grow(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = mask.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (mask[i] === 255) continue;
    let v = mask[i];
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w && mask[yy * w + xx] > v) v = mask[yy * w + xx]; } }
    out[i] = v;
  }
  return out;
}

/** Bounds of the pixels where `weight(i)` is above 0, or null when there are none. */
export function bounds(w: number, h: number, weight: (i: number) => number): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (weight(y * w + x) > 0) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** How many pixels are chosen (counting half-chosen ones by half). */
export function amount(mask: Uint8Array) { let s = 0; for (let i = 0; i < mask.length; i++) s += mask[i]; return s / 255; }

/**
 * Split a picture into its separate pieces (islands of solid pixels, 8-connected).
 * Specks smaller than `minPart` pixels join the nearest real piece; faint edge pixels join their neighbour.
 * Returns a label per pixel (0 = empty, 1..n) and the number of pieces.
 */
export function islands(img: Img, minPart = 64): { labels: Int32Array; count: number } {
  const { w, h, data: d } = img, n = w * h;
  const labels = new Int32Array(n), solid = (p: number) => d[p * 4 + 3] > 16;
  const sizes: number[] = [0], boxes: Box[] = [{ x: 0, y: 0, w: 0, h: 0 }];
  const stack = new Int32Array(n);
  let count = 0;
  for (let p0 = 0; p0 < n; p0++) {
    if (labels[p0] || !solid(p0)) continue;
    const id = ++count; let top = 0, size = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = p0; labels[p0] = id;
    while (top) {
      const p = stack[--top], x = p % w, y = (p - x) / w; size++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx; if (!labels[q] && solid(q)) { labels[q] = id; stack[top++] = q; }
        }
      }
    }
    sizes.push(size); boxes.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  // specks join the closest big piece (by distance between boxes)
  const big = sizes.map((s, i) => i > 0 && s >= minPart);
  if (!big.some(Boolean)) { const best = sizes.indexOf(Math.max(...sizes.slice(1))); if (best > 0) big[best] = true; }
  const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));
  const remap = new Int32Array(count + 1);
  let next = 0;
  for (let i = 1; i <= count; i++) if (big[i]) remap[i] = ++next;
  for (let i = 1; i <= count; i++) if (!big[i]) {
    let bestJ = 0, bestD = Infinity;
    for (let j = 1; j <= count; j++) if (big[j]) { const g = gap(boxes[i], boxes[j]); if (g < bestD) { bestD = g; bestJ = j; } }
    remap[i] = remap[bestJ];
  }
  for (let p = 0; p < n; p++) if (labels[p]) labels[p] = remap[labels[p]];
  // faint edge pixels (alpha 1..16) take the label of a neighbour, two rings deep
  for (let pass = 0; pass < 2; pass++) {
    for (let p = 0; p < n; p++) {
      if (labels[p] || d[p * 4 + 3] === 0) continue;
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1 && !labels[p]; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const l = labels[yy * w + xx]; if (l > 0) { labels[p] = -l; break; } // negative = set this pass
      }
    }
    for (let p = 0; p < n; p++) if (labels[p] < 0) labels[p] = -labels[p];
  }
  return { labels, count: next };
}

/**
 * Copy the pixels inside `box`, each pixel's alpha multiplied by weight(i)/255.
 * Used to make the cut piece (weight = mask) and what stays behind (weight = 255 - mask).
 */
export function extract(img: Img, box: Box, weight: (i: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(box.w * box.h * 4), d = img.data;
  for (let y = 0; y < box.h; y++) {
    let si = ((box.y + y) * img.w + box.x), o = y * box.w * 4;
    for (let x = 0; x < box.w; x++, si++, o += 4) {
      const k = weight(si); if (!k) continue;
      const s = si * 4;
      out[o] = d[s]; out[o + 1] = d[s + 1]; out[o + 2] = d[s + 2]; out[o + 3] = Math.round((d[s + 3] * k) / 255);
    }
  }
  return out;
}

// ---------- cleaning up an AI answer ----------

/** Average of src over a (2r+1)² square around each pixel (edges use what is inside the picture). */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) s += src[o + x];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      if (x + r + 1 < w) s += src[o + x + r + 1];
      if (x - r >= 0) s -= src[o + x - r];
    }
  }
  // down the columns, a whole row at a time (much faster than one column at a time on big pictures)
  const col = new Float64Array(w);
  for (let y = 0; y <= Math.min(r, h - 1); y++) { const o = y * w; for (let x = 0; x < w; x++) col[x] += tmp[o + x]; }
  for (let y = 0; y < h; y++) {
    const o = y * w, inv = 1 / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
    for (let x = 0; x < w; x++) out[o + x] = col[x] * inv;
    if (y + r + 1 < h) { const a = (y + r + 1) * w; for (let x = 0; x < w; x++) col[x] += tmp[a + x]; }
    if (y - r >= 0) { const b = (y - r) * w; for (let x = 0; x < w; x++) col[x] -= tmp[b + x]; }
  }
  return out;
}

/** The guide picture's own local mean and spread, which every guided smoothing of it needs (worth keeping). */
export function guideStats(guide: Float32Array, w: number, h: number, r: number) {
  const n = w * h, ii = new Float32Array(n);
  for (let i = 0; i < n; i++) ii[i] = guide[i] * guide[i];
  const mI = boxMean(guide, w, h, r), vI = boxMean(ii, w, h, r);
  for (let i = 0; i < n; i++) vI[i] -= mI[i] * mI[i];
  return { r, mI, vI };
}

/** Edge-following smoothing (the "guided filter"): p is smoothed, but its edges move onto the edges of the guide picture. */
export function guided(guide: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number, stats = guideStats(guide, w, h, r)): Float32Array {
  const n = w * h, ip = new Float32Array(n), { mI, vI } = stats;
  for (let i = 0; i < n; i++) ip[i] = guide[i] * p[i];
  const mP = boxMean(p, w, h, r), mIP = boxMean(ip, w, h, r);
  const a = ip, b = mIP; // reuse
  for (let i = 0; i < n; i++) {
    const c = mIP[i] - mI[i] * mP[i], ai = c / (vI[i] + eps);
    a[i] = ai; b[i] = mP[i] - ai * mI[i];
  }
  const mA = boxMean(a, w, h, r), mB = boxMean(b, w, h, r);
  for (let i = 0; i < n; i++) mA[i] = mA[i] * guide[i] + mB[i];
  return mA;
}

/** Brightness (0..1) of each pixel; see-through parts count as white. */
export function grayOf(img: Img): Float32Array {
  const { w, h, data: d } = img, g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3] / 255;
    g[i] = ((0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a)) / 255;
  }
  return g;
}

/** Label 4-connected areas where inside(i) is true. Returns labels (0 = outside) and each area's size. */
function areas(w: number, h: number, inside: (i: number) => boolean) {
  const n = w * h, labels = new Int32Array(n), stack = new Int32Array(n), sizes = [0], edge = [false];
  for (let p0 = 0; p0 < n; p0++) {
    if (labels[p0] || !inside(p0)) continue;
    const id = sizes.length; let top = 0, size = 0, onEdge = false;
    stack[top++] = p0; labels[p0] = id;
    while (top) {
      const p = stack[--top], x = p % w, y = (p - x) / w; size++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) onEdge = true;
      if (x > 0 && !labels[p - 1] && inside(p - 1)) { labels[p - 1] = id; stack[top++] = p - 1; }
      if (x < w - 1 && !labels[p + 1] && inside(p + 1)) { labels[p + 1] = id; stack[top++] = p + 1; }
      if (y > 0 && !labels[p - w] && inside(p - w)) { labels[p - w] = id; stack[top++] = p - w; }
      if (y < h - 1 && !labels[p + w] && inside(p + w)) { labels[p + w] = id; stack[top++] = p + w; }
    }
    sizes.push(size); edge.push(onEdge);
  }
  return { labels, sizes, edge };
}

/**
 * Tidy a selection: keep only the parts that hold (or are next to) one of the "this" points, plus any
 * other part at least a sixth the size of the biggest kept one; then fill holes up to maxHole pixels.
 */
export function tidy(mask: Uint8Array, w: number, h: number, keep: Array<[number, number]>, maxHole: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const { labels, sizes } = areas(w, h, (i) => mask[i] >= 128);
  if (sizes.length === 1) return out;
  const kept = new Set<number>();
  for (const [px, py] of keep) {
    // the part under the point, or the closest one within a few cells
    let best = 0, bestD = Infinity; const R = Math.max(12, Math.round(Math.max(w, h) / 80));
    const cx = Math.round(px), cy = Math.round(py);
    for (let y = Math.max(0, cy - R); y <= Math.min(h - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(w - 1, cx + R); x++) {
      const l = labels[y * w + x]; if (!l) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bestD) { bestD = d; best = l; }
    }
    if (best) kept.add(best);
  }
  if (!kept.size) { let b = 1; for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[b]) b = i; kept.add(b); }
  const big = Math.max(...[...kept].map((l) => sizes[l]));
  for (let l = 1; l < sizes.length; l++) if (sizes[l] * 6 >= big) kept.add(l);
  for (let i = 0; i < w * h; i++) if (kept.has(labels[i])) out[i] = 255;
  // holes: unselected areas that do not reach the picture's edge
  const holes = areas(w, h, (i) => out[i] === 0);
  for (let i = 0; i < w * h; i++) { const l = holes.labels[i]; if (l && !holes.edge[l] && holes.sizes[l] <= maxHole) out[i] = 255; }
  return out;
}

/**
 * Bits of the picture that a cut would leave behind as loose crumbs (small solid areas, cut off from the
 * rest, that touch the selection) are added to the selection, so the cut takes them along.
 */
export function absorbCrumbs(mask: Uint8Array, img: Img, maxCrumb: number) {
  const { w, h, data: d } = img;
  const { labels, sizes } = areas(w, h, (i) => mask[i] < 128 && d[i * 4 + 3] > 16);
  const touches = new Uint8Array(sizes.length);
  for (let i = 0; i < w * h; i++) {
    const l = labels[i]; if (!l || touches[l] || sizes[l] > maxCrumb) continue;
    const x = i % w;
    if ((x > 0 && mask[i - 1] >= 128) || (x < w - 1 && mask[i + 1] >= 128) || (i >= w && mask[i - w] >= 128) || (i + w < w * h && mask[i + w] >= 128)) touches[l] = 1;
  }
  for (let i = 0; i < w * h; i++) { const l = labels[i]; if (l && touches[l]) mask[i] = 255; }
}
