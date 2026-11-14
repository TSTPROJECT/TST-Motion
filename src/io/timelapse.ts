// Timelapse: while recording, the program copies its own window every few seconds (only when
// the user is working), keeps the pictures on this device, and joins them into a sped-up video.
import { signal } from "@preact/signals";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { Output, Mp4OutputFormat, BufferTarget, VideoSampleSource, VideoSample, QUALITY_HIGH } from "mediabunny";
import { rev } from "../model/store";
import { putBlob, getBlob, deleteProject } from "./db";

const PID = "~timelapse", META = "tstm-timelapse";
/** Seconds between pictures while the user is working. */
export const TL_EVERY = 2;
const MAX_W = 1280;

interface Meta { count: number; started: number; seconds: number }
const loadMeta = (): Meta => { try { return { count: 0, started: 0, seconds: 0, ...JSON.parse(localStorage.getItem(META) || "{}") }; } catch { return { count: 0, started: 0, seconds: 0 }; } };
let meta = loadMeta();
const saveMeta = () => { try { localStorage.setItem(META, JSON.stringify(meta)); } catch { /* ignore */ } tlCount.value = meta.count; tlSeconds.value = meta.seconds; };

/** Only the installed Windows program can copy its window. */
export const tlAvailable = isTauri() && navigator.userAgent.includes("Windows");
export const tlRec = signal(false);
export const tlCount = signal(meta.count);
/** Working time recorded so far, in seconds. */
export const tlSeconds = signal(meta.seconds);
export const tlError = signal<string | null>(null);

// the user is working when something changed or they moved the mouse / typed since the last picture
let active = false, lastRev = -1, cursor: { x: number; y: number } | null = null, timer = 0, busy = false;
const mark = (e: Event) => { active = true; if ("clientX" in e) cursor = { x: (e as PointerEvent).clientX, y: (e as PointerEvent).clientY }; };
for (const ev of ["pointermove", "pointerdown", "keydown", "wheel"]) window.addEventListener(ev, mark, { passive: true, capture: true });

/** Window picture as a canvas with the mouse pointer drawn on it. */
async function grab(): Promise<OffscreenCanvas> {
  const buf: ArrayBuffer = await invoke("capture_window", { maxW: MAX_W });
  const dv = new DataView(buf), w = dv.getUint32(0, true), h = dv.getUint32(4, true);
  const px = new Uint8ClampedArray(buf, 8, w * h * 4);
  for (let i = 0; i < px.length; i += 4) { const b = px[i]; px[i] = px[i + 2]; px[i + 2] = b; px[i + 3] = 255; } // BGRA -> RGBA
  const c = new OffscreenCanvas(w, h), g = c.getContext("2d")!;
  g.putImageData(new ImageData(px, w, h), 0, 0);
  if (cursor) {
    const k = w / innerWidth, x = cursor.x * k, y = cursor.y * k, s = Math.max(0.6, k) * 18;
    g.save(); g.translate(x, y); g.scale(s / 18, s / 18);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 17); g.lineTo(4.5, 13); g.lineTo(7.5, 19.5); g.lineTo(10.5, 18); g.lineTo(7.5, 12); g.lineTo(13, 12); g.closePath();
    g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 1.4; g.fill(); g.stroke(); g.restore();
  }
  return c;
}

async function tick() {
  if (busy || document.hidden) return;
  if (!active && rev.value === lastRev) return; // nothing happened: leave idle time out
  active = false; lastRev = rev.value; busy = true;
  try {
    const c = await grab();
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    await putBlob(PID, String(meta.count).padStart(7, "0"), blob);
    meta.count++; meta.seconds += TL_EVERY; saveMeta();
  } catch (e) {
    tlError.value = (e as Error)?.message ?? String(e);
    stopTimelapse();
  } finally { busy = false; }
}

export function startTimelapse() {
  if (!tlAvailable || tlRec.value) return;
  tlError.value = null;
  if (!meta.count) { meta.started = Date.now(); saveMeta(); }
  tlRec.value = true; active = true; lastRev = -1;
  timer = window.setInterval(() => void tick(), TL_EVERY * 1000);
  void tick();
}
export function stopTimelapse() {
  window.clearInterval(timer); timer = 0; tlRec.value = false;
}
/** Throw the recorded pictures away. */
export async function discardTimelapse() {
  stopTimelapse();
  await deleteProject(PID);
  meta = { count: 0, started: 0, seconds: 0 }; saveMeta();
}
export const timelapseStarted = () => meta.started;

/** Join the pictures into an MP4, `fps` pictures per second of video. */
export async function timelapseVideo(fps: number, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<Blob> {
  const total = meta.count; if (!total) throw new Error("empty");
  // the video takes the size of the first picture; later ones (window resized) are fitted in
  const first = await createImageBitmap((await getBlob(PID, "0000000"))!);
  const W = first.width & ~1, H = first.height & ~1; first.close();
  const c = new OffscreenCanvas(W, H), g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const src = new VideoSampleSource({ codec: "avc", quality: QUALITY_HIGH });
  output.addVideoTrack(src, { frameRate: fps });
  await output.start();
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const b = await getBlob(PID, String(i).padStart(7, "0")); if (!b) continue;
      const bm = await createImageBitmap(b);
      const k = Math.min(W / bm.width, H / bm.height), w = bm.width * k, h = bm.height * k;
      g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.drawImage(bm, (W - w) / 2, (H - h) / 2, w, h); bm.close();
      const s = new VideoSample(c, { timestamp: i / fps, duration: 1 / fps });
      try { await src.add(s); } finally { s.close(); }
      onProgress(i + 1, total);
    }
    await output.finalize();
  } catch (e) { await output.cancel().catch(() => {}); throw e; }
  return new Blob([target.buffer!], { type: "video/mp4" });
}
