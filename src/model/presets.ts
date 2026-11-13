// One-click motions: breathe, blink, nod, shake the head, wave, bounce, sway.
// Parts are found by their names (the automatic cut names them: หัว, ตัว, แขนขวา ...); when a part is
// missing, the selected part is used. Every motion starts from the pose at the current frame.
import type { Chan, Ease, Layer, Project } from "./types.ts";
import { valueAt, solve, apply } from "./anim.ts";

export type Put = (l: Layer, ch: Chan, v: number, f: number, e?: Ease) => void;
export type PresetId = "breathe" | "blink" | "nod" | "shake" | "wave" | "bounce" | "sway";
export const PRESETS: PresetId[] = ["breathe", "blink", "nod", "shake", "wave", "bounce", "sway"];

const has = (re: RegExp, not?: RegExp) => (l: Layer) => re.test(l.name) && !(not && not.test(l.name));
const isBody = has(/ลำตัว|ตัว|body|torso|chest/i, /ตัวละคร/);
const isHead = has(/หัว|หน้า|head|face/i, /ผม|hair/i);
const isEye = has(/ตา|eye/i, /ผม|hair|คิ้ว|brow/i);
const isRightUpper = has(/(ต้นแขน|แขน)\s*ขวา|right\s*(upper\s*)?arm/i, /ท่อนล่าง|forearm|มือ|hand/i);
const isRightFore = has(/แขนท่อนล่าง\s*ขวา|right\s*forearm/i);

function familySize(p: Project, id: string) {
  let n = 0; const seen = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const l of p.layers) if (l.parent && seen.has(l.parent) && !seen.has(l.id)) { seen.add(l.id); n++; grew = true; } }
  return n;
}
/** The part everything hangs from (the character as a whole). */
export function rootOf(p: Project): Layer | null {
  const roots = p.layers.filter((l) => !l.parent && l.visible);
  return roots.sort((a, b) => familySize(p, b.id) - familySize(p, a.id))[0] ?? null;
}

/** Length of one go of each motion, in seconds. */
const LEN: Record<PresetId, number> = { breathe: 2.4, blink: 3, nod: 1.2, shake: 1.4, wave: 2.4, bounce: 0.8, sway: 3 };

/**
 * Write a motion starting at frame f0. `whole`: repeat it to the end of the clip.
 * Returns the names of the parts that moved (empty: nothing suitable was found).
 */
