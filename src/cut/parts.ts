// Automatic body parts: from the joints a pose model found (shoulders, elbows, knees...) work out which
// part every pixel belongs to. Pure functions, no screen or model code, so they can be tested.

export type P = [number, number];
/** One joint: x, y in picture pixels and how sure the model is (0..1). */
export type Joint = [number, number, number];
/** 0 coarse (head, body, arms, legs) · 1 normal (arms and legs in two) · 2 fine (also hands, hair apart from face) */
export type Detail = 0 | 1 | 2;

export interface PartPlan {
  /** name key in the language table, e.g. "part_head" */
  key: string;
  /** bone lines the part grows around */
  bones: Array<[P, P]>;
  /** how thick the part is around its bones (pixels counted as "on the bone") */
  radius: number;
  /** for the body: the area between shoulders and hips counts as "on the bone" */
  poly?: P[];
  /** points that surely belong to this part (used to ask the cutting AI) */
  taps: P[];
  /** joint the part turns around */
  pivot: P;
  /** key of the part it follows (null = none) */
  parent: string | null;
  /** drawing order, low = further back */
  z: number;
}

// COCO joint numbers
const NOSE = 0, EYE_L = 1, EYE_R = 2, EAR_L = 3, EAR_R = 4, SH_L = 5, SH_R = 6, EL_L = 7, EL_R = 8, WR_L = 9, WR_R = 10,
  HIP_L = 11, HIP_R = 12, KN_L = 13, KN_R = 14, AN_L = 15, AN_R = 16;
export const MIN_SURE = 0.3;

const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const mulv = (a: P, k: number): P => [a[0] * k, a[1] * k];
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const len = (a: P) => Math.hypot(a[0], a[1]);
const dist = (a: P, b: P) => len(sub(a, b));
const norm = (a: P): P => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

