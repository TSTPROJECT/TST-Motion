// "Tap to select" with AI. The model (about 14 MB) is downloaded once, checked, kept on this device,
// and runs on this computer only. Pictures are never sent anywhere.
import { signal } from "@preact/signals";
import type { Img } from "./mask";

/** SlimSAM-77 (Apache-2.0), ONNX build by Xenova, pinned to one exact revision. */
const REV = "5850ab45f587c112167512ffef949107115e26a0";
const BASE = `https://huggingface.co/Xenova/slimsam-77-uniform/resolve/${REV}/onnx/`;
const FILES = [
  { name: "vision_encoder_quantized.onnx", size: 8882165, sha256: "cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971" },
  { name: "prompt_encoder_mask_decoder_quantized.onnx", size: 4903810, sha256: "cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2" },
];
export const MODEL_MB = Math.round(FILES.reduce((n, f) => n + f.size, 0) / 1e6);
const DIR = ["models", "slimsam-77-" + REV.slice(0, 8)];

export type AiState = "unknown" | "missing" | "downloading" | "loading" | "ready" | "error";
export const aiState = signal<AiState>("unknown");
export const aiProgress = signal(0); // 0..1 while downloading
export const aiError = signal("");

async function folder(create: boolean, dir = DIR) {
  let d = await navigator.storage.getDirectory();
  for (const part of dir) d = await d.getDirectoryHandle(part, { create });
  return d;
}
async function stored(name: string, dir = DIR): Promise<ArrayBuffer | null> {
  try { return await (await (await (await folder(false, dir)).getFileHandle(name)).getFile()).arrayBuffer(); } catch { return null; }
}
type ModelFile = { name: string; size: number; sha256: string };
/** Download files (with progress), check each one's size and fingerprint, keep them on this device. */
async function fetchFiles(base: string, files: ModelFile[], dir: string[], progress: (v: number) => void) {
  const total = files.reduce((n, f) => n + f.size, 0); let got = 0;
  const d = await folder(true, dir);
  for (const f of files) {
    if ((await stored(f.name, dir))?.byteLength === f.size) { got += f.size; continue; }
    const res = await fetch(base + f.name, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const parts: Uint8Array[] = []; const rd = res.body.getReader();
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      parts.push(value); got += value.length; progress(Math.min(1, got / total));
    }
    const buf = await new Blob(parts as BlobPart[]).arrayBuffer();
    if (buf.byteLength !== f.size || (await sha256(buf)) !== f.sha256) throw new Error("checksum");
    const w = await (await d.getFileHandle(f.name, { create: true })).createWritable();
    await w.write(buf); await w.close();
  }
}
async function sha256(buf: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Is the model already on this device? (does not download) */
export async function checkModel() {
  if (aiState.value === "ready" || aiState.value === "downloading" || aiState.value === "loading") return;
  const have = await Promise.all(FILES.map(async (f) => (await (await folder(true)).getFileHandle(f.name).then((h) => h.getFile()).catch(() => null))?.size === f.size));
  aiState.value = have.every(Boolean) ? "loading" : "missing";
  if (aiState.value === "loading") await start();
}

/** Download the model once (with progress), check it, keep it. */
export async function downloadModel() {
  if (aiState.value === "downloading") return;
  aiState.value = "downloading"; aiProgress.value = 0; aiError.value = "";
  try {
    await fetchFiles(BASE, FILES, DIR, (v) => (aiProgress.value = v));
    aiState.value = "loading";
    await start();
  } catch (e) {
    console.error(e); aiError.value = String((e as Error)?.message ?? e); aiState.value = "error";
  }
}

// ---------- the worker ----------
let worker: Worker | null = null, seq = 0;
const waiting = new Map<number, (v: { ok: boolean; error?: string; [k: string]: unknown }) => void>();
function call<T>(msg: object, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise((res, rej) => {
    waiting.set(id, (v) => (v.ok ? res(v as T) : rej(new Error(v.error))));
    worker!.postMessage({ id, ...msg }, transfer);
  });
}
async function start() {
  try {
    const [enc, dec] = await Promise.all(FILES.map((f) => stored(f.name)));
    if (!enc || !dec) { aiState.value = "missing"; return; }
    if (!worker) {
      worker = new Worker(new URL("./sam.worker.ts", import.meta.url), { type: "module", name: "tst-sam" });
      worker.onmessage = (e) => { const r = waiting.get(e.data.id); if (r) { waiting.delete(e.data.id); r(e.data); } };
    }
    await call({ type: "load", enc, dec }, [enc, dec]);
    aiState.value = "ready";
  } catch (e) {
    console.error(e); aiError.value = String((e as Error)?.message ?? e); aiState.value = "error";
  }
}

let embedded: { key: string; job: Promise<unknown> } | null = null;
/** Let the model look at a picture (a second or a few on slow machines). Cached for the same key. */
export function embed(key: string, img: Img) {
  if (embedded?.key === key) return embedded.job;
  const rgba = img.data.slice(); // the worker gets its own copy
  const job = call<{ ms: number }>({ type: "embed", key, w: img.w, h: img.h, rgba }, [rgba.buffer]);
  embedded = { key, job };
  job.catch(() => { if (embedded?.key === key) embedded = null; });
  return job;
}
/** Mask (0..255 per pixel) for the tapped points: label 1 = "this", 0 = "not this". */
export async function decode(key: string, img: Img, points: Array<[number, number, number]>, level: 0 | 1 | 2 = 1): Promise<Uint8Array> {
  await embed(key, img);
  const r = await call<{ mask: Uint8Array }>({ type: "decode", key, points, level });
  return r.mask;
}

// ---------- body joints (for cutting a character into parts automatically) ----------

/** ViTPose base (Apache-2.0), ONNX build by onnx-community, 4-bit, pinned to one exact revision. */
const POSE_REV = "bbebbddd612af2728539103dd5b903a4f5a2da4c";
const POSE_BASE = `https://huggingface.co/onnx-community/vitpose-base-simple/resolve/${POSE_REV}/onnx/`;
const POSE_FILES: ModelFile[] = [{ name: "model_q4.onnx", size: 57249880, sha256: "c8ef2bf82220abc6510a1f3bc171e44390a85dcbbec6d9baa504dfc4e4dfdd10" }];
const POSE_DIR = ["models", "vitpose-base-" + POSE_REV.slice(0, 8)];
export const POSE_MB = Math.round(POSE_FILES[0].size / 1e6);
export const poseState = signal<AiState>("unknown");
export const poseProgress = signal(0);
export const poseError = signal("");

async function startPose() {
  try {
    const model = await stored(POSE_FILES[0].name, POSE_DIR);
    if (!model || model.byteLength !== POSE_FILES[0].size) { poseState.value = "missing"; return; }
    if (!worker) await start(); // the cutting model's worker runs this one too
    if (!worker) throw new Error("no worker");
    await call({ type: "loadPose", model }, [model]);
    poseState.value = "ready";
  } catch (e) {
    console.error(e); poseError.value = String((e as Error)?.message ?? e); poseState.value = "error";
  }
}
/** Is the joints model on this device? Loads it when it is. */
export async function checkPose() {
  if (poseState.value === "ready" || poseState.value === "downloading" || poseState.value === "loading") return;
  const f = await (await folder(true, POSE_DIR)).getFileHandle(POSE_FILES[0].name).then((h) => h.getFile()).catch(() => null);
  if (f?.size !== POSE_FILES[0].size) { poseState.value = "missing"; return; }
  poseState.value = "loading"; await startPose();
}
/** Download the joints model once (and the cutting model, if it is missing too). */
export async function downloadPose() {
  if (poseState.value === "downloading") return;
  if (aiState.value !== "ready") await downloadModel();
  if (aiState.value !== "ready") return;
  poseState.value = "downloading"; poseProgress.value = 0; poseError.value = "";
  try {
    await fetchFiles(POSE_BASE, POSE_FILES, POSE_DIR, (v) => (poseProgress.value = v));
    poseState.value = "loading"; await startPose();
  } catch (e) {
    console.error(e); poseError.value = String((e as Error)?.message ?? e); poseState.value = "error";
  }
}

export interface PartInfo { key: string; pivot: [number, number]; parent: string | null; z: number }
/**
 * Guess the body parts: find the joints inside `box`, then give every visible pixel (alpha > 0) a part.
 * Returns the part number per pixel (1..n, 0 = none) and the parts, or null when no person was found.
 */
export async function guessParts(key: string, img: Img, alpha: Uint8Array, box: [number, number, number, number], detail: 0 | 1 | 2) {
  let t = performance.now();
  const ms: Record<string, number> = {};
  await embed(key, img); ms.look = performance.now() - t; t = performance.now();
  const { joints } = await call<{ joints: Array<[number, number, number]> }>({ type: "pose", key, box });
  ms.joints = performance.now() - t;
  const a = alpha.slice();
  const r = await call<{ labels: Uint8Array | null; plan: PartInfo[]; ms?: Record<string, number> }>({ type: "parts", key, joints, detail, alpha: a }, [a.buffer]);
  Object.assign(ms, r.ms);
  return r.labels ? { labels: r.labels, parts: r.plan, joints, ms } : null;
}
