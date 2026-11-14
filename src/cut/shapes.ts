// Automatic parts by shape, for animals and things (when no person is found).
// The thick middle of the silhouette is the body; what sticks out of it (legs, tail, neck and head,
// handles) becomes parts that turn where they meet it. Long parts get a joint in the middle (knees).
// Pure functions on the alpha mask, no AI model.
import type { Detail } from "./parts";

export type ShapeKind = "body" | "leg" | "top" | "side" | "piece";
export interface ShapePart {
  kind: ShapeKind;
  /** 1-based number among parts of the same kind (for names). */
  n: number;
  /** Second segment of a long part (the lower leg, the tip of a tail). */
  tip: number;
  pivot: [number, number];
  parent: number; // index into the parts, -1 for the body
  z: number;
}

/** Chamfer distance (3-4) to the nearest pixel outside `inside`, in pixels. */
export function distanceIn(inside: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h), BIG = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? BIG : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3); else v = Math.min(v, 3);
    if (y > 0) {
      v = Math.min(v, d[i - w] + 3);
      if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
      if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
    } else v = Math.min(v, 3);
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 3); else v = Math.min(v, 3);
    if (y < h - 1) {
      v = Math.min(v, d[i + w] + 3);
      if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
    } else v = Math.min(v, 3);
    d[i] = v;
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** Connected groups (8 neighbours) of pixels where `on` is set. Labels 1..count. */
function groups(on: Uint8Array, w: number, h: number): { lab: Int32Array; count: number; size: number[] } {
  const lab = new Int32Array(w * h), size = [0], stack: number[] = [];
  let count = 0;
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || lab[s]) continue;
    count++; let n = 0; lab[s] = count; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!; n++;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx; if (on[j] && !lab[j]) { lab[j] = count; stack.push(j); }
      }
    }
    size.push(n);
  }
  return { lab, count, size };
}

const N4 = (w: number) => [-1, 1, -w, w];

/**
 * Guess parts from the silhouette (alpha > 127). Returns a part number per pixel (1..n, 0 = none)
 * and the parts, or null when the shape has nothing sticking out (a ball, a box).
 */
