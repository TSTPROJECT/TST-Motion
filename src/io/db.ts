// Local storage of projects and their images (IndexedDB). Nothing leaves the device.
import type { Project } from "../model/types";

const DB = "tst-motion", VER = 2;
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
      if (!d.objectStoreNames.contains("versions")) d.createObjectStore("versions", { keyPath: "key", autoIncrement: true }).createIndex("pid", "pid");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function store(name: "projects" | "blobs" | "versions", mode: IDBTransactionMode) {
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
  for (const v of await listVersions(id)) await req((await store("versions", "readwrite")).delete(v.key));
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

// ---------- version history ----------
/** An older copy of a project, kept so a change can be undone even after closing the program. */
export interface Version { key: number; pid: string; at: number; layers: number; thumb?: string; why: "auto" | "open" | "restore" }
const KEEP_VERSIONS = 30;
export async function saveVersion(p: Project, why: Version["why"], thumb?: string) {
  const s = await store("versions", "readwrite");
  await req(s.add({ pid: p.id, at: Date.now(), layers: p.layers.length, thumb, why, data: JSON.stringify(p) }));
  const old = await listVersions(p.id);
  for (const v of old.slice(KEEP_VERSIONS)) await req((await store("versions", "readwrite")).delete(v.key));
}
/** Newest first, without the project data. */
export async function listVersions(pid: string): Promise<Version[]> {
  const all: Array<Version & { data: string }> = await req((await store("versions", "readonly")).index("pid").getAll(pid));
  return all.map(({ data: _d, ...v }) => v).sort((a, b) => b.at - a.at);
}
export async function loadVersion(key: number): Promise<Project | null> {
  const r = await req((await store("versions", "readonly")).get(key));
  return r ? JSON.parse(r.data) : null;
}