/** Plan the parts for the found joints. Null when no person was found (shoulders unsure). */
export function planParts(joints: Joint[], detail: Detail): PartPlan[] | null {
  const at = (i: number): P | null => (joints[i] && joints[i][2] >= MIN_SURE ? [joints[i][0], joints[i][1]] : null);
  const sl = at(SH_L), sr = at(SH_R);
  if (!sl || !sr) return null;
  const neck = lerp(sl, sr, 0.5), sw = Math.max(8, dist(sl, sr));
  const hl0 = at(HIP_L), hr0 = at(HIP_R);
  const faceJ = [NOSE, EYE_L, EYE_R, EAR_L, EAR_R].map(at).filter((q): q is P => !!q);
  // which way is up: from the hips to the neck, else from the neck to the face, else the picture's up
  let up: P = hl0 || hr0 ? norm(sub(neck, lerp(hl0 ?? hr0!, hr0 ?? hl0!, 0.5))) : faceJ.length ? norm(sub(faceJ[0], neck)) : [0, -1];
  const hipC = hl0 || hr0 ? lerp(hl0 ?? hr0!, hr0 ?? hl0!, 0.5) : add(neck, mulv(up, -2.4 * sw));
  const side: P = norm(sub(sr, sl)); // from the left shoulder to the right one
  const hl = hl0 ?? add(hipC, mulv(side, -0.35 * sw)), hr = hr0 ?? add(hipC, mulv(side, 0.35 * sw));
  const headC: P = faceJ.length ? mulv(faceJ.reduce(add, [0, 0] as P), 1 / faceJ.length) : add(neck, mulv(up, 0.7 * sw));
  if (faceJ.length) up = norm(sub(headC, neck));
  const headR = Math.max(0.5 * sw, ...faceJ.map((q) => 1.5 * dist(q, headC)));
  const neckTop = lerp(neck, headC, 0.3), crown = add(headC, mulv(up, headR * 0.7));

  const parts: PartPlan[] = [];
  parts.push({
    key: "part_body", bones: [[neck, hipC], [sl, sr], [hl, hr]], radius: 0, poly: [sl, sr, hr, hl],
    taps: [lerp(neck, hipC, 0.35), lerp(neck, hipC, 0.7)], pivot: hipC, parent: null, z: 2,
  });
  const neckPivot = lerp(neck, headC, 0.2);
  if (detail === 2) {
    parts.push({ key: "part_face", bones: [[neckTop, headC]], radius: headR * 0.8, taps: [at(NOSE) ?? headC], pivot: neckPivot, parent: "part_body", z: 6 });
    parts.push({ key: "part_hair", bones: [[headC, crown]], radius: headR * 0.8, taps: [lerp(headC, crown, 0.75)], pivot: headC, parent: "part_face", z: 7 });
  } else {
    parts.push({ key: "part_head", bones: [[neckTop, crown]], radius: headR * 0.85, taps: [headC, lerp(headC, crown, 0.6)], pivot: neckPivot, parent: "part_body", z: 6 });
  }

  for (const [s, e, w, tag] of [[sl, EL_L, WR_L, "l"], [sr, EL_R, WR_R, "r"]] as const) {
    const el = at(e); if (!el) continue;
    const wr = at(w) ?? add(el, sub(el, s)); // no wrist found: as long again as the upper arm
    const hand = add(wr, mulv(sub(wr, el), 0.45));
    const r = sw * 0.12;
    if (detail === 0) {
      parts.push({ key: `part_arm_${tag}`, bones: [[s, el], [el, wr], [wr, hand]], radius: r, taps: [lerp(s, el, 0.5), lerp(el, wr, 0.5), wr], pivot: s, parent: "part_body", z: 3 });
    } else {
      parts.push({ key: `part_uarm_${tag}`, bones: [[s, el]], radius: r, taps: [lerp(s, el, 0.5)], pivot: s, parent: "part_body", z: 3 });
      if (detail === 1) {
        parts.push({ key: `part_farm_${tag}`, bones: [[el, wr], [wr, hand]], radius: r, taps: [lerp(el, wr, 0.5), wr], pivot: el, parent: `part_uarm_${tag}`, z: 4 });
      } else {
        parts.push({ key: `part_farm_${tag}`, bones: [[el, wr]], radius: r, taps: [lerp(el, wr, 0.5)], pivot: el, parent: `part_uarm_${tag}`, z: 4 });
        parts.push({ key: `part_hand_${tag}`, bones: [[wr, hand]], radius: r, taps: [lerp(wr, hand, 0.4)], pivot: wr, parent: `part_farm_${tag}`, z: 5 });
      }
    }
  }
  for (const [h, k, a, tag] of [[hl, KN_L, AN_L, "l"], [hr, KN_R, AN_R, "r"]] as const) {
    const kn = at(k); if (!kn) continue;
    const an = at(a) ?? add(kn, mulv(sub(kn, h), 0.9));
    const foot = add(an, mulv(sub(an, kn), 0.2));
    const r = sw * 0.15;
    if (detail === 0) {
      parts.push({ key: `part_leg_${tag}`, bones: [[h, kn], [kn, an], [an, foot]], radius: r, taps: [lerp(h, kn, 0.5), lerp(kn, an, 0.5)], pivot: h, parent: "part_body", z: 1 });
    } else {
      parts.push({ key: `part_thigh_${tag}`, bones: [[h, kn]], radius: r, taps: [lerp(h, kn, 0.5)], pivot: h, parent: "part_body", z: 1 });
      parts.push({ key: `part_shin_${tag}`, bones: [[kn, an], [an, foot]], radius: r, taps: [lerp(kn, an, 0.5)], pivot: kn, parent: `part_thigh_${tag}`, z: 0 });
    }
  }
  return parts;
}

function segDist(px: number, py: number, a: P, b: P) {
  const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
  let t = l2 ? ((px - a[0]) * vx + (py - a[1]) * vy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - a[0] - t * vx, py - a[1] - t * vy);
}
function inside(px: number, py: number, poly: P[]) {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inn = !inn;
  }
  return inn;
}
/** How far a pixel is from a part (0 when on its bones). */
export function partDistance(part: PartPlan, x: number, y: number) {
  if (part.poly && inside(x, y, part.poly)) return 0;
  let d = Infinity;
  for (const [a, b] of part.bones) d = Math.min(d, segDist(x, y, a, b));
  return Math.max(0, d - part.radius);
}

/**
 * Give every visible pixel (alpha > 0) the number (1..n) of the part it belongs to. A pixel goes to the
 * nearest part, but the area the cutting AI found for a part counts as `pull` pixels nearer, so cuts
 * follow the drawing's own edges where the AI saw them and the bones elsewhere. That pull only reaches
 * `within[j]` pixels from part j (default: no limit), so a long coat the AI saw as "the arm's cloth"
 * does not follow the arm far beyond it.
 */
