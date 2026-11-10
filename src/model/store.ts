// App state, editing actions and undo/redo.
import { signal, computed } from "@preact/signals";
import type { Background, Ease, Key, Layer, Prop, Project } from "./types";
import { PROPS, MAX_SECONDS } from "./types";
import { apply, decompose, invert, localMatrix, mul, poseAt, solve, valueAt, wouldCycle, IDENTITY } from "./anim";

export type Mode = "setup" | "animate";
export type Tool = "move" | "rotate" | "pivot" | "hand";
export type Tab = "tl" | "layers" | "props";

export const project = signal<Project | null>(null);
/** bumped after every change to the project, so views know to redraw */
export const rev = signal(0);
export const frame = signal(0);
export const playing = signal(false);
export const loop = signal(true);
export const selected = signal<string | null>(null);
export const mode = signal<Mode>("animate");
export const tool = signal<Tool>("move");
export const tab = signal<Tab>("tl");
export const canUndo = signal(false);
export const canRedo = signal(false);

export const selectedLayer = computed(() => {
  rev.value;
  const p = project.value, id = selected.value;
  return p && id ? p.layers.find((l) => l.id === id) ?? null : null;
});

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const snap = (p: Project) => JSON.stringify(p);

// ---------- history ----------
const undoStack: string[] = [];
const redoStack: string[] = [];
let pending: string | null = null;
const LIMIT = 120;
const listeners: Array<(p: Project) => void> = [];
export function onChange(fn: (p: Project) => void) { listeners.push(fn); }

function changed() {
  const p = project.value!;
  p.modified = Date.now();
  rev.value++;
  canUndo.value = undoStack.length > 0;
  canRedo.value = redoStack.length > 0;
  listeners.forEach((fn) => fn(p));
}
/** Run a change as one undo step. */
export function edit(fn: (p: Project) => void) {
  const p = project.value; if (!p) return;
  const before = snap(p);
  fn(p);
  if (snap(p) === before) return;
  undoStack.push(before); if (undoStack.length > LIMIT) undoStack.shift();
  redoStack.length = 0;
  changed();
}
/** For drags: start, change freely with live(), then finish once. */
export function begin() { const p = project.value; if (p) pending = snap(p); }
export function live(fn: (p: Project) => void) { const p = project.value; if (!p) return; fn(p); rev.value++; }
export function finish() {
  const p = project.value; if (!p || pending === null) return;
  if (snap(p) !== pending) { undoStack.push(pending); if (undoStack.length > LIMIT) undoStack.shift(); redoStack.length = 0; changed(); }
  pending = null;
}
export function undo() {
  const p = project.value; const prev = undoStack.pop(); if (!p || !prev) return;
  redoStack.push(snap(p)); project.value = JSON.parse(prev); fixSelection(); changed();
}
export function redo() {
  const p = project.value; const next = redoStack.pop(); if (!p || !next) return;
  undoStack.push(snap(p)); project.value = JSON.parse(next); fixSelection(); changed();
}
function fixSelection() {
  const p = project.value!;
  if (selected.value && !p.layers.some((l) => l.id === selected.value)) selected.value = null;
  if (frame.value >= p.frames) frame.value = p.frames - 1;
}
export function openProject(p: Project) {
  undoStack.length = 0; redoStack.length = 0; pending = null;
  playing.value = false; frame.value = 0; selected.value = p.layers.at(-1)?.id ?? null;
  project.value = p; canUndo.value = false; canRedo.value = false; rev.value++;
}
export function closeProject() { playing.value = false; project.value = null; selected.value = null; }

// ---------- creating ----------
export function newProject(name: string, w: number, h: number, fps = 30, seconds = 5): Project {
  const now = Date.now();
  return { format: "tst-motion", version: 1, id: uid(), name, w, h, fps, frames: Math.round(fps * seconds), bg: "alpha", layers: [], assets: [], created: now, modified: now };
}
export function makeLayer(name: string, asset: string | null, w: number, h: number, x: number, y: number, scale = 1): Layer {
  return { id: uid(), name, asset, parent: null, px: w / 2, py: h / 2, base: { x, y, rot: 0, sx: scale, sy: scale, o: 1 }, tracks: {}, visible: true, locked: false };
}

// ---------- property editing ----------
export const keyIndex = (keys: Key[] | undefined, f: number) => (keys ? keys.findIndex((k) => k.f === f) : -1);

