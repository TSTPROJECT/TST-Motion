// Bending a picture: pins (drag one, the picture bends round the others) and the 3D head turn.
// Pure maths on a grid of points over the picture, so it can be tested and drawn anywhere.
import type { Face } from "./types";

/** The picture is drawn as GRID × GRID little squares; the renderer uses the same number. */
export const GRID = 32;
export type P = [number, number];

/**
 * Where point v goes when pins at `src` are moved to `dst` (as-rigid-as-possible moving least squares):
 * near a pin the picture follows that pin, in between it turns and shifts without stretching.
 */
export function pinPoint(src: P[], dst: P[], v: P): P {
  const n = src.length;
  if (n === 0) return v;
  let sw = 0, px = 0, py = 0, qx = 0, qy = 0;
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const dx = src[i][0] - v[0], dy = src[i][1] - v[1], d2 = dx * dx + dy * dy;
    if (d2 < 1e-8) return [dst[i][0], dst[i][1]];
    w[i] = 1 / d2; sw += w[i];
    px += w[i] * src[i][0]; py += w[i] * src[i][1]; qx += w[i] * dst[i][0]; qy += w[i] * dst[i][1];
  }
  px /= sw; py /= sw; qx /= sw; qy /= sw;
  // best turn (no stretch) taking the pins' spread from before to after
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[i][0] - px, ay = src[i][1] - py, bx = dst[i][0] - qx, by = dst[i][1] - qy;
    a += w[i] * (ax * bx + ay * by); b += w[i] * (ax * by - ay * bx);
  }
  const r = Math.hypot(a, b), c = r > 1e-12 ? a / r : 1, s = r > 1e-12 ? b / r : 0;
  const ux = v[0] - px, uy = v[1] - py;
  return [c * ux - s * uy + qx, s * ux + c * uy + qy];
}

/** The rest point that `pinPoint` sends to q (for adding a pin onto an already bent picture). */
export function unpinPoint(src: P[], dst: P[], q: P): P {
  let r: P = [q[0], q[1]];
  for (let k = 0; k < 12; k++) {
    const f = pinPoint(src, dst, r);
    r = [r[0] + (q[0] - f[0]), r[1] + (q[1] - f[1])];
  }
  return r;
}

const DEG = Math.PI / 180;
/** The largest head turn (turn = ±1) and nod (nod = ±1), in degrees. */
export const TURN_MAX = 35, NOD_MAX = 25;

/** Where a point on (or `depth` px above) a head turned by turn/nod (-1..1) ends up, in the head's pixels. */
export function facePoint(f: Face, turn: number, nod: number, x: number, y: number, depth = 0): P {
  const u = (x - f.cx) / f.rx, v = (y - f.cy) / f.ry;
  const z = Math.sqrt(Math.max(0, 1 - u * u - v * v)) + depth / Math.max(1, f.rx);
  const a = turn * TURN_MAX * DEG, b = nod * NOD_MAX * DEG;
  const u1 = u * Math.cos(a) + z * Math.sin(a), z1 = -u * Math.sin(a) + z * Math.cos(a);
  const v1 = v * Math.cos(b) + z1 * Math.sin(b);
  return [f.cx + u1 * f.rx, f.cy + v1 * f.ry];
}
/** How much a small part sitting at x,y gets narrower / shorter when the head turns (1 = not at all). */
export function faceSquash(f: Face, turn: number, nod: number, x: number, y: number): P {
  const u = (x - f.cx) / f.rx, v = (y - f.cy) / f.ry;
  const z = Math.max(0.3, Math.sqrt(Math.max(0, 1 - u * u - v * v)));
  const a = turn * TURN_MAX * DEG, b = nod * NOD_MAX * DEG;
  const cl = (k: number) => Math.min(1.35, Math.max(0.25, k));
  return [cl(Math.cos(a) - (u / z) * Math.sin(a)), cl(Math.cos(b) - (v / z) * Math.sin(b))];
}

/**
 * Grid points (GRID+1)² × 2 in the picture's own pixels after bending, or null when nothing bends.
 * pins: rest points and where they are now; face: head turn applied after the pins.
 */
export function warpGrid(w: number, h: number, pins: { src: P[]; dst: P[] } | null, face: { f: Face; turn: number; nod: number } | null): Float32Array | null {
  const usePins = !!pins && pins.src.length > 0 && pins.src.some((s, i) => s[0] !== pins.dst[i][0] || s[1] !== pins.dst[i][1]);
  const useFace = !!face && (face.turn !== 0 || face.nod !== 0);
  if (!usePins && !useFace) return null;
  const out = new Float32Array((GRID + 1) * (GRID + 1) * 2);
  for (let gy = 0, k = 0; gy <= GRID; gy++) for (let gx = 0; gx <= GRID; gx++) {
    let p: P = [(gx / GRID) * w, (gy / GRID) * h];
    if (usePins) p = pinPoint(pins!.src, pins!.dst, p);
    if (useFace) p = facePoint(face!.f, face!.turn, face!.nod, p[0], p[1]);
    out[k++] = p[0]; out[k++] = p[1];
  }
  return out;
}

/** A point of the picture after bending (same rules as warpGrid). */
export function warpOne(pins: { src: P[]; dst: P[] } | null, face: { f: Face; turn: number; nod: number } | null, x: number, y: number): P {
  let p: P = [x, y];
  if (pins && pins.src.length) p = pinPoint(pins.src, pins.dst, p);
  if (face && (face.turn || face.nod)) p = facePoint(face.f, face.turn, face.nod, p[0], p[1]);
  return p;
}