export function assignParts(w: number, h: number, alpha: Uint8Array, parts: PartPlan[], found: Array<Uint8Array | null>, pull: number, within: number[] = []): Uint8Array {
  const labels = new Uint8Array(w * h), n = parts.length, lim = parts.map((_, j) => within[j] ?? Infinity);
  // only look at the bones near enough to matter: each part's box grown by a generous margin
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!alpha[i]) continue;
    let best = 0, bestS = Infinity;
    for (let j = 0; j < n; j++) {
      const d = partDistance(parts[j], x + 0.5, y + 0.5), s = d - (found[j] && found[j]![i] && d <= lim[j] ? pull : 0);
      if (s < bestS) { bestS = s; best = j + 1; }
    }
    labels[i] = best;
  }
  return labels;
}

/**
 * Tidy the part map: a part's loose bits (well under the size of its main area) go to the part they touch
 * most, so every part comes out as one piece without crumbs.
 */
export function cleanLabels(labels: Uint8Array, w: number, h: number, keepFrac = 0.3) {
  const n = w * h, comp = new Int32Array(n), stack = new Int32Array(n);
  const sizes: number[] = [0], owner: number[] = [0];
  for (let p0 = 0; p0 < n; p0++) {
    const lab = labels[p0]; if (!lab || comp[p0]) continue;
    const id = sizes.length; let top = 0, size = 0; stack[top++] = p0; comp[p0] = id;
    while (top) {
      const p = stack[--top], x = p % w; size++;
      if (x > 0 && !comp[p - 1] && labels[p - 1] === lab) { comp[p - 1] = id; stack[top++] = p - 1; }
      if (x < w - 1 && !comp[p + 1] && labels[p + 1] === lab) { comp[p + 1] = id; stack[top++] = p + 1; }
      if (p >= w && !comp[p - w] && labels[p - w] === lab) { comp[p - w] = id; stack[top++] = p - w; }
      if (p + w < n && !comp[p + w] && labels[p + w] === lab) { comp[p + w] = id; stack[top++] = p + w; }
    }
    sizes.push(size); owner.push(lab);
  }
  const biggest = new Map<number, number>();
  for (let c = 1; c < sizes.length; c++) biggest.set(owner[c], Math.max(biggest.get(owner[c]) ?? 0, sizes[c]));
  const loose = new Set<number>();
  for (let c = 1; c < sizes.length; c++) if (sizes[c] < keepFrac * biggest.get(owner[c])!) loose.add(c);
  if (!loose.size) return;
  // count which other part each loose bit touches most
  const touch = new Map<number, Map<number, number>>();
  for (let p = 0; p < n; p++) {
    const c = comp[p]; if (!loose.has(c)) continue;
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= n) continue;
      const l = labels[q]; if (!l || l === owner[c] || loose.has(comp[q])) continue;
      let m = touch.get(c); if (!m) touch.set(c, (m = new Map()));
      m.set(l, (m.get(l) ?? 0) + 1);
    }
  }
  const to = new Map<number, number>();
  for (const [c, m] of touch) { let bl = 0, bv = -1; for (const [l, v] of m) if (v > bv) { bv = v; bl = l; } to.set(c, bl); }
  for (let p = 0; p < n; p++) { const t = to.get(comp[p]); if (t) labels[p] = t; }
}

/** Two parts that meet at a joint. Numbers are part numbers in the part map (1..n). */
export interface Link { back: number; front: number; child: number; pivot: P }
export interface Meeting { meet: P; wide: number; reach: number }
/**
 * Where a child part meets the part it follows, near the joint: the middle of the edge they share
 * (`meet`), how wide the child is just past it (`wide`) and how far the child reaches from the joint
 * (`reach`). Null when the two do not touch anywhere near.
 */
