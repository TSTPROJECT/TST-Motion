// Opening and creating projects (shared by the home screen and the editor menu).
import { openProject, newProject, project } from "../model/store";
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
// Double-clicking a .tstm file opens it in the installed app (Chrome/Edge on computers).
type LaunchParams = { files: Array<{ getFile: () => Promise<File> }> };
(window as Window & { launchQueue?: { setConsumer: (f: (p: LaunchParams) => void) => void } }).launchQueue?.setConsumer(async (params) => {
  const h = params.files?.[0]; if (!h || project.value) return;
  await openFile(await h.getFile());
});
