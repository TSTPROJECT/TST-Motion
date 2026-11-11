// Images in memory: decoded bitmaps for drawing, small alpha masks for tapping on parts.
import type { Asset, Layer, Project } from "../model/types";
import { makeLayer, uid } from "../model/store";
import { getBlob, putBlob } from "./db";

export interface Loaded { bitmap: ImageBitmap; mask: Uint8Array; mw: number; mh: number; url: string }
const loaded = new Map<string, Loaded>();
const blobs = new Map<string, Blob>();
let version = 0;
const subs: Array<() => void> = [];
export const onAssetsChanged = (fn: () => void) => subs.push(fn);
const bump = () => { version++; subs.forEach((f) => f()); };
export const assetsVersion = () => version;

export const getLoaded = (id: string) => loaded.get(id);
export const getAssetBlob = (id: string) => blobs.get(id);

/** Largest side kept for on-screen drawing. Weak devices get smaller textures. */
export function previewLimit() {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return mem <= 2 ? 1536 : mem <= 4 ? 2048 : 4096;
}

async function decode(blob: Blob, w: number, h: number): Promise<ImageBitmap> {
  const lim = previewLimit(), k = Math.min(1, lim / Math.max(w, h));
  // WebGL ignores its own premultiply flag for ImageBitmap, so ask for premultiplied pixels here
  const opts: ImageBitmapOptions = { premultiplyAlpha: "premultiply", ...(k < 1 ? { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k), resizeQuality: "high" as const } : {}) };
  return createImageBitmap(blob, opts);
}
function makeMask(bmp: ImageBitmap) {
  const k = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
  const mw = Math.max(1, Math.round(bmp.width * k)), mh = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(mw, mh), g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, mw, mh);
  const d = g.getImageData(0, 0, mw, mh).data, mask = new Uint8Array(mw * mh);
  for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3];
  return { mask, mw, mh };
}
async function register(a: Asset, blob: Blob) {
  blobs.set(a.id, blob);
  const bitmap = await decode(blob, a.w, a.h);
  const { mask, mw, mh } = makeMask(bitmap);
  const old = loaded.get(a.id); if (old) URL.revokeObjectURL(old.url);
  loaded.set(a.id, { bitmap, mask, mw, mh, url: URL.createObjectURL(blob) });
}

/** Keep a new picture made inside the program (a cut part). Saved on this device straight away. */
export async function addAsset(projectId: string, name: string, blob: Blob, w: number, h: number): Promise<Asset> {
  const a: Asset = { id: uid(), name: name.slice(0, 80), type: blob.type || "image/png", w, h };
  await putBlob(projectId, a.id, blob); await register(a, blob);
  bump();
  return a;
}

/** Is the picture solid at this pixel (image coordinates)? */
export function hitAsset(id: string, w: number, h: number, x: number, y: number) {
  const L = loaded.get(id); if (!L || x < 0 || y < 0 || x >= w || y >= h) return false;
  const mx = Math.floor((x / w) * L.mw), my = Math.floor((y / h) * L.mh);
  return L.mask[my * L.mw + mx] > 24;
}

/** Load every image of a saved project from local storage. */
export async function loadProjectAssets(p: Project, from?: Map<string, Blob>) {
  for (const old of loaded.values()) URL.revokeObjectURL(old.url);
  loaded.clear(); blobs.clear();
  const missing: string[] = [];
  await Promise.all(p.assets.map(async (a) => {
    const b = from?.get(a.id) ?? (await getBlob(p.id, a.id));
    if (!b) { missing.push(a.name); return; }
    if (from) await putBlob(p.id, a.id, b);
    try { await register(a, b); } catch { missing.push(a.name); }
  }));
  bump();
  return missing;
}

// ---------- importing files ----------
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico|tiff?)$/i;
export const ACCEPT = "image/*,.psd,.svg";
export function isProjectFile(f: File) { return /\.tstm$/i.test(f.name); }

export interface ImportResult { layers: Layer[]; assets: Asset[]; failed: string[] }

async function sizeOf(blob: Blob): Promise<{ w: number; h: number }> {
  const b = await createImageBitmap(blob); const s = { w: b.width, h: b.height }; b.close(); return s;
}
/** SVG has no pixels; draw it once at a crisp size and keep the PNG. */
async function rasterSvg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    let w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    const k = 2048 / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("svg"))), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("layer"))), "image/png"));
}

/** Read a PSD and keep each visible layer (inside groups too) as its own part, in place. */
async function importPsd(file: File, p: Project): Promise<ImportResult> {
  const { readPsd } = await import("ag-psd");
  const psd = readPsd(await file.arrayBuffer(), { skipThumbnail: true, skipCompositeImageData: true });
  type Node = { name?: string; hidden?: boolean; canvas?: HTMLCanvasElement; left?: number; top?: number; opacity?: number; children?: Node[] };
  const flat: Node[] = [];
  const walk = (n: Node[] | undefined) => n?.forEach((c) => { if (c.children) walk(c.children); else if (c.canvas && c.canvas.width && c.canvas.height) flat.push(c); });
  walk(psd.children as Node[]);
  const k = Math.min(1, (p.w * 0.9) / psd.width, (p.h * 0.9) / psd.height);
  const ox = (p.w - psd.width * k) / 2, oy = (p.h - psd.height * k) / 2;
  const res: ImportResult = { layers: [], assets: [], failed: [] };
  for (const n of flat) {
    const c = n.canvas!, blob = await canvasToBlob(c);
    const a: Asset = { id: uid(), name: n.name || file.name, type: "image/png", w: c.width, h: c.height };
    await putBlob(p.id, a.id, blob); await register(a, blob);
    const cx = ox + ((n.left ?? 0) + c.width / 2) * k, cy = oy + ((n.top ?? 0) + c.height / 2) * k;
    const l = makeLayer(n.name || file.name, a.id, c.width, c.height, cx, cy, k);
    l.base.o = n.opacity ?? 1; l.visible = !n.hidden;
    res.assets.push(a); res.layers.push(l);
  }
  return res;
}

/** Turn dropped / picked files into layers placed in the middle of the frame. */
export async function importFiles(files: File[], p: Project): Promise<ImportResult> {
  const res: ImportResult = { layers: [], assets: [], failed: [] };
  let n = 0;
  for (const file of files) {
    try {
      if (/\.psd$/i.test(file.name)) {
        const r = await importPsd(file, p);
        res.layers.push(...r.layers); res.assets.push(...r.assets);
        continue;
      }
      if (!file.type.startsWith("image/") && !IMAGE_EXT.test(file.name)) { res.failed.push(file.name); continue; }
      const blob = file.type === "image/svg+xml" || /\.svg$/i.test(file.name) ? await rasterSvg(file) : file;
      const { w, h } = await sizeOf(blob);
      const a: Asset = { id: uid(), name: file.name, type: blob.type || "image/png", w, h };
      await putBlob(p.id, a.id, blob); await register(a, blob);
      const k = Math.min(1, (p.w * 0.8) / w, (p.h * 0.8) / h);
      const off = n++ * Math.round(Math.min(p.w, p.h) * 0.03);
      res.assets.push(a);
      res.layers.push(makeLayer(file.name.replace(/\.[^.]+$/, ""), a.id, w, h, p.w / 2 + off, p.h / 2 + off, k));
    } catch {
      res.failed.push(file.name);
    }
  }
  if (res.assets.length) bump();
  return res;
}