/** Set a property the way the current mode wants: setup pose, or a keyframe at the current frame. */
export function writeProp(l: Layer, prop: Prop, v: number, f = frame.value) {
  if (mode.value === "setup") { l.base[prop] = v; return; }
  let keys = l.tracks[prop];
  if (!keys || keys.length === 0) {
    keys = l.tracks[prop] = [];
    // first key away from the start: keep the setup pose at frame 0 so there is something to move from
    if (f !== 0) keys.push({ f: 0, v: l.base[prop], e: "smooth" });
  }
  const i = keyIndex(keys, f);
  if (i >= 0) keys[i].v = v;
  else { keys.push({ f, v, e: keys.find((k) => k.f < f)?.e ?? "smooth" }); keys.sort((a, b) => a.f - b.f); }
}
export function setProp(id: string, prop: Prop, v: number) {
  edit((p) => { const l = p.layers.find((x) => x.id === id); if (l) writeProp(l, prop, v); });
}
export function hasKeyAt(l: Layer, f: number) { return PROPS.some((pr) => keyIndex(l.tracks[pr], f) >= 0); }

/** Add keys for all moving properties at the current frame, or remove them if present. */
export function toggleKeys(id: string) {
  const f = frame.value;
  edit((p) => {
    const l = p.layers.find((x) => x.id === id); if (!l) return;
    if (hasKeyAt(l, f)) { for (const pr of PROPS) removeKeyAt(l, pr, f); return; }
    const values = PROPS.map((pr) => valueAt(l, pr, f));
    const m = mode.value; mode.value = "animate";
    PROPS.forEach((pr, i) => writeProp(l, pr, values[i], f));
    mode.value = m;
  });
}
export function toggleKeyProp(id: string, pr: Prop) {
  const f = frame.value;
  edit((p) => {
    const l = p.layers.find((x) => x.id === id); if (!l) return;
    if (keyIndex(l.tracks[pr], f) >= 0) removeKeyAt(l, pr, f);
    else { const v = valueAt(l, pr, f); const m = mode.value; mode.value = "animate"; writeProp(l, pr, v, f); mode.value = m; }
  });
}
function removeKeyAt(l: Layer, pr: Prop, f: number) {
  const keys = l.tracks[pr]; if (!keys) return;
  const i = keyIndex(keys, f); if (i < 0) return;
  if (keys.length === 1) l.base[pr] = keys[0].v; // keep the look when the last key goes
  keys.splice(i, 1);
  if (keys.length === 0) delete l.tracks[pr];
}
export function setEaseAt(id: string, f: number, e: Ease) {
  edit((p) => { const l = p.layers.find((x) => x.id === id); if (!l) return; for (const pr of PROPS) { const i = keyIndex(l.tracks[pr], f); if (i >= 0) l.tracks[pr]![i].e = e; } });
}
export function easeAt(l: Layer, f: number): Ease | null {
  for (const pr of PROPS) { const i = keyIndex(l.tracks[pr], f); if (i >= 0) return l.tracks[pr]![i].e; }
  return null;
}
/** Move every key of a layer sitting at `from` to `to` (used when dragging a diamond). */
export function moveKeys(l: Layer, from: number, to: number) {
  for (const pr of PROPS) {
    const keys = l.tracks[pr]; if (!keys) continue;
    const i = keyIndex(keys, from); if (i < 0) continue;
    const j = keyIndex(keys, to); if (j >= 0 && j !== i) keys.splice(j, 1);
    const k = keys.find((x) => x.f === from)!; k.f = to;
    keys.sort((a, b) => a.f - b.f);
  }
}

// ---------- layers ----------
export function addLayers(layers: Layer[]) {
  edit((p) => { p.layers.push(...layers); });
  if (layers.length) selected.value = layers[layers.length - 1].id;
}
export function deleteLayer(id: string) {
  edit((p) => {
    const l = p.layers.find((x) => x.id === id); if (!l) return;
    // children keep their place on screen and follow the deleted layer's parent instead
    for (const c of p.layers.filter((x) => x.parent === id)) reparentKeepPlace(p, c, l.parent);
    p.layers = p.layers.filter((x) => x.id !== id);
    const used = new Set(p.layers.map((x) => x.asset));
    p.assets = p.assets.filter((a) => used.has(a.id));
  });
  selected.value = project.value?.layers.at(-1)?.id ?? null;
}
export function duplicateLayer(id: string) {
  let copyId = "";
  edit((p) => {
    const i = p.layers.findIndex((x) => x.id === id); if (i < 0) return;
    const c: Layer = JSON.parse(JSON.stringify(p.layers[i]));
    c.id = copyId = uid(); c.name = p.layers[i].name + " 2";
    if (!c.parent) { c.base.x += 24; c.base.y += 24; }
    p.layers.splice(i + 1, 0, c);
  });
  if (copyId) selected.value = copyId;
}
/** dir +1 = toward the front */
export function moveLayer(id: string, dir: 1 | -1) {
  edit((p) => {
    const i = p.layers.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= p.layers.length) return;
    [p.layers[i], p.layers[j]] = [p.layers[j], p.layers[i]];
  });
}
export function renameLayer(id: string, name: string) {
  edit((p) => { const l = p.layers.find((x) => x.id === id); if (l && name.trim()) l.name = name.trim().slice(0, 60); });
}
export function toggleFlag(id: string, flag: "visible" | "locked") {
  edit((p) => { const l = p.layers.find((x) => x.id === id); if (l) l[flag] = !l[flag]; });
}

