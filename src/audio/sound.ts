// Sounds: load and decode, play along with the animation, waveforms, mixing for export, lip sync.
import { signal, effect } from "@preact/signals";
import { project, frame, edit, selected, uid, writeKey } from "../model/store";
import { MAX_SECONDS, type Layer, type Project, type Sound } from "../model/types";
import { putBlob, getBlob } from "../io/db";
import { mouthPlan } from "./lip";
export { mouthPlan };

export const AUDIO_ACCEPT = "audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus,.weba,.webm,.mp4,.mov";
export const isAudioFile = (f: File) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i.test(f.name);

/** The sound picked on the timeline (a part and a sound are never picked at the same time). */
export const selectedSound = signal<string | null>(null);
effect(() => { if (selected.value) selectedSound.value = null; });

const blobs = new Map<string, Blob>(), buffers = new Map<string, AudioBuffer>(), peaks = new Map<string, Float32Array>();
/** Bumped when a sound finished decoding (the timeline redraws its waveform). */
export const soundsVersion = signal(0);
export const getSoundBlob = (id: string) => blobs.get(id);
export const getSoundBuffer = (id: string) => buffers.get(id);

let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext({ latencyHint: "interactive" }));

/** Loudness peaks, PEAK_RATE per second, 0..1 (for drawing). */
export const PEAK_RATE = 100;
function makePeaks(b: AudioBuffer) {
  const n = Math.ceil(b.duration * PEAK_RATE), out = new Float32Array(n), step = b.sampleRate / PEAK_RATE;
  const chans = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
  for (let i = 0; i < n; i++) {
    let m = 0; const a = Math.floor(i * step), z = Math.min(b.length, Math.floor((i + 1) * step));
    for (const d of chans) for (let j = a; j < z; j += 4) { const v = Math.abs(d[j]); if (v > m) m = v; }
    out[i] = m;
  }
  return out;
}
export const getPeaks = (id: string) => peaks.get(id);

async function decode(blob: Blob) { return ac().decodeAudioData(await blob.arrayBuffer()); }
/** Make a project's sound ready to play (decode it). */
export async function registerSound(s: Sound, blob: Blob) {
  blobs.set(s.id, blob);
  if (buffers.has(s.id)) return;
  const b = await decode(blob);
  buffers.set(s.id, b); peaks.set(s.id, makePeaks(b)); soundsVersion.value++;
}
/** Load the sounds of a project (from this device, or from an opened file's contents). */
export async function loadProjectSounds(p: Project, from?: Map<string, Blob>): Promise<string[]> {
  stopAudio(); buffers.clear(); peaks.clear(); blobs.clear();
  const missing: string[] = [];
  await Promise.all((p.sounds ?? []).map(async (s) => {
    const b = from?.get(s.id) ?? (await getBlob(p.id, s.id));
    if (!b) { missing.push(s.name); return; }
    if (from) await putBlob(p.id, s.id, b);
    try { await registerSound(s, b); } catch { missing.push(s.name); }
  }));
  soundsVersion.value++;
  return missing;
}

/** Add a sound file at the current frame. Returns why it failed, or null. The project grows to fit it. */
export async function addSoundFile(file: File): Promise<"decode" | null | { grew: number }> {
  const p = project.value; if (!p) return null;
  let b: AudioBuffer;
  try { b = await decode(file); } catch { return "decode"; }
  const s: Sound = { id: uid(), name: file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "sound", type: file.type || "audio/mpeg", start: frame.value, trim: 0, dur: b.duration, vol: 1 };
  blobs.set(s.id, file); buffers.set(s.id, b); peaks.set(s.id, makePeaks(b)); soundsVersion.value++;
  await putBlob(p.id, s.id, file);
  const need = Math.min(MAX_SECONDS * p.fps, s.start + Math.ceil(b.duration * p.fps));
  const grew = need > p.frames ? need : 0;
  edit((pp) => { (pp.sounds ??= []).push(s); if (grew) pp.frames = grew; });
  selected.value = null; selectedSound.value = s.id;
  return grew ? { grew } : null;
}

/** Length the sound plays for, in seconds (after the trim, up to the project's end). */
export const clipSeconds = (p: Project, s: Sound) => Math.max(0, Math.min(s.dur - s.trim, p.frames / p.fps - s.start / p.fps));

