// Hair and cloth that sway by themselves: each such part is a spring hanging from its pivot.
// When the point it hangs from speeds up, slows down or turns, the part lags behind and swings back.
// The whole clip is simulated from frame 0, so every frame (and the export) always looks the same.
import type { Layer, Project, Sway } from "./types";
import { solve, apply, type Solved, type SwayTable } from "./anim.ts";

export const SWAY_DEFAULT: Sway = { amt: 1, stiff: 0.45, damp: 0.35, wind: 0 };
const MAX = 70; // degrees

/** Extra turn (degrees) for every swaying part at every frame. */
export function simulate(p: Project): SwayTable {
  const out: SwayTable = new Map();
  const parts = p.layers.filter((l) => l.sway && l.sway.amt > 0);
  if (!parts.length) return out;
  const n = p.frames;
  for (const l of parts) out.set(l.id, new Float32Array(n));
  const st = new Map(parts.map((l) => [l.id, { th: 0, om: 0, hist: [] as Array<[number, number]>, ang: [] as number[] }]));
  const sizeOf = new Map(p.assets.map((a) => [a.id, a]));
  const phase = (l: Layer) => { let h = 0; for (const ch of l.id) h = (h * 31 + ch.charCodeAt(0)) % 1000; return (h / 1000) * Math.PI * 2; };
  for (let f = 0; f < n; f++) {
    const cur = new Map<string, Float32Array>();
    for (const l of parts) { const a = out.get(l.id)!; a[f] = st.get(l.id)!.th; cur.set(l.id, a); }
    const S: Solved = solve(p, f, cur);
    for (const l of parts) {
      const s = st.get(l.id)!, cfg = l.sway!, m = S.world.get(l.id)!;
      const piv = apply(m, l.px, l.py);
      const as = l.asset ? sizeOf.get(l.asset) : undefined;
      const far = as ? apply(m, as.w / 2, as.h / 2) : [piv[0], piv[1] + 50];
      let dx = far[0] - piv[0], dy = far[1] - piv[1];
      const len = Math.max(20, Math.hypot(dx, dy) * 2); dx /= len / 2; dy /= len / 2;
      // the direction of the part it hangs from (its own turn without the sway)
      const pm = l.parent ? S.world.get(l.parent) : null;
      const ang = pm ? Math.atan2(pm[1], pm[0]) : 0;
      s.hist.push(piv); s.ang.push(ang);
      if (s.hist.length > 3) { s.hist.shift(); s.ang.shift(); }
      const fps = p.fps || 30;
      const w0 = 2 * Math.PI * (0.5 + cfg.stiff * 2.5) / fps; // natural swing speed
      const k = w0 * w0, c = 2 * (0.08 + cfg.damp * 0.9) * w0;
      let acc = 0;
      if (s.hist.length === 3) {
        const [a, b, cc] = s.hist;
        const ax = cc[0] - 2 * b[0] + a[0], ay = cc[1] - 2 * b[1] + a[1];
        // the part is pushed the other way to where its anchor speeds up
        acc += (-(dx * ay - dy * ax) / (len / 2)) * cfg.amt * 2.2;
        let da = (s.ang[2] - s.ang[1]) - (s.ang[1] - s.ang[0]);
        while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        acc -= da * cfg.amt;
      }
      const windT = cfg.wind > 0 ? cfg.wind * 10 * (Math.PI / 180) * Math.sin((2 * Math.PI * 0.45 * f) / fps + phase(l)) : 0;
      const th = (s.th * Math.PI) / 180;
      const om = s.om + acc - k * (th - windT) - c * s.om;
      let nth = ((th + om) * 180) / Math.PI;
      if (nth > MAX) nth = MAX; else if (nth < -MAX) nth = -MAX;
      s.om = om; s.th = nth;
    }
  }
  return out;
}

// One simulation per change of the project; parts that do not sway cost nothing.
let cacheKey = "", cacheTable: SwayTable = new Map();
export function swayFor(p: Project): SwayTable {
  if (!p.layers.some((l) => l.sway && l.sway.amt > 0)) return new Map();
  const key = p.id + "|" + p.frames + "|" + p.fps + "|" + JSON.stringify(p.layers);
  if (key !== cacheKey) { cacheKey = key; cacheTable = simulate(p); }
  return cacheTable;
}
/** solve() with the sway included: what the canvas and the export show. */
export const solveShown = (p: Project, f: number) => solve(p, f, swayFor(p));