export function shapeParts(alpha: Uint8Array, w: number, h: number, detail: Detail): { labels: Uint8Array; parts: ShapePart[] } | null {
  const sil = new Uint8Array(w * h); let area = 0;
  for (let i = 0; i < sil.length; i++) if (alpha[i] > 127) { sil[i] = 1; area++; }
  if (area < 400) return null;
  const dist = distanceIn(sil, w, h);
  let D = 0; for (let i = 0; i < dist.length; i++) if (dist[i] > D) D = dist[i];
  // opening: keep what a ball of radius r can reach; thinner things (legs, tails) fall away
  const r = D * [0.62, 0.5, 0.42][detail];
  const seed = new Uint8Array(w * h); for (let i = 0; i < seed.length; i++) seed[i] = dist[i] >= r ? 1 : 0;
  const notSeed = new Uint8Array(w * h); for (let i = 0; i < seed.length; i++) notSeed[i] = seed[i] ? 0 : 1;
  const toSeed = distanceIn(notSeed, w, h);
  const core = new Uint8Array(w * h); for (let i = 0; i < core.length; i++) core[i] = sil[i] && toSeed[i] <= r + 1 ? 1 : 0;
  // regions: big thick blobs ("cores"), then what is left over
  const C = groups(core, w, h);
  const region = new Int32Array(w * h); // 0 none, >0 region id
  const isCore: boolean[] = [false], rsize: number[] = [0];
  const coreId = new Int32Array(C.count + 1);
  for (let k = 1; k <= C.count; k++) if (C.size[k] >= area * 0.02) { isCore.push(true); rsize.push(0); coreId[k] = isCore.length - 1; }
  for (let i = 0; i < region.length; i++) if (C.lab[i] && coreId[C.lab[i]]) region[i] = coreId[C.lab[i]];
  if (isCore.length < 2) return null;
  const rest = new Uint8Array(w * h); for (let i = 0; i < rest.length; i++) rest[i] = sil[i] && !region[i] ? 1 : 0;
  const R = groups(rest, w, h);
  const restId = new Int32Array(R.count + 1);
  for (let k = 1; k <= R.count; k++) { isCore.push(false); rsize.push(0); restId[k] = isCore.length - 1; }
  for (let i = 0; i < region.length; i++) if (R.lab[i]) region[i] = restId[R.lab[i]];
  let nReg = isCore.length - 1;
  for (let i = 0; i < region.length; i++) rsize[region[i]]++;

  // how much each pair of regions touches
  const inside = (i: number, o: number) => { const j = i + o; if (j < 0 || j >= region.length) return -1; const x = i % w; if ((o === -1 && x === 0) || (o === 1 && x === w - 1)) return -1; return j; };
  const touch = () => {
    const m = new Map<number, number>();
    for (let i = 0; i < region.length; i++) {
      const a = region[i]; if (!a) continue;
      for (const o of N4(w)) { const j = inside(i, o); if (j < 0) continue; const b = region[j]; if (b && b !== a) m.set(a * 65536 + b, (m.get(a * 65536 + b) ?? 0) + 1); }
    }
    return m;
  };
  const thickOf = new Float32Array(nReg + 1);
  for (let i = 0; i < region.length; i++) { const a = region[i]; if (a && dist[i] > thickOf[a]) thickOf[a] = dist[i]; }

  // leftovers that do not stick out (the rounded-off corners of the body, crumbs) go back to what they touch;
  // a neck between two blobs goes with the smaller blob (the head)
  let T = touch();
  // how far each leftover reaches out from the blob it hangs on (walking through it)
  const reach = new Float32Array(nReg + 1);
  {
    const depth = new Int32Array(w * h).fill(-1); let q: number[] = [];
    for (let i = 0; i < region.length; i++) {
      const a = region[i]; if (!a || isCore[a]) continue;
      for (const o of N4(w)) { const j = inside(i, o); if (j >= 0 && region[j] && isCore[region[j]]) { depth[i] = 0; q.push(i); break; } }
    }
    for (let d = 1; q.length; d++) {
      const next: number[] = [];
      for (const i of q) for (const o of N4(w)) { const j = inside(i, o); if (j >= 0 && depth[j] < 0 && region[j] === region[i]) { depth[j] = d; next.push(j); if (d > reach[region[j]]) reach[region[j]] = d; } }
      q = next;
    }
  }
  const alias = Int32Array.from({ length: nReg + 1 }, (_, i) => i);
  for (let a = 1; a <= nReg; a++) {
    if (isCore[a] || !rsize[a]) continue;
    let best = 0, most = 0; const cores: number[] = [];
    for (let b = 1; b <= nReg; b++) { const c = T.get(a * 65536 + b) ?? 0; if (!c) continue; if (isCore[b]) cores.push(b); if (c > most) { most = c; best = b; } }
    if (!best) { if (rsize[a] < area * 0.003) { alias[a] = 0; rsize[a] = 0; } continue; }
    let to = 0;
    if (rsize[a] < area * 0.003 || reach[a] < r * 0.5) to = best;
    else if (cores.length >= 2) { cores.sort((x, y) => rsize[x] - rsize[y]); to = cores[0]; }
    if (to) { alias[a] = to; rsize[to] += rsize[a]; rsize[a] = 0; }
  }
  const res = (a: number): number => { while (alias[a] !== a && a) a = alias[a]; return a; };
  for (let i = 0; i < region.length; i++) if (region[i]) region[i] = res(region[i]);
  T = touch();

  // tree: start from the biggest blob, always take the strongest link next
  let root = 0; for (let a = 1; a <= nReg; a++) if (isCore[a] && rsize[a] > (root ? rsize[root] : 0)) root = a;
  const live = Array.from({ length: nReg + 1 }, (_, a) => a).filter((a) => a && rsize[a]);
  if (live.length < 2 || !root) return null;
  const parentOf = new Map<number, number>([[root, 0]]);
  const order = [root];
  while (order.length < live.length) {
    let best: [number, number, number] | null = null;
    for (const a of live) {
      if (parentOf.has(a)) continue;
      for (const b of order) { const c = T.get(a * 65536 + b) ?? 0; if (c && (!best || c > best[2])) best = [a, b, c]; }
    }
    if (!best) { for (const a of live) if (!parentOf.has(a)) { parentOf.set(a, root); order.push(a); } break; }
    parentOf.set(best[0], best[1]); order.push(best[0]);
  }

  // each region's box, so the work below only looks where the region is
  const box = new Int32Array((nReg + 1) * 4);
  for (let a = 0; a <= nReg; a++) { box[a * 4] = w; box[a * 4 + 1] = h; box[a * 4 + 2] = -1; box[a * 4 + 3] = -1; }
  for (let i = 0; i < region.length; i++) {
    const a = region[i]; if (!a) continue; const x = i % w, y = (i - x) / w, k = a * 4;
    if (x < box[k]) box[k] = x; if (y < box[k + 1]) box[k + 1] = y; if (x > box[k + 2]) box[k + 2] = x; if (y > box[k + 3]) box[k + 3] = y;
  }
  const each = (a: number, fn: (i: number, x: number, y: number) => void) => {
    const k = a * 4;
    for (let y = box[k + 1]; y <= box[k + 3]; y++) for (let x = box[k]; x <= box[k + 2]; x++) { const i = y * w + x; if (region[i] === a) fn(i, x, y); }
  };
  const centre = (a: number, keep: (i: number) => boolean = () => true): [number, number] => {
    let sx = 0, sy = 0, n = 0;
    each(a, (i, x, y) => { if (keep(i)) { sx += x; sy += y; n++; } });
    return n ? [sx / n, sy / n] : [(box[a * 4] + box[a * 4 + 2]) / 2, (box[a * 4 + 1] + box[a * 4 + 3]) / 2];
  };
  const touches = (i: number, p: number) => { for (const o of N4(w)) { const j = inside(i, o); if (j >= 0 && region[j] === p) return true; } return false; };

  const labels = new Uint8Array(w * h);
  const parts: ShapePart[] = [];
  const idx = new Map<number, number>(); // region -> part index
  const [bx, by] = centre(root);
  const counts: Record<ShapeKind, number> = { body: 0, leg: 0, top: 0, side: 0, piece: 0 };
  const far = new Float32Array(w * h);
  for (const a of order) {
    if (parts.length >= 60) break;
    if (a === root) {
      parts.push({ kind: "body", n: 1, tip: 0, pivot: centre(a), parent: -1, z: 5 });
      idx.set(a, 0); each(a, (i) => (labels[i] = 1));
      continue;
    }
    const pa = parentOf.get(a)!, pIdx = idx.get(pa) ?? 0;
    // walk from where it meets its parent: how far each pixel is along the part
    const q: number[] = [];
    each(a, (i) => { far[i] = -1; if (touches(i, pa)) { far[i] = 0; q.push(i); } });
    let L = 0;
    for (let h0 = 0; h0 < q.length; h0++) {
      const i = q[h0];
      for (const o of N4(w)) { const j = inside(i, o); if (j >= 0 && region[j] === a && far[j] < 0) { far[j] = far[i] + 1; if (far[j] > L) L = far[j]; q.push(j); } }
    }
    const pivot = q.length ? centre(a, (i) => far[i] === 0) : centre(a);
    const [cx, cy] = centre(a), dx = cx - bx, dy = cy - by;
    // a separate drawing that does not touch the rest is just a piece
    const kind: ShapeKind = !q.length ? "piece" : dy > Math.abs(dx) * 0.6 ? "leg" : -dy > Math.abs(dx) ? "top" : Math.abs(dx) > 1 ? "side" : "piece";
    const num = ++counts[kind], first = parts.length;
    parts.push({ kind, n: num, tip: 0, pivot, parent: pIdx, z: 6 + 0.01 * num });
    idx.set(a, first);
    // long thin parts bend in the middle (knees, the middle of a tail)
    const width = Math.max(2, thickOf[a] * 2);
    const segs = detail >= 1 && q.length && L > width * 2.4 ? (detail === 2 && L > width * 3.6 ? 3 : 2) : 1;
    each(a, (i) => { labels[i] = first + 1 + (segs === 1 || far[i] < 0 ? 0 : Math.min(segs - 1, Math.floor((far[i] / (L + 1)) * segs))); });
    for (let s = 1; s < segs; s++) {
      const cut = (L * s) / segs;
      parts.push({ kind, n: num, tip: s, pivot: centre(a, (i) => Math.abs(far[i] - cut) <= 1.5), parent: first + s - 1, z: parts[first].z + 0.001 * s });
    }
  }
  if (parts.length < 2) return null;
  return { labels, parts };
}
