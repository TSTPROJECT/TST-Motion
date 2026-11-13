// Pure animation maths: easing, sampling keyframes, layer matrices.
// No DOM here, so it runs in tests and (later) in the export worker.
import type { Chan, Ease, Key, Layer, Project } from "./types";
import { warpGrid, facePoint, faceSquash, type P } from "./warp.ts";

export const EASES: Record<Ease, (u: number) => number> = {
  smooth: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
  linear: (u) => u,
  in: (u) => u * u * u,
  out: (u) => 1 - Math.pow(1 - u, 3),
  back: (u) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
  },
  hold: () => 0,
  curve: (u) => u, // replaced by the key's own curve in sampleKeys
};

/** CSS-style cubic-bezier speed curve: progress (0..1 of the time) -> progress of the value. */
export function bezier(c: [number, number, number, number], u: number): number {
  const [x1, y1, x2, y2] = c;
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1, t = u;
  for (let i = 0; i < 30; i++) { t = (lo + hi) / 2; if (bx(t) < u) lo = t; else hi = t; }
  return by(t);
}
export const easeFn = (k: Key) => (k.e === "curve" && k.c ? (u: number) => bezier(k.c!, u) : EASES[k.e] ?? EASES.smooth);

/** Value of a track at a (possibly fractional) frame. */
export function sampleKeys(keys: Key[] | undefined, frame: number, fallback: number): number {
  if (!keys || keys.length === 0) return fallback;
  if (frame <= keys[0].f) return keys[0].v;
  const last = keys[keys.length - 1];
  if (frame >= last.f) return last.v;
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].f <= frame) lo = mid; else hi = mid;
  }
  const a = keys[lo], b = keys[hi];
  const u = easeFn(a)((frame - a.f) / (b.f - a.f));
  return a.v + (b.v - a.v) * u;
}

/** Value when nothing was set: sizes and opacity start at 1, everything else at 0. */
export const chanDefault = (ch: Chan) => (ch === "sx" || ch === "sy" || ch === "o" ? 1 : 0);
export function valueAt(layer: Layer, ch: Chan, frame: number): number {
  return sampleKeys(layer.tracks[ch], frame, layer.base[ch] ?? chanDefault(ch));
}
/** Which picture a part shows at a frame: its own, one of its swaps, or none (null). */
export function pictureAt(layer: Layer, frame: number): string | null {
  const k = Math.round(valueAt(layer, "swap", frame));
  if (k < 0) return null;
  return k === 0 ? layer.asset : layer.swaps?.[k - 1] ?? layer.asset;
}

export interface Pose { x: number; y: number; rot: number; sx: number; sy: number; o: number }
export function poseAt(layer: Layer, frame: number): Pose {
  return {
    x: valueAt(layer, "x", frame),
    y: valueAt(layer, "y", frame),
    rot: valueAt(layer, "rot", frame),
    sx: valueAt(layer, "sx", frame),
    sy: valueAt(layer, "sy", frame),
    o: valueAt(layer, "o", frame),
  };
}