export function meeting(labels: Uint8Array, w: number, h: number, a: number, b: number, child: number, pivot: P): Meeting | null {
  // the child's middle: tells how long it is and which way it goes from the joint
  let sx = 0, sy = 0, c = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] === child) { sx += i % w; sy += (i / w) | 0; c++; }
  if (!c) return null;
  const mid: P = [sx / c, sy / c], reach = Math.max(6, dist(pivot, mid));
  // the shared edge; when the joint was guessed off the edge, take the part of the edge nearest to it
  const edge: number[] = [], far: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== a) continue;
    const x = i % w, y = (i - x) / w;
    if ((x > 0 && labels[i - 1] === b) || (x < w - 1 && labels[i + 1] === b) || (y > 0 && labels[i - w] === b) || (y < h - 1 && labels[i + w] === b)) {
      edge.push(i); far.push(Math.hypot(x - pivot[0], y - pivot[1]));
    }
  }
  if (!edge.length) return null;
  const nearest = Math.min(...far);
  if (nearest > reach * 1.5) return null;
  let cx = 0, cy = 0, cn = 0;
  for (let j = 0; j < edge.length; j++) if (far[j] <= nearest + reach * 0.5) { cx += edge[j] % w; cy += (edge[j] / w) | 0; cn++; }
  const meet: P = [cx / cn, cy / cn];
  // how wide the child is just past the edge (measured across the way it goes)
  const d = norm(sub(mid, meet)), across: P = [-d[1], d[0]];
  const isChild = (p: P) => { const x = Math.round(p[0]), y = Math.round(p[1]); return x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === child; };
  let at: P | null = null;
  for (let s = Math.max(2, reach * 0.1); s <= reach * 0.5; s += 1) { const p = add(meet, mulv(d, s)); if (isChild(p)) { at = p; break; } }
  if (!at) return null;
  let wide = 1;
  for (const sg of [1, -1]) for (let s = 1, miss = 0; s < reach * 2 && miss < 3; s++) { if (isChild(add(at, mulv(across, s * sg)))) { wide += 1 + miss; miss = 0; } else miss++; }
  return { meet, wide: Math.min(wide, reach * 0.8), reach };
}

/**
 * Where a part should turn: at the joint the pose model found, unless that is well off the edge the part
 * shares with the one it follows (a guessed knee inside a long coat, say); then at the middle of that edge.
 */
export function snapPivot(m: Meeting | null, pivot: P): P {
  return m && dist(pivot, m.meet) > Math.max(4, m.wide * 0.6) ? m.meet : pivot;
}

/**
 * Overlap at a joint. A picture has nothing drawn under a joint, so turning a part opens a gap there.
 * The part further back gets a band of the front part's pixels along the edge where they meet, near the
 * joint: hidden while still, and it fills the gap when either part turns (up to about 45°). The band is
 * a little under half as thick as the limb is wide. Returns the pixel numbers to add to `back` (empty when the parts do not meet).
 */
export function jointOverlap(labels: Uint8Array, w: number, h: number, link: Link, m = meeting(labels, w, h, link.back, link.front, link.child, link.pivot)): number[] {
  if (!m) return [];
  const { back, front } = link, { meet, wide, reach } = m;
  // a turn of about 45° moves the edge near the joint by about half the limb's width
  const band = Math.round(Math.min(Math.max(3, wide * 0.4), reach * 0.35));
  const near = wide * 0.6 + band, near2 = near * near;
  // grow from the back part's edge into the front part, `band` steps, staying near the meeting point
  const step = new Int16Array(labels.length).fill(-1), queue: number[] = [], out: number[] = [];
  const close = (i: number) => { const x = i % w, y = (i - x) / w; return (x - meet[0]) ** 2 + (y - meet[1]) ** 2 <= near2; };
  for (let i = 0; i < labels.length; i++) if (labels[i] === back && close(i)) { step[i] = 0; queue.push(i); }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi], s = step[i]; if (s >= band) continue;
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (step[j] >= 0 || labels[j] !== front || !close(j)) continue;
      step[j] = s + 1; queue.push(j); out.push(j);
    }
  }
  return out;
}

/**
 * Hide hairline seams. Where two parts touch, a screen that scales the picture blends each part's edge
 * with see-through, so a faint line shows between them. The part further back gets the front part's
 * pixels within `px` of their shared edge (they stay hidden under the front part). Parts at the same
 * height are drawn in number order, so the lower number counts as further back.
 * Returns, per part number, the pixel numbers to add.
 */
export function seamFill(labels: Uint8Array, w: number, h: number, z: (k: number) => number, px = 2): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, f = labels[i]; if (!f) continue;
    const zf = z(f); let got: number[] | null = null;
    for (let dy = -px; dy <= px; dy++) {
      const ny = y + dy; if (ny < 0 || ny >= h) continue;
      for (let dx = -px; dx <= px; dx++) {
        const nx = x + dx; if (nx < 0 || nx >= w) continue;
        const b = labels[ny * w + nx];
        if (!b || b === f || got?.includes(b)) continue;
        const zb = z(b); if (zb > zf || (zb === zf && b > f)) continue; // b is in front (same height: lower number is further back)
        (got ??= []).push(b);
      }
    }
    if (got) for (const b of got) { let a = out.get(b); if (!a) out.set(b, (a = [])); a.push(i); }
  }
  return out;
}
