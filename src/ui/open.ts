// Opening and creating projects (shared by the home screen and the editor menu).
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openProject, newProject } from "../model/store";
import { loadProject, saveProject } from "../io/db";
import { loadProjectAssets } from "../io/assets";
import { readProjectFile } from "../io/projectFile";
import { thumbnail } from "../io/autosave";
import { t } from "../i18n";
import { toast } from "./shell";

export async function createProject(w: number, h: number) {
  const p = newProject(`${t("untitled")} ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}`, w, h);
  await saveProject(p);
  await loadProjectAssets(p);
  openProject(p);
}
export async function openSaved(id: string) {
  const p = await loadProject(id); if (!p) return;
  const missing = await loadProjectAssets(p);
  openProject(p);
  if (missing.length) toast(t("missing_images", { names: missing.slice(0, 3).join(", ") }), true);
}
export async function openFile(file: File) {
  try {
    const { project: p, blobs } = await readProjectFile(file);
    const missing = await loadProjectAssets(p, blobs);
    await saveProject(p, await thumbnail(p));
    openProject(p);
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
