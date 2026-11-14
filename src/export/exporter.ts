// Renders the animation frame by frame at full quality and writes every chosen format in one pass.
// Each frame is drawn once (or twice when both see-through and solid formats are chosen),
// encoded, and written to disk straight away, so even 4K × 105 s does not fill the RAM.
import { Output, Mp4OutputFormat, WebMOutputFormat, StreamTarget, VideoSampleSource, VideoSample, AudioBufferSource, QUALITY_HIGH, canEncodeVideo, canEncodeAudio, type StreamTargetChunk } from "mediabunny";
import { mixdown, sliceBuffer, wavOf } from "../audio/sound";
import type { Project } from "../model/types";
import type { Mat } from "../model/anim";
import { solveShown } from "../model/physics";
import { createRenderer } from "../render/renderer";
import { getAssetBlob } from "../io/assets";
import { MovPngWriter, type Sink } from "./mov";
import { GifWriter } from "./gif";

export type Format = "mp4" | "webm" | "mov" | "gif" | "png";
export const FORMATS: Format[] = ["mp4", "webm", "mov", "gif", "png"];
export const MAX_LONG = 3840, MAX_SHORT = 2160;

export interface ExportOptions {
  formats: Format[];
  width: number; height: number; // video size (even numbers)
  mp4Bg: string;                  // "#rrggbb" behind the picture in MP4
  gifLong: number;                // GIF long side in pixels
  gifTransparent: boolean;        // see-through GIF, or the MP4 colour behind it
}
export interface Progress { frame: number; total: number }
/** A file made by the export (for a PNG sequence: the folder, and how many pictures are in it). */
export interface OutFile { format: Format | "wav"; name: string; size: number; count?: number }

/** Sizes offered for a project: from small to 4K, keeping the frame's shape. */
export function exportSizes(p: Project) {
  const short = Math.min(p.w, p.h), long = Math.max(p.w, p.h);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const out: Array<{ w: number; h: number; label: string }> = [];
  for (const [target, label] of [[720, "HD"], [1080, "Full HD"], [1440, "2K"], [2160, "4K"]] as const) {
    const k = Math.min(target / short, MAX_LONG / long);
    const w = even(p.w * k), h = even(p.h * k);
    if (!out.some((s) => s.w === w && s.h === h)) out.push({ w, h, label });
  }
  return out;
}

/** Which formats this computer can make. */
export async function supportedFormats(w: number, h: number): Promise<Record<Format, boolean>> {
  const [avc, vp9] = await Promise.all([
    canEncodeVideo("avc", { width: w, height: h }).catch(() => false),
    canEncodeVideo("vp9", { width: w, height: h }).catch(() => false),
  ]);
  return { mp4: avc, webm: vp9, mov: true, gif: true, png: true };
}