// ---------- playing along ----------
let playingNodes: AudioBufferSourceNode[] = [];
/** Start every sound as if the animation were at frame `f` now. */
export function startAudio(f: number) {
  stopAudio();
  const p = project.value; if (!p?.sounds?.length) return;
  const c = ac(); if (c.state === "suspended") void c.resume();
  const now = c.currentTime + 0.02, at = f / p.fps;
  for (const s of p.sounds) {
    const b = buffers.get(s.id); if (!b || s.mute || s.vol <= 0) continue;
    const len = clipSeconds(p, s); const begin = s.start / p.fps;
    if (at >= begin + len) continue;
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = b; g.gain.value = s.vol; src.connect(g).connect(c.destination);
    const late = Math.max(0, at - begin);
    src.start(now + Math.max(0, begin - at), s.trim + late, len - late);
    playingNodes.push(src);
  }
}
export function stopAudio() {
  for (const n of playingNodes) { try { n.stop(); } catch { /* already stopped */ } n.disconnect(); }
  playingNodes = [];
}
/** Hear a short bit at a frame (while scrubbing). */
let blip = 0;
export function scrubAudio(f: number) {
  const p = project.value; if (!p?.sounds?.length) return;
  const t = performance.now(); if (t - blip < 60) return; blip = t;
  startAudio(f);
  const nodes = playingNodes; setTimeout(() => { if (playingNodes === nodes) stopAudio(); }, 1000 / p.fps * 2 + 30);
}

// ---------- export ----------
/** All sounds mixed into one stereo track as long as the animation, or null when there is nothing to hear. */
export async function mixdown(p: Project, rate = 48000): Promise<AudioBuffer | null> {
  const list = (p.sounds ?? []).filter((s) => !s.mute && s.vol > 0 && buffers.has(s.id));
  if (!list.length) return null;
  const len = Math.max(1, Math.ceil((p.frames / p.fps) * rate));
  const off = new OfflineAudioContext(2, len, rate);
  for (const s of list) {
    const clip = clipSeconds(p, s); if (clip <= 0) continue;
    const src = off.createBufferSource(), g = off.createGain();
    src.buffer = buffers.get(s.id)!; g.gain.value = s.vol; src.connect(g).connect(off.destination);
    src.start(s.start / p.fps, s.trim, clip);
  }
  return off.startRendering();
}
/** A piece of a buffer (for feeding an encoder a little at a time). */
export function sliceBuffer(b: AudioBuffer, from: number, to: number): AudioBuffer {
  const a = Math.max(0, Math.floor(from)), z = Math.min(b.length, Math.ceil(to));
  const out = new AudioBuffer({ length: Math.max(1, z - a), numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(a, Math.max(a + 1, z)), c);
  return out;
}
/** 16-bit WAV file of a buffer. */
export function wavOf(b: AudioBuffer): Blob {
  const ch = b.numberOfChannels, n = b.length, bytes = 44 + n * ch * 2, v = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, bytes - 8, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, b.sampleRate, true); v.setUint32(28, b.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const x = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
  return new Blob([v.buffer], { type: "audio/wav" });
}

// ---------- lip sync ----------
/** How loud the sound is at each frame of the animation (0..1, scaled so loud speech is near 1). */
export function loudnessPerFrame(p: Project, s: Sound): Float32Array {
  const b = buffers.get(s.id), out = new Float32Array(p.frames); if (!b) return out;
  const chans = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
  const raw: number[] = [];
  for (let f = 0; f < p.frames; f++) {
    const t0 = (f - s.start) / p.fps + s.trim, t1 = t0 + 1 / p.fps;
    if (f < s.start || t0 >= s.trim + clipSeconds(p, s) || t0 >= b.duration) { out[f] = -1; continue; }
    const a = Math.max(0, Math.floor(t0 * b.sampleRate)), z = Math.min(b.length, Math.floor(t1 * b.sampleRate));
    let sum = 0, cnt = 0;
    for (const d of chans) for (let j = a; j < z; j += 2) { sum += d[j] * d[j]; cnt++; }
    out[f] = Math.sqrt(sum / Math.max(1, cnt)); raw.push(out[f]);
  }
  // the loud end of this voice (95th percentile) counts as fully open
  const sorted = raw.sort((x, y) => x - y), top = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
  for (let f = 0; f < out.length; f++) if (out[f] >= 0) out[f] = Math.min(1, out[f] / top);
  return out;
}
/**
 * Lip sync: write picture-swap keys on a part so its mouth opens with the sound's loudness.
 * `pics` = swap values for closed, half and open. Keys of that part's picture inside the sound are replaced.
 */
export function lipSync(layerId: string, soundId: string, pics: [number, number, number], sens: number): number {
  const p = project.value; const s = p?.sounds?.find((x) => x.id === soundId); if (!p || !s) return 0;
  const plan = mouthPlan(loudnessPerFrame(p, s), sens);
  const first = plan.findIndex((v) => v >= 0); if (first < 0) return 0;
  let last = first; for (let f = first; f < plan.length; f++) if (plan[f] >= 0) last = f;
  let n = 0;
  edit((pp) => {
    const l = pp.layers.find((x: Layer) => x.id === layerId); if (!l) return;
    const keep = (l.tracks.swap ?? []).filter((k) => k.f < first || k.f > last + 1);
    l.tracks.swap = keep;
    let prev = -2;
    for (let f = first; f <= last; f++) { const v = pics[plan[f]]; if (v !== prev) { writeKey(l, "swap", v, f, "hold"); prev = v; n++; } }
    // closed again after the sound
    if (last + 1 < pp.frames && prev !== pics[0]) { writeKey(l, "swap", pics[0], last + 1, "hold"); n++; }
  });
  return n;
}