/** 2D affine matrix [a c e; b d f; 0 0 1], same layout as canvas setTransform. */
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
/** Local matrix: image pixel -> parent space. Pivot lands on (x, y). */
export function localMatrix(p: Pose, px: number, py: number): Mat {
  const r = (p.rot * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const a = cos * p.sx, b = sin * p.sx, c = -sin * p.sy, d = cos * p.sy;
  return [a, b, c, d, p.x - (a * px + c * py), p.y - (b * px + d * py)];
}

export interface Solved {
  world: Map<string, Mat>; alpha: Map<string, number>; pose: Map<string, Pose>;
  /** for parts with a soft joint: where the picture would be if it had not turned from its setup pose (follows the parent only) */
  follow: Map<string, Mat>;
  /** bent pictures (pins, 3D head turn): grid points in the picture's own pixels (see warp.ts) */
  deform: Map<string, Float32Array>;
  /** picture shown by each part (image swap); null = hidden */
  pic: Map<string, string | null>;
}
/** Extra turn (degrees) per part and frame, from the sway simulation (physics.ts). */
export type SwayTable = Map<string, Float32Array>;

/** Default depth of a 3D head's child: in front if drawn above the head, behind if drawn below. */
export function depthOf(project: Project, l: Layer, head: Layer): number {
  if (l.depth !== undefined) return l.depth;
  const f = head.face!; const front = project.layers.indexOf(l) > project.layers.indexOf(head);
  return (front ? 0.18 : -0.3) * f.rx;
}

/** World matrices (layer image -> composition pixels) and combined opacity for every layer. */
export function solve(project: Project, frame: number, sway?: SwayTable | null): Solved {
  const byId = new Map(project.layers.map((l) => [l.id, l]));
  const sizeOf = new Map(project.assets.map((a) => [a.id, a]));
  const world = new Map<string, Mat>(), alpha = new Map<string, number>(), pose = new Map<string, Pose>(), follow = new Map<string, Mat>();
  const deform = new Map<string, Float32Array>(), pic = new Map<string, string | null>();
  const visiting = new Set<string>();
  const fi = Math.max(0, Math.round(frame));
  const visit = (l: Layer): void => {
    if (world.has(l.id)) return;
    const p = poseAt(l, frame);
    pose.set(l.id, p);
    const extra = sway?.get(l.id)?.[Math.min(fi, (sway.get(l.id)?.length ?? 1) - 1)] ?? 0;
    let m = localMatrix(extra ? { ...p, rot: p.rot + extra } : p, l.px, l.py), a = clamp01(p.o);
    const parent = l.parent ? byId.get(l.parent) : undefined;
    if (parent && !visiting.has(parent.id)) {
      visiting.add(l.id);
      visit(parent);
      visiting.delete(l.id);
      // a part on a turning 3D head slides over the head's surface by its depth
      let pre: Mat | null = null;
      if (parent.face) {
        const turn = valueAt(parent, "turn", frame), nod = valueAt(parent, "nod", frame);
        if (turn || nod) {
          const as = l.asset ? sizeOf.get(l.asset) : undefined;
          const c = as ? apply(m, as.w / 2, as.h / 2) : apply(m, l.px, l.py);
          const t = facePoint(parent.face, turn, nod, c[0], c[1], depthOf(project, l, parent));
          const [kx, ky] = faceSquash(parent.face, turn, nod, c[0], c[1]);
          pre = [kx, 0, 0, ky, t[0] - kx * c[0], t[1] - ky * c[1]];
        }
      }
      const pw = world.get(parent.id)!, pwp = pre ? mul(pw, pre) : pw;
      if (l.bend && l.bend > 0) follow.set(l.id, mul(pwp, localMatrix({ ...l.base, x: p.x, y: p.y }, l.px, l.py)));
      m = mul(pwp, m);
      a *= alpha.get(parent.id)!;
    }
    world.set(l.id, m);
    alpha.set(l.id, a);
    const shown = pictureAt(l, frame);
    pic.set(l.id, shown);
    // bending: pins first, then the 3D turn of the part itself
    const as = shown ? sizeOf.get(shown) : undefined;
    if (as && shown === l.asset && (l.pins?.length || l.face)) {
      const pins = l.pins?.length ? { src: l.pins.map((q): P => [q.x, q.y]), dst: l.pins.map((q): P => [q.x + valueAt(l, `pin:${q.id}:x`, frame), q.y + valueAt(l, `pin:${q.id}:y`, frame)]) } : null;
      const face = l.face ? { f: l.face, turn: valueAt(l, "turn", frame), nod: valueAt(l, "nod", frame) } : null;
      const g = warpGrid(as.w, as.h, pins, face);
      if (g) deform.set(l.id, g);
    }
  };
  project.layers.forEach(visit);
  return { world, alpha, pose, follow, deform, pic };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Frames (sorted, unique) that hold a key on any property of a layer. */
export function keyFrames(layer: Layer): number[] {
  const s = new Set<number>();
  for (const k of Object.values(layer.tracks)) k?.forEach((key) => s.add(key.f));
  return [...s].sort((a, b) => a - b);
}

/** Would making `child` follow `parent` create a loop? */
export function wouldCycle(project: Project, child: string, parent: string | null): boolean {
  const byId = new Map(project.layers.map((l) => [l.id, l]));
  let p = parent;
  while (p) {
    if (p === child) return true;
    p = byId.get(p)?.parent ?? null;
  }
  return false;
}

/** Split a matrix into position / rotation / scale (no skew). */
export function decompose(m: Mat): { x: number; y: number; rot: number; sx: number; sy: number } {
  const sx = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const sy = sx ? det / sx : Math.hypot(m[2], m[3]);
  return { x: m[4], y: m[5], rot: (Math.atan2(m[1], m[0]) * 180) / Math.PI, sx, sy };
}