export function applyPreset(p: Project, id: PresetId, f0: number, whole: boolean, selected: string | null, put: Put): string[] {
  const sel = p.layers.find((l) => l.id === selected) ?? null;
  const n = Math.max(4, Math.round(LEN[id] * p.fps));
  const moved = new Set<string>();
  const last = p.frames - 1;
  const at = (l: Layer, ch: Chan, df: number, v: number, e: Ease = "smooth", g0 = f0) => {
    const f = g0 + Math.round(df);
    if (f > last) return;
    put(l, ch, Math.round(v * 1000) / 1000, f, e); moved.add(l.name);
  };
  const runs: number[] = [];
  for (let g = f0; g <= last && (whole || g === f0); g += n) runs.push(g);
  const body = p.layers.find(isBody) ?? rootOf(p) ?? sel;
  const head = p.layers.find(isHead) ?? sel;
  const root = rootOf(p) ?? sel;

  for (const g of runs) {
    const k = (df: number) => g + Math.round(df * n); // df: 0..1 of one go
    if (id === "breathe" && body) {
      const sy = valueAt(body, "sy", f0), y = valueAt(body, "y", f0);
      at(body, "sy", 0, sy, "smooth", k(0)); at(body, "sy", 0, sy * 1.025, "smooth", k(0.5)); at(body, "sy", 0, sy, "smooth", k(1) - 1);
      if (head && head !== body && head.parent) { const hy = valueAt(head, "y", f0); at(head, "y", 0, hy, "smooth", k(0)); at(head, "y", 0, hy - 3, "smooth", k(0.5)); at(head, "y", 0, hy, "smooth", k(1) - 1); }
      void y;
    }
    if (id === "blink") {
      const eyes = p.layers.filter(isEye);
      const list = eyes.length ? eyes : sel ? [sel] : [];
      const t = k(0.7);
      for (const e of list) {
        if (e.swaps?.length) { at(e, "swap", 0, 0, "hold", k(0)); at(e, "swap", 0, 1, "hold", t); at(e, "swap", 0, 0, "hold", t + 4); }
        else { const sy = valueAt(e, "sy", f0); at(e, "sy", 0, sy, "hold", k(0)); at(e, "sy", 0, sy, "linear", t); at(e, "sy", 0, sy * 0.1, "linear", t + 2); at(e, "sy", 0, sy, "linear", t + 5); }
      }
    }
    if ((id === "nod" || id === "shake") && head) {
      const ch: Chan = head.face ? (id === "nod" ? "nod" : "turn") : id === "nod" ? "y" : "rot";
      const v0 = valueAt(head, ch, f0), amp = head.face ? (id === "nod" ? 0.5 : 0.6) : id === "nod" ? 12 : 8;
      const seq = id === "nod" ? [0, 1, 0, 1, 0] : [0, -1, 1, -1, 0];
      seq.forEach((s, i) => at(head, ch, 0, v0 + s * amp, "smooth", k(i / (seq.length - 1)) - (i === seq.length - 1 ? 1 : 0)));
    }
    if (id === "wave") {
      const upper = p.layers.find(isRightUpper) ?? sel;
      if (upper) {
        const fore = p.layers.find(isRightFore) ?? p.layers.find((l) => l.parent === upper.id) ?? null;
        // raise the arm away from the body: which way depends on which side of the body it hangs
        const S = solve(p, f0), ref = body && body !== upper ? body : root;
        const ux = apply(S.world.get(upper.id)!, upper.px, upper.py)[0], bx = ref ? apply(S.world.get(ref.id)!, ref.px, ref.py)[0] : ux - 1;
        const sign = ux < bx ? 1 : -1, r0 = valueAt(upper, "rot", f0);
        at(upper, "rot", 0, r0, "out", k(0)); at(upper, "rot", 0, r0 + sign * 140, "smooth", k(0.18));
        at(upper, "rot", 0, r0 + sign * 140, "smooth", k(0.82)); at(upper, "rot", 0, r0, "smooth", k(1) - 1);
        if (fore) {
          const f0r = valueAt(fore, "rot", f0);
          at(fore, "rot", 0, f0r, "smooth", k(0.18));
          for (let i = 1; i <= 6; i++) at(fore, "rot", 0, f0r + (i % 2 ? 1 : -1) * sign * 28, "smooth", k(0.18 + (0.64 * i) / 7));
          at(fore, "rot", 0, f0r, "smooth", k(0.82));
        }
      }
    }
    if (id === "bounce" && root) {
      const y = valueAt(root, "y", f0), sy = valueAt(root, "sy", f0), sx = valueAt(root, "sx", f0);
      at(root, "y", 0, y, "out", k(0)); at(root, "y", 0, y - Math.max(20, p.h * 0.03), "in", k(0.45)); at(root, "y", 0, y, "out", k(0.9));
      at(root, "sy", 0, sy, "smooth", k(0.9)); at(root, "sy", 0, sy * 0.95, "out", k(0.95)); at(root, "sy", 0, sy, "smooth", k(1) - 1);
      at(root, "sx", 0, sx, "smooth", k(0.9)); at(root, "sx", 0, sx * 1.03, "out", k(0.95)); at(root, "sx", 0, sx, "smooth", k(1) - 1);
    }
    if (id === "sway" && root) {
      const r = valueAt(root, "rot", f0);
      at(root, "rot", 0, r, "smooth", k(0)); at(root, "rot", 0, r + 2.5, "smooth", k(0.25)); at(root, "rot", 0, r - 2.5, "smooth", k(0.75)); at(root, "rot", 0, r, "smooth", k(1) - 1);
    }
  }
  return [...moved];
}