// ---------- files ----------
function fileSink(stream: FileSystemWritableFileStream): Sink {
  return { write: (data, position) => stream.write({ type: "write", position, data: data as Uint8Array<ArrayBuffer> }) };
}
async function freeName(dir: FileSystemDirectoryHandle, base: string, ext: string) {
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${base}.${ext}` : `${base} (${i}).${ext}`;
    try { await dir.getFileHandle(name); } catch { return name; }
  }
  return `${base} ${Date.now()}.${ext}`;
}

async function freeDirName(dir: FileSystemDirectoryHandle, base: string) {
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? base : `${base} (${i})`;
    try { await dir.getDirectoryHandle(name); } catch { try { await dir.getFileHandle(name); } catch { return name; } }
  }
  return `${base} ${Date.now()}`;
}

interface Job {
  format: Format; name: string; stream?: FileSystemWritableFileStream; folder?: boolean; count?: () => number;
  frame(f: number, see: OffscreenCanvas, solid: OffscreenCanvas): Promise<void>;
  finish(): Promise<void>;
  cancel(): Promise<void>;
  written: () => number;
}

function videoJob(format: "mp4" | "webm", name: string, stream: FileSystemWritableFileStream, fps: number, audio: AudioBuffer | null, audioOk: boolean): Job {
  let size = 0;
  const writable = new WritableStream<StreamTargetChunk>({
    write: async (c) => { size = Math.max(size, c.position + c.data.length); await stream.write({ type: "write", position: c.position, data: c.data }); },
  });
  const output = new Output({
    format: format === "mp4" ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
    target: new StreamTarget(writable, { chunked: true, chunkSize: 8 * 2 ** 20 }),
  });
  const source = new VideoSampleSource(format === "mp4"
    ? { codec: "avc", quality: QUALITY_HIGH }
    : { codec: "vp9", quality: QUALITY_HIGH, alpha: "keep" });
  output.addVideoTrack(source, { frameRate: fps });
  // sound: AAC in MP4, Opus in WebM; fed a little ahead of the pictures so the file stays interleaved
  const aSrc = audio && audioOk ? new AudioBufferSource({ codec: format === "mp4" ? "aac" : "opus", quality: QUALITY_HIGH }) : null;
  if (aSrc) output.addAudioTrack(aSrc);
  let fed = 0;
  const feed = async (until: number) => {
    if (!aSrc || !audio) return;
    const end = Math.min(audio.length, Math.ceil(until * audio.sampleRate));
    while (fed < end) { const to = Math.min(end, fed + audio.sampleRate); await aSrc.add(sliceBuffer(audio, fed, to)); fed = to; }
  };
  const started = output.start();
  return {
    format, name, stream, written: () => size,
    async frame(f, see, solid) {
      await started;
      await feed((f + 1) / fps + 1);
      const sample = new VideoSample(format === "mp4" ? solid : see, { timestamp: f / fps, duration: 1 / fps });
      try { await source.add(sample); } finally { sample.close(); }
    },
    async finish() { await feed(Infinity); await output.finalize(); await stream.close(); },
    async cancel() { await output.cancel().catch(() => {}); },
  };
}

function movJob(name: string, stream: FileSystemWritableFileStream, w: number, h: number, fps: number): Job {
  const mov = new MovPngWriter(fileSink(stream), w, h, fps);
  let size = 0;
  const started = mov.start();
  return {
    format: "mov", name, stream, written: () => size,
    async frame(_f, see) {
      await started;
      const png = new Uint8Array(await (await see.convertToBlob({ type: "image/png" })).arrayBuffer());
      size += png.length;
      await mov.add(png);
    },
    async finish() { await mov.finish(); await stream.close(); },
    async cancel() {},
  };
}

function gifJob(name: string, stream: FileSystemWritableFileStream, o: ExportOptions, fps: number): Job {
  const k = o.gifLong / Math.max(o.width, o.height);
  const gw = Math.max(2, Math.round(o.width * k)), gh = Math.max(2, Math.round(o.height * k));
  const step = fps > 30 ? 2 : 1; // GIF players cannot show more than ~50 frames a second
  const gif = new GifWriter(gw, gh, fps / step, o.gifTransparent);
  const small = new OffscreenCanvas(gw, gh), g = small.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingQuality = "high";
  let size = 0;
  return {
    format: "gif", name, stream, written: () => size,
    async frame(f, see, solid) {
      if (f % step) return;
      g.clearRect(0, 0, gw, gh);
      g.drawImage(o.gifTransparent ? see : solid, 0, 0, gw, gh);
      gif.add(g.getImageData(0, 0, gw, gh).data);
      size += gw * gh / 8; // rough guess until the end
    },
    async finish() { const b = gif.finish(); size = b.length; await stream.write(b as Uint8Array<ArrayBuffer>); await stream.close(); },
    async cancel() {},
  };
}

/** PNG sequence: one see-through picture per frame in a new folder (name_0001.png, name_0002.png, ...). */
function pngJob(name: string, folder: FileSystemDirectoryHandle, base: string, total: number): Job {
  const digits = Math.max(4, String(total).length);
  let size = 0, n = 0;
  return {
    format: "png", name, folder: true, written: () => size, count: () => n,
    async frame(f, see) {
      const blob = await see.convertToBlob({ type: "image/png" });
      const ws = await (await folder.getFileHandle(`${base}_${String(f + 1).padStart(digits, "0")}.png`, { create: true })).createWritable();
      await ws.write(blob); await ws.close();
      size += blob.size; n++;
    },
    async finish() {},
    async cancel() {},
  };
}

/** Full-size images for export (the editor itself may use smaller copies to save memory). */
async function fullImages(p: Project) {
  const map = new Map<string, ImageBitmap>();
  for (const a of p.assets) {
    const blob = getAssetBlob(a.id); if (!blob) continue;
    map.set(a.id, await createImageBitmap(blob, { premultiplyAlpha: "premultiply" }));
  }
  return map;
}

export async function runExport(project: Project, dir: FileSystemDirectoryHandle, baseName: string, o: ExportOptions,
  onProgress: (p: Progress) => void, signal: AbortSignal): Promise<OutFile[]> {
  const p = structuredClone(project);
  const total = p.frames, fps = p.fps, W = o.width, H = o.height;
  const needSee = o.formats.some((f) => f === "webm" || f === "mov" || f === "png" || (f === "gif" && o.gifTransparent));
  const needSolid = o.formats.some((f) => f === "mp4" || (f === "gif" && !o.gifTransparent));

  const images = await fullImages(p);
  const see = new OffscreenCanvas(W, H), solid = new OffscreenCanvas(W, H);
  const rSee = needSee ? createRenderer(see, { preserve: true, image: (id) => images.get(id) }) : null;
  const rSolid = needSolid ? createRenderer(solid, { preserve: true, image: (id) => images.get(id) }) : null;
  const k = W / p.w, view: Mat = [k, 0, 0, H / p.h, 0, 0];

  const jobs: Job[] = [];
  let wavName: string | null = null;
  const cleanup = async () => {
    for (const j of jobs) { await j.cancel(); await j.stream?.abort().catch(() => {}); await dir.removeEntry(j.name, { recursive: !!j.folder }).catch(() => {}); }
    if (wavName) await dir.removeEntry(wavName).catch(() => {});
  };
  try {
    const audio = await mixdown(p);
    const [aac, opus] = audio ? await Promise.all([canEncodeAudio("aac").catch(() => false), canEncodeAudio("opus").catch(() => false)]) : [false, false];
    const extra: OutFile[] = [];
    // MOV, GIF and pictures cannot carry sound: put it next to them as a WAV file
    if (audio && o.formats.some((f) => f === "mov" || f === "gif" || f === "png")) {
      wavName = await freeName(dir, baseName, "wav");
      const wav = wavOf(audio), ws = await (await dir.getFileHandle(wavName, { create: true })).createWritable();
      await ws.write(wav); await ws.close(); extra.push({ format: "wav", name: wavName, size: wav.size });
    }
    for (const format of o.formats) {
      if (format === "png") {
        const name = await freeDirName(dir, `${baseName} PNG`);
        jobs.push(pngJob(name, await dir.getDirectoryHandle(name, { create: true }), baseName, total));
        continue;
      }
      const name = await freeName(dir, baseName, format);
      const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
      jobs.push(format === "mp4" || format === "webm" ? videoJob(format, name, stream, fps, audio, format === "mp4" ? aac : opus)
        : format === "mov" ? movJob(name, stream, W, H, fps) : gifJob(name, stream, o, fps));
    }
    for (let f = 0; f < total; f++) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const S = solveShown(p, f);
      rSee?.draw({ project: p, frame: f, world: S.world, alpha: S.alpha, follow: S.follow, deform: S.deform, pic: S.pic, bg: "none" }, view, W, H);
      rSolid?.draw({ project: p, frame: f, world: S.world, alpha: S.alpha, follow: S.follow, deform: S.deform, pic: S.pic, bg: o.mp4Bg }, view, W, H);
      for (const j of jobs) await j.frame(f, see, solid);
      onProgress({ frame: f + 1, total });
    }
    for (const j of jobs) await j.finish();
    return [...jobs.map((j) => ({ format: j.format, name: j.name, size: j.written(), count: j.count?.() }) as OutFile), ...extra];
  } catch (e) {
    await cleanup();
    throw e;
  } finally {
    images.forEach((b) => b.close());
  }
}
