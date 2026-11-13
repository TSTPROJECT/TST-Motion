// Keeps work safe without the user doing anything:
// - the open project is saved on this device shortly after every change;
// - every few minutes an older copy goes into the version history (to go back to later);
// - on the desktop, every few minutes a full .tstm copy is written to Documents\TST Motion Backups;
// - if the program closes while a project is open, the home screen offers to reopen it.
import { signal } from "@preact/signals";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { onChange, project } from "../model/store";
import { solve } from "../model/anim";
import { create2d } from "../render/renderer";
import { saveProject, saveVersion } from "./db";
import { exportProjectFile, safeFileName } from "./projectFile";
import type { Project } from "../model/types";

export const saving = signal(false);
/** Last time a copy went to the backup folder (desktop only). */
export const lastBackup = signal(0);
let timer = 0;

const VERSION_EVERY = 3 * 60_000, BACKUP_EVERY = 8 * 60_000;
let versionAt = 0, backupAt = 0, dirtyVersion = false, dirtyBackup = false;

export async function thumbnail(p: Project): Promise<string | undefined> {
  try {
    const k = 240 / Math.max(p.w, p.h), w = Math.max(1, Math.round(p.w * k)), h = Math.max(1, Math.round(p.h * k));
    const c = new OffscreenCanvas(w, h), r = create2d(c), s = solve(p, 0);
    r.draw({ project: p, world: s.world, alpha: s.alpha, pic: s.pic }, [k, 0, 0, k, 0, 0], w, h);
    const blob = await c.convertToBlob({ type: "image/webp", quality: 0.7 });
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => res(undefined); fr.readAsDataURL(blob); });
  } catch { return undefined; }
}

export async function saveNow() {
  clearTimeout(timer);
  const p = project.value; if (!p) return;
  saving.value = true;
  try {
    const thumb = await thumbnail(p);
    await saveProject(p, thumb);
    const now = Date.now();
    if (dirtyVersion && now - versionAt > VERSION_EVERY) { versionAt = now; dirtyVersion = false; await saveVersion(p, "auto", thumb).catch(() => {}); }
    if (dirtyBackup && now - backupAt > BACKUP_EVERY) { backupAt = now; void backupToDisk(p); }
  } finally { saving.value = false; }
}

/** Called when a project is opened: remember how it looked before this session's changes. */
export async function projectOpened(p: Project) {
  versionAt = backupAt = Date.now(); dirtyVersion = dirtyBackup = false;
  markOpen(p.id);
  await saveVersion(p, "open", await thumbnail(p)).catch(() => {});
}
/** Called when leaving a project (home button, closing the window): last save, last backup. */
export async function projectClosing() {
  const p = project.value; if (!p) return;
  await saveNow();
  if (dirtyBackup) await backupToDisk(p);
  markOpen(null);
}

/** Local date and time for file names, e.g. 2026-11-14 09-05-30. */
const stamp = (d = new Date()) => {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
};
export async function backupToDisk(p: Project) {
  if (!isTauri()) return;
  try {
    dirtyBackup = false;
    const bytes = new Uint8Array(await (await exportProjectFile(p)).arrayBuffer());
    await invoke("backup_save", bytes, { headers: { "x-id": encodeURIComponent(p.id), "x-file": encodeURIComponent(`${stamp()} ${safeFileName(p.name)}`) } });
    lastBackup.value = Date.now();
  } catch (e) { dirtyBackup = true; console.warn("backup failed", e); }
}

// ---------- "the program closed while working" ----------
const OPEN_KEY = "tstm-open";
function markOpen(id: string | null) { try { if (id) localStorage.setItem(OPEN_KEY, id); else localStorage.removeItem(OPEN_KEY); } catch { /* private mode */ } }
/** Project that was open when the program last stopped without a clean close, if any. Read once at start. */
export const crashed = signal<string | null>((() => { try { return localStorage.getItem(OPEN_KEY); } catch { return null; } })());

onChange(() => {
  saving.value = true; dirtyVersion = dirtyBackup = true;
  clearTimeout(timer);
  timer = window.setTimeout(saveNow, 700);
});
// last chance when the window is hidden or closed
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && saving.value) void saveNow(); });
if (isTauri()) {
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().onCloseRequested(async () => {
    // a clean close: save, back up, and do not offer recovery next time
    try { await projectClosing(); } catch { /* close anyway */ }
  }));
}
