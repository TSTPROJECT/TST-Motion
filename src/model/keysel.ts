// Keyframe editing on the timeline: pick several keys, move them together, copy, paste, delete.
// A picked key is a part's keyframe at one frame (all its values there move as one).
import { signal, effect } from "@preact/signals";
import { project } from "./store";
import type { Chan, Key, Layer, Project } from "./types";

/** Marks our keys on the system clipboard (so Ctrl+V knows whether to paste keys or a picture). */
export const CLIP_MARK = "tst-motion/keys";

/** Picked keys as "layerId@frame". */
export const selKeys = signal<Set<string>>(new Set());
export const keyId = (layer: string, f: number) => `${layer}@${f}`;
export const parseKey = (s: string): [string, number] => { const i = s.lastIndexOf("@"); return [s.slice(0, i), +s.slice(i + 1)]; };
export function setSel(ids: Iterable<string>) { selKeys.value = new Set(ids); }
export function toggleSel(id: string) { const s = new Set(selKeys.value); if (s.has(id)) s.delete(id); else s.add(id); selKeys.value = s; }
export const clearSel = () => { if (selKeys.value.size) selKeys.value = new Set(); };

/** Picked frames per part. */
export function byLayer(sel: Set<string>): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const s of sel) { const [id, f] = parseKey(s); (m.get(id) ?? m.set(id, []).get(id)!).push(f); }
  return m;
}

/** Move the picked keys by `d` frames (kept inside the animation). Keys already where they land are replaced. */
export function shiftKeys(p: Project, sel: Set<string>, d: number): Set<string> {
  const out = new Set<string>(), groups = byLayer(sel);
  const all = [...groups.values()].flat(); if (!all.length) return out;
  // the whole group moves the same amount, stopping at the start or end
  const dd = Math.max(-Math.min(...all), Math.min(p.frames - 1 - Math.max(...all), d));
  for (const [id, fs] of groups) {
    const l = p.layers.find((x) => x.id === id); if (!l) continue;
    const set = new Set(fs);
    for (const ch of Object.keys(l.tracks) as Chan[]) {
      const keys = l.tracks[ch]; if (!keys) continue;
      const moving = keys.filter((k) => set.has(k.f)).map((k) => ({ ...k, f: k.f + dd }));
      const landing = new Set(moving.map((k) => k.f));
      const stay = keys.filter((k) => !set.has(k.f) && !landing.has(k.f));
      l.tracks[ch] = [...stay, ...moving].sort((a, b) => a.f - b.f);
    }
    for (const f of fs) out.add(keyId(id, f + dd));
  }
  return out;
}

export function deleteKeys(p: Project, sel: Set<string>) {
  for (const [id, fs] of byLayer(sel)) {
    const l = p.layers.find((x) => x.id === id); if (!l) continue;
    const set = new Set(fs);
    for (const ch of Object.keys(l.tracks) as Chan[]) {
      const keys = l.tracks[ch]; if (!keys) continue;
      const left = keys.filter((k) => !set.has(k.f));
      // the last key of a value goes: keep its value as the still pose, so the part does not jump
      if (!left.length && keys.length) l.base[ch] = keys[0].v;
      if (left.length) l.tracks[ch] = left; else delete l.tracks[ch];
    }
  }
}

// ---------- copy / paste ----------
interface Copied { layer: string; name: string; keys: Partial<Record<Chan, Key[]>> }
let clip: { from: number; parts: Copied[] } | null = null;
export const hasClip = signal(false);

export function copyKeys(p: Project, sel: Set<string>): number {
  const parts: Copied[] = []; let from = Infinity, n = 0;
  for (const [id, fs] of byLayer(sel)) {
    const l = p.layers.find((x) => x.id === id); if (!l) continue;
    const set = new Set(fs); from = Math.min(from, ...fs);
    const keys: Copied["keys"] = {};
    for (const ch of Object.keys(l.tracks) as Chan[]) {
      const ks = l.tracks[ch]?.filter((k) => set.has(k.f)); if (ks?.length) keys[ch] = ks.map((k) => structuredClone(k));
    }
    parts.push({ layer: id, name: l.name, keys }); n += fs.length;
  }
  clip = parts.length ? { from, parts } : null; hasClip.value = !!clip;
  return n;
}

/**
 * Paste at frame `at`. Keys go back to the parts they came from; keys copied from one part go to
 * `target` instead when another part is picked (copy a wave from one arm to the other).
 */
export function pasteKeys(p: Project, at: number, target: string | null): Set<string> {
  const out = new Set<string>(); if (!clip) return out;
  const single = clip.parts.length === 1;
  for (const c of clip.parts) {
    const id = single && target ? target : c.layer;
    const l: Layer | undefined = p.layers.find((x) => x.id === id); if (!l) continue;
    for (const [ch, ks] of Object.entries(c.keys) as Array<[Chan, Key[]]>) {
      const keys = (l.tracks[ch] ??= []);
      for (const k of ks) {
        const f = at + (k.f - clip.from); if (f < 0 || f >= p.frames) continue;
        const i = keys.findIndex((q) => q.f === f), nk = { ...structuredClone(k), f };
        if (i >= 0) keys[i] = nk; else keys.push(nk);
        out.add(keyId(id, f));
      }
      keys.sort((a, b) => a.f - b.f);
    }
  }
  return out;
}

// a new project starts with nothing picked
let lastProject: string | undefined;
effect(() => { const id = project.value?.id; if (id !== lastProject) { lastProject = id; clearSel(); } });
