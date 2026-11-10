// Local storage of projects and their images (IndexedDB). Nothing leaves the device.
import type { Project } from "../model/types";

const DB = "tst-motion", VER = 1;
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function store(name: "projects" | "blobs", mode: IDBTransactionMode) {
  return (await db()).transaction(name, mode).objectStore(name);
}

export interface ProjectMeta { id: string; name: string; w: number; h: number; modified: number; layers: number; thumb?: string }

export async function saveProject(p: Project, thumb?: string) {
  const s = await store("projects", "readwrite");
  await req(s.put({ id: p.id, data: JSON.stringify(p), meta: { id: p.id, name: p.name, w: p.w, h: p.h, modified: p.modified, layers: p.layers.length, thumb } satisfies ProjectMeta }));
}
export async function loadProject(id: string): Promise<Project | null> {
  const r = await req((await store("projects", "readonly")).get(id));
  return r ? JSON.parse(r.data) : null;
}
export async function listProjects(): Promise<ProjectMeta[]> {
  const all: Array<{ meta: ProjectMeta }> = await req((await store("projects", "readonly")).getAll());
  return all.map((r) => r.meta).sort((a, b) => b.modified - a.modified);
}
export async function deleteProject(id: string) {
  await req((await store("projects", "readwrite")).delete(id));
  const s = await store("blobs", "readwrite");
  await req(s.delete(IDBKeyRange.bound(id + "/", id + "/￿")));
}
export async function putBlob(projectId: string, assetId: string, blob: Blob) {
  await req((await store("blobs", "readwrite")).put(blob, `${projectId}/${assetId}`));
}
export async function getBlob(projectId: string, assetId: string): Promise<Blob | undefined> {
  return req((await store("blobs", "readonly")).get(`${projectId}/${assetId}`));
}
/** Ask the browser not to clear our data when space runs low. */
export async function askPersistent() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* not supported */ }
}
