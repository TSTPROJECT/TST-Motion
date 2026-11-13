// .tstm project files: a zip with project.json and the original images.
import { unzip, zip, strToU8, strFromU8 } from "fflate";
import type { Project } from "../model/types";
import { getAssetBlob, getFontBlob } from "./assets";
import { uid } from "../model/store";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp", "image/avif": "avif" };

export async function exportProjectFile(p: Project): Promise<Blob> {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    "project.json": strToU8(JSON.stringify(p, null, 1)),
  };
  for (const a of p.assets) {
    const b = getAssetBlob(a.id); if (!b) continue;
    files[`assets/${a.id}.${EXT[a.type] ?? "bin"}`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }]; // images are already compressed
  }
  for (const f of p.fonts ?? []) {
    const b = getFontBlob(f.id); if (!b) continue;
    files[`fonts/${f.id}`] = new Uint8Array(await b.arrayBuffer());
  }
  const data = await new Promise<Uint8Array>((res, rej) => zip(files, { level: 6 }, (err, out) => (err ? rej(err) : res(out))));
  return new Blob([data as BlobPart], { type: "application/x-tst-motion" });
}

export async function readProjectFile(file: File): Promise<{ project: Project; blobs: Map<string, Blob> }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((res, rej) => unzip(buf, (err, out) => (err ? rej(err) : res(out))));
  const json = entries["project.json"];
  if (!json) throw new Error("not a project");
  const project = JSON.parse(strFromU8(json)) as Project;
  if (project.format !== "tst-motion") throw new Error("not a project");
  const blobs = new Map<string, Blob>();
  for (const a of project.assets) {
    const name = Object.keys(entries).find((k) => k.startsWith(`assets/${a.id}.`));
    if (name) blobs.set(a.id, new Blob([entries[name] as BlobPart], { type: a.type }));
  }
  for (const f of project.fonts ?? []) {
    const e = entries[`fonts/${f.id}`];
    if (e) blobs.set(f.id, new Blob([e as BlobPart], { type: f.type }));
  }
  project.id = uid(); // opened files become their own copy, never overwrite a project on this device
  project.modified = Date.now();
  return { project, blobs };
}

export function safeFileName(name: string) {
  return (name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "project").slice(0, 60);
}

/** Offer a file to the user: save dialog where the browser has one, otherwise a normal download. */
export async function saveBlobAs(blob: Blob, fileName: string, description: string, ext: string) {
  const w = window as Window & { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> };
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: fileName, types: [{ description, accept: { [blob.type || "application/octet-stream"]: [ext] } }] });
      const s = await h.createWritable(); await s.write(blob); await s.close();
      return true;
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
