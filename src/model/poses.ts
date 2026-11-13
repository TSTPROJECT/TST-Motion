// Poses: copy the whole character's pose from one frame to another, keep poses in a library,
// flip a pose left-right, and close an animation into a smooth loop.
import type { Chan, Layer, Project } from "./types.ts";
import { PROPS } from "./types.ts";
import { valueAt, chanDefault } from "./anim.ts";

export type PoseValues = Record<string, Record<Chan, number>>;

/** Values that make up a pose (not size or see-through, which belong to the design rather than the pose). */
const POSE_SKIP = new Set<Chan>(["sx", "sy", "o"]);
function chansOf(l: Layer): Chan[] {
  const s = new Set<Chan>(PROPS.filter((c) => !POSE_SKIP.has(c)));
  for (const k of Object.keys(l.tracks)) if (l.tracks[k]?.length && !POSE_SKIP.has(k)) s.add(k);
  if (l.face) { s.add("turn"); s.add("nod"); }
  for (const pn of l.pins ?? []) { s.add(`pin:${pn.id}:x`); s.add(`pin:${pn.id}:y`); }
  return [...s];
}

/** The layer and everything that follows it. */
export function family(p: Project, id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const l of p.layers) if (l.parent && out.has(l.parent) && !out.has(l.id)) { out.add(l.id); grew = true; } }
  return out;
}

/** Pose at a frame. `only` limits it to some layers. */
export function poseValues(p: Project, f: number, only?: Set<string>): PoseValues {
  const out: PoseValues = {};
  for (const l of p.layers) {
    if (only && !only.has(l.id)) continue;
    const v: Record<Chan, number> = {};
    for (const ch of chansOf(l)) v[ch] = Math.round(valueAt(l, ch, f) * 1000) / 1000;
    out[l.id] = v;
  }
  return out;
}

/** Name with left and right swapped ("แขนซ้าย" ↔ "แขนขวา", "Left arm" ↔ "Right arm", "arm_L" ↔ "arm_R"), or null. */
export function mirrorName(name: string): string | null {
  const swaps: Array<[RegExp, (m: string) => string]> = [
    [/ซ้าย|ขวา/g, (m) => (m === "ซ้าย" ? "ขวา" : "ซ้าย")],
    [/left|right/gi, (m) => { const r = /left/i.test(m) ? "right" : "left"; return m[0] === m[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r; }],
    [/(?<![a-z])[LR](?![a-z])/g, (m) => (m === "L" ? "R" : "L")],
  ];
  for (const [re, fn] of swaps) { re.lastIndex = 0; if (re.test(name)) { re.lastIndex = 0; return name.replace(re, fn); } }
  return null;
}

/**
 * The same pose seen in a mirror: left and right parts trade their turns (turned the other way),
 * parts in the middle turn the other way, a 3D head looks the other way.
 */
export function mirrorPose(p: Project, v: PoseValues): PoseValues {
  const byName = new Map(p.layers.map((l) => [l.name, l]));
  const out: PoseValues = {};
  for (const l of p.layers) {
    if (!v[l.id]) continue;
    const twinName = mirrorName(l.name), twin = twinName ? byName.get(twinName) : undefined;
    const src = twin && v[twin.id] ? twin : l, sv = v[src.id], o: Record<Chan, number> = { ...v[l.id] };
    // a turn away from the setup pose becomes the same turn the other way
    const delta = (ch: Chan) => (sv[ch] ?? 0) - (src.base[ch] ?? chanDefault(ch));
    o.rot = (l.base.rot ?? 0) - delta("rot");
    if ("turn" in o) o.turn = -(sv.turn ?? 0);
    for (const k of Object.keys(o)) if (k.startsWith("pin:") && k.endsWith(":x") && src === l) o[k] = -(sv[k] ?? 0);
    out[l.id] = o;
  }
  return out;
}
