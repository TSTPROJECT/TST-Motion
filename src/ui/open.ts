// Opening and creating projects (shared by the home screen and the editor menu).
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openProject, newProject, project } from "../model/store";
import { loadProject, saveProject, loadVersion, saveVersion } from "../io/db";
import { loadProjectAssets } from "../io/assets";
import { readProjectFile } from "../io/projectFile";
import { thumbnail, projectOpened, saveNow } from "../io/autosave";
import { t } from "../i18n";
import { toast } from "./shell";

export async function createProject(w: number, h: number) {
  const p = newProject(`${t("untitled")} ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}`, w, h);
  await saveProject(p);
  await loadProjectAssets(p);
  openProject(p);
  void projectOpened(p);
}
export async function openSaved(id: string) {
  const p = await loadProject(id); if (!p) return;
  const missing = await loadProjectAssets(p);
  openProject(p);
  void projectOpened(p);
  if (missing.length) toast(t("missing_images", { names: missing.slice(0, 3).join(", ") }), true);
}
export async function openFile(file: File) {
  try {
    const { project: p, blobs } = await readProjectFile(file);
    const missing = await loadProjectAssets(p, blobs);
    await saveProject(p, await thumbnail(p));
    openProject(p);
    void projectOpened(p);
    if (missing.length) toast(t("missing_images", { names: missing.slice(0, 3).join(", ") }), true);
  } catch {
    toast(t("open_failed"), true);
  }
}
export function pickFile(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res([...(i.files ?? [])]);
    i.click();
  });
}
// Double-clicking a .tstm file in Explorer starts the program with that file.
export async function openStartupFile() {
  if (!isTauri()) return;
  try {
    const name = await invoke<string | null>("startup_file_name");
    if (!name) return;
    const bytes = await invoke<ArrayBuffer>("startup_file_bytes");
    await openFile(new File([bytes], name));
  } catch (e) { console.warn("Could not open the startup file", e); }
}

/** Go back to an older version of the open project. The current state is kept as a version first. */
export async function restoreVersion(key: number) {
  const cur = project.value; if (!cur) return false;
  const old = await loadVersion(key); if (!old || old.id !== cur.id) return false;
  await saveNow();
  await saveVersion(cur, "restore", await thumbnail(cur));
  old.modified = Date.now();
  const missing = await loadProjectAssets(old);
  openProject(old);
  await saveProject(old, await thumbnail(old));
  if (missing.length) toast(t("missing_images", { names: missing.slice(0, 3).join(", ") }), true);
  return true;
}
/** Open a backup copy from the backup folder (as its own new project). */
export async function openBackup(path: string, file: string) {
  try {
    const bytes = await invoke<ArrayBuffer>("backup_read", { path });
    await openFile(new File([bytes], file + ".tstm"));
  } catch { toast(t("open_failed"), true); }
}

/** The sample project that comes with the program (a waving robot), opened as a new copy. */
export async function openSample() {
  try {
    const b = await (await fetch("sample/robot.tstm")).blob();
    await openFile(new File([b], "robot.tstm", { type: "application/zip" }));
  } catch { toast(t("open_failed"), true); }
}
