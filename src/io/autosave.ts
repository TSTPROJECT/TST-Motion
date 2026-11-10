// Saves the open project to this device shortly after every change.
import { signal } from "@preact/signals";
import { onChange, project } from "../model/store";
import { solve } from "../model/anim";
import { create2d } from "../render/renderer";
import { saveProject } from "./db";
import type { Project } from "../model/types";

export const saving = signal(false);
let timer = 0;

export async function thumbnail(p: Project): Promise<string | undefined> {
  try {
    const k = 240 / Math.max(p.w, p.h), w = Math.max(1, Math.round(p.w * k)), h = Math.max(1, Math.round(p.h * k));
    const c = new OffscreenCanvas(w, h), r = create2d(c), s = solve(p, 0);
    r.draw({ project: p, world: s.world, alpha: s.alpha }, [k, 0, 0, k, 0, 0], w, h);
    const blob = await c.convertToBlob({ type: "image/webp", quality: 0.7 });
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => res(undefined); fr.readAsDataURL(blob); });
  } catch { return undefined; }
}

export async function saveNow() {
  clearTimeout(timer);
  const p = project.value; if (!p) return;
  saving.value = true;
  try { await saveProject(p, await thumbnail(p)); } finally { saving.value = false; }
}

onChange(() => {
  saving.value = true;
  clearTimeout(timer);
  timer = window.setTimeout(saveNow, 700);
});
// last chance when the tab is hidden or closed
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && saving.value) void saveNow(); });