/** Make `l` follow `parent` without jumping on screen (at the current frame). */
function reparentKeepPlace(p: Project, l: Layer, parent: string | null) {
  const f = frame.value, s = solve(p, f);
  const worldNow = s.world.get(l.id)!;
  const parentWorld = parent ? s.world.get(parent)! : IDENTITY;
  // local matrix that keeps the same world matrix, then read position/rotation/scale out of it
  const local = mul(invert(parentWorld), worldNow);
  const [x, y] = apply(local, l.px, l.py);
  const d = decompose(local);
  const now = poseAt(l, f);
  const delta = { x: x - now.x, y: y - now.y, rot: d.rot - now.rot, sx: now.sx ? d.sx / now.sx : 1, sy: now.sy ? d.sy / now.sy : 1 };
  // shift setup pose and every key by the same amount so the whole animation follows
  const shift = (pr: Prop, v: number) => (pr === "sx" || pr === "sy" ? v * delta[pr] : pr === "o" ? v : v + delta[pr as "x" | "y" | "rot"]);
  for (const pr of ["x", "y", "rot", "sx", "sy"] as Prop[]) {
    l.base[pr] = shift(pr, l.base[pr]);
    l.tracks[pr]?.forEach((k) => (k.v = shift(pr, k.v)));
  }
  l.parent = parent;
}
export function setParent(id: string, parent: string | null) {
  const p = project.value; if (!p || (parent && wouldCycle(p, id, parent))) return false;
  edit((pp) => { const l = pp.layers.find((x) => x.id === id); if (l && l.parent !== parent) reparentKeepPlace(pp, l, parent); });
  return true;
}

/** Move the pivot without moving the picture. */
export function movePivotLive(id: string, npx: number, npy: number) {
  live((p) => {
    const l = p.layers.find((x) => x.id === id); if (!l) return;
    const fix = (pose: { x: number; y: number; rot: number; sx: number; sy: number }) => {
      const m = localMatrix({ ...pose, o: 1 }, l.px, l.py);
      return apply(m, npx, npy); // where the new pivot point currently sits
    };
    // setup pose
    const [bx, by] = fix(l.base); const dbx = bx - l.base.x, dby = by - l.base.y;
    // keys: shift each x/y key using the pose at that key's frame
    const shiftTrack = (pr: "x" | "y") => l.tracks[pr]?.forEach((k) => {
      const pose = poseAt(l, k.f); const [nx, ny] = fix(pose);
      k.v += pr === "x" ? nx - pose.x : ny - pose.y;
    });
    shiftTrack("x"); shiftTrack("y");
    l.base.x += dbx; l.base.y += dby;
    l.px = npx; l.py = npy;
  });
}

// ---------- project settings ----------
export function setProjectSettings(s: { name?: string; w?: number; h?: number; fps?: number; seconds?: number; bg?: Background }) {
  edit((p) => {
    if (s.name !== undefined && s.name.trim()) p.name = s.name.trim().slice(0, 80);
    if (s.bg) p.bg = s.bg;
    if (s.w && s.h) {
      // keep the artwork centred when the frame changes size
      const dx = (s.w - p.w) / 2, dy = (s.h - p.h) / 2;
      for (const l of p.layers) if (!l.parent) { l.base.x += dx; l.base.y += dy; l.tracks.x?.forEach((k) => (k.v += dx)); l.tracks.y?.forEach((k) => (k.v += dy)); }
      p.w = s.w; p.h = s.h;
    }
    if (s.fps && s.fps !== p.fps) {
      const r = s.fps / p.fps;
      for (const l of p.layers) for (const k of Object.values(l.tracks)) {
        k?.forEach((key) => (key.f = Math.round(key.f * r)));
        // two keys may land on the same frame after rounding; keep the later one
        if (k) { const seen = new Map<number, Key>(); k.forEach((key) => seen.set(key.f, key)); k.splice(0, k.length, ...[...seen.values()].sort((a, b) => a.f - b.f)); }
      }
      p.frames = Math.round(p.frames * r); p.fps = s.fps;
    }
    if (s.seconds) p.frames = Math.max(1, Math.round(Math.min(MAX_SECONDS, s.seconds) * p.fps));
  });
  const p = project.value!; if (frame.value >= p.frames) frame.value = p.frames - 1;
}
