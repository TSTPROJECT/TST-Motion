// Making and changing text parts, and font files added to a project.
import { project, edit, makeLayer, selected, usedAssets, writeKey, frame, uid } from "../model/store";
import { letterCount } from "../model/anim";
import type { FontFile, TextStyle } from "../model/types";
import { addAsset, registerFont } from "../io/assets";
import { putBlob } from "../io/db";
import { defaultText, renderText } from "../render/text";
import { t } from "../i18n";
import { toast } from "./shell";

const nameOf = (s: string) => (s.replace(/\s+/g, " ").trim() || "…").slice(0, 30);

/** New text part in the middle of the frame, selected and ready to type into. */
export async function addTextLayer() {
  const p = project.value; if (!p) return;
  const st = defaultText(t("text_default"));
  st.size = Math.max(12, Math.round(Math.min(p.w, p.h) * 0.08));
  st.stroke = Math.max(2, Math.round(st.size * 0.08));
  const r = await renderText(st);
  const a = await addAsset(p.id, "text", r.blob, r.w, r.h);
  const l = makeLayer(nameOf(st.s), a.id, r.w, r.h, p.w / 2, p.h / 2, 1);
  l.text = st;
  edit((pp) => { pp.assets.push(a); pp.layers.push(l); });
  selected.value = l.id;
}

// changes to one text are drawn one after another, so a slow draw never overwrites a newer one
let chain: Promise<void> = Promise.resolve();
/** Change a text's words or look. Its picture is redrawn; the pivot keeps its place within the text. */
export function setText(id: string, patch: Partial<TextStyle>) {
  chain = chain.then(async () => {
    const p = project.value, l = p?.layers.find((x) => x.id === id); if (!p || !l?.text) return;
    const st: TextStyle = { ...l.text, ...patch };
    if (JSON.stringify(st) === JSON.stringify(l.text)) return;
    const old = p.assets.find((a) => a.id === l.asset);
    const r = await renderText(st);
    const a = await addAsset(p.id, "text", r.blob, r.w, r.h);
    edit((pp) => {
      const x = pp.layers.find((q) => q.id === id); if (!x?.text) return;
      if (x.name === nameOf(x.text.s)) x.name = nameOf(st.s);
      x.px = old ? (x.px / old.w) * r.w : r.w / 2; x.py = old ? (x.py / old.h) * r.h : r.h / 2;
      x.text = st; x.asset = a.id; pp.assets.push(a);
      const used = usedAssets(pp); pp.assets = pp.assets.filter((q) => used.has(q.id));
    });
  }).catch((e) => { console.warn(e); toast(t("text_failed"), true); });
  return chain;
}

/** Typewriter: the letters appear one by one from the current frame. */
export function typewriter(id: string, framesPerLetter = 2) {
  edit((pp) => {
    const x = pp.layers.find((q) => q.id === id); if (!x?.text) return;
    const f = frame.value, n = Math.max(1, letterCount(x.text.s));
    const end = Math.min(pp.frames - 1, f + Math.max(1, n * framesPerLetter));
    delete x.tracks.type; x.base.type = 0; // hidden until it starts
    writeKey(x, "type", 0, f, "linear"); writeKey(x, "type", 1, end, "linear");
  });
}

// ---------- font files in a project ----------
/** Add a .ttf / .otf / .woff font file to the open project; returns its family name. */
export async function addFontFile(file: File): Promise<string | null> {
  const p = project.value; if (!p) return null;
  const family = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Font";
  const f: FontFile = { id: uid(), family, name: file.name.slice(0, 80), type: file.type || "font/ttf" };
  try { await registerFont(f, file); } catch { toast(t("font_failed", { name: file.name }), true); return null; }
  await putBlob(p.id, f.id, file);
  edit((pp) => { (pp.fonts ??= []).push(f); });
  return family;
}
