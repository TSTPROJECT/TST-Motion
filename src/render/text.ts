// Text parts: lays out and draws a TextStyle into a picture. The picture is kept at twice the
// composition size so text stays sharp in a 4K export; the asset's w/h stay in composition pixels.
import type { Project, TextStyle } from "../model/types";
import { baseId, letters } from "../model/anim";

/** Pixels in the text picture per composition pixel. */
export const TEXT_RES = 2;

/** Free fonts that come with the program (Thai + Latin). */
export const BUNDLED_FONTS = ["Anuphan", "Sarabun", "Kanit", "Prompt", "Mitr", "Noto Sans Thai"];
/** Fonts often found on Windows; only the ones really installed are offered. */
const SYSTEM_GUESS = [
  "Leelawadee UI", "Tahoma", "Segoe UI", "Arial", "Arial Black", "Verdana", "Georgia", "Times New Roman", "Trebuchet MS",
  "Comic Sans MS", "Impact", "Courier New", "Consolas", "Segoe Print", "Segoe Script", "Cordia New", "CordiaUPC",
  "Angsana New", "AngsanaUPC", "Browallia New", "BrowalliaUPC", "DilleniaUPC", "EucrosiaUPC", "FreesiaUPC", "IrisUPC",
  "JasmineUPC", "KodchiangUPC", "LilyUPC", "TH Sarabun New", "TH SarabunPSK", "TH Niramit AS", "TH Charm of AU",
  "TH Krub", "TH Kodchasal", "TH Mali Grade 6", "TH Chakra Petch", "TH Baijam", "TH Fah kwang", "TH K2D July8",
  "TH KoHo", "TH Srisakdi", "Microsoft Sans Serif",
];

export const defaultText = (s: string): TextStyle => ({
  s, font: "Kanit", size: 96, bold: true, italic: false, color: "#ffffff", align: "center", line: 1.25, spacing: 0,
  stroke: 8, strokeColor: "#151821", box: 0, boxColor: "#151821", boxRound: 0.3,
});

const fontCss = (st: TextStyle, k = 1) => `${st.italic ? "italic " : ""}${st.bold ? 700 : 400} ${st.size * k}px "${st.font}", "Anuphan", "Leelawadee UI", sans-serif`;

/** Make sure the font's letters are loaded before drawing (bundled and added fonts load lazily). */
export async function loadFont(st: TextStyle) {
  try { await document.fonts.load(fontCss(st), st.s || "ก"); } catch { /* not a loadable font: drawn with the fallback */ }
}

/** Installed fonts from the list above, found by comparing letter widths with the fallbacks. */
let installed: string[] | null = null;
export function systemFonts(): string[] {
  if (installed) return installed;
  const g = new OffscreenCanvas(10, 10).getContext("2d")!, sample = "mmmmmwwwwlliiกขคฆงจ 0123";
  const w = (f: string) => { g.font = `40px ${f}`; return g.measureText(sample).width; };
  const base = ["monospace", "serif", "sans-serif"].map(w);
  installed = SYSTEM_GUESS.filter((name) => ["monospace", "serif", "sans-serif"].some((fb, i) => Math.abs(w(`"${name}", ${fb}`) - base[i]) > 0.5));
  return installed;
}

interface Layout { lines: Array<{ text: string; w: number }>; w: number; h: number; lh: number; asc: number; pad: number }
function layout(g: OffscreenCanvasRenderingContext2D, st: TextStyle): Layout {
  g.font = fontCss(st, TEXT_RES);
  (g as unknown as { letterSpacing: string }).letterSpacing = `${st.spacing * st.size * TEXT_RES}px`;
  const raw = (st.s || " ").replace(/\r\n/g, "\n").split("\n");
  const lines = raw.map((text) => ({ text, w: g.measureText(text).width }));
  const m = g.measureText("ก๊ÁjgฎฐฦÅ"), size = st.size * TEXT_RES;
  // Thai tone marks sit high and some letters reach low: leave room above and below every line
  const asc = Math.max(m.fontBoundingBoxAscent || size * 0.9, m.actualBoundingBoxAscent || 0) + size * 0.08;
  const desc = Math.max(m.fontBoundingBoxDescent || size * 0.3, m.actualBoundingBoxDescent || 0) + size * 0.05;
  const lh = size * st.line;
  const pad = Math.ceil((st.stroke * TEXT_RES) / 2 + st.box * TEXT_RES + 2 * TEXT_RES);
  const w = Math.ceil(Math.max(1, ...lines.map((l) => l.w)) + pad * 2);
  const h = Math.ceil(asc + desc + lh * (lines.length - 1) + pad * 2);
  return { lines, w, h, lh, asc, pad };
}

function paint(st: TextStyle, upto?: number): OffscreenCanvas {
  const c = new OffscreenCanvas(1, 1);
  let g = c.getContext("2d")!;
  const L = layout(g, st);
  c.width = L.w; c.height = L.h; // resizing resets the context state
  g = c.getContext("2d")!;
  g.font = fontCss(st, TEXT_RES);
  (g as unknown as { letterSpacing: string }).letterSpacing = `${st.spacing * st.size * TEXT_RES}px`;
  g.textBaseline = "alphabetic"; g.textAlign = "left"; g.lineJoin = "round"; g.miterLimit = 2;
  if (st.box > 0) {
    const r = Math.min(L.w, L.h) / 2 * Math.max(0, Math.min(1, st.boxRound));
    g.fillStyle = st.boxColor; g.beginPath(); g.roundRect(0, 0, L.w, L.h, r); g.fill();
  }
  let left = upto ?? Infinity;
  L.lines.forEach((line, i) => {
    if (left <= 0) return;
    const inner = L.w - L.pad * 2;
    const x = L.pad + (st.align === "left" ? 0 : st.align === "right" ? inner - line.w : (inner - line.w) / 2);
    const y = L.pad + L.asc + i * L.lh;
    let text = line.text;
    if (Number.isFinite(left)) { const ls = letters(text); text = ls.slice(0, left).join(""); left -= ls.length; }
    if (st.stroke > 0) { g.strokeStyle = st.strokeColor; g.lineWidth = st.stroke * TEXT_RES; g.strokeText(text, x, y); }
    g.fillStyle = st.color; g.fillText(text, x, y);
  });
  return c;
}

/** Draw a text into a PNG, with its size in composition pixels. */
export async function renderText(st: TextStyle): Promise<{ blob: Blob; w: number; h: number }> {
  await loadFont(st);
  const c = paint(st);
  const blob = await c.convertToBlob({ type: "image/png" });
  return { blob, w: c.width / TEXT_RES, h: c.height / TEXT_RES };
}

// typewriter pictures ("<asset>#<n>"), drawn when first needed and kept for a while
const parts = new Map<string, OffscreenCanvas>();
/** Picture for a text showing only some of its letters, or undefined if the id is not such a picture. */
export function partialText(p: Project, id: string): OffscreenCanvas | undefined {
  const hash = id.indexOf("#"); if (hash < 0) return undefined;
  const have = parts.get(id);
  if (have) { parts.delete(id); parts.set(id, have); return have; }
  const base = baseId(id), l = p.layers.find((x) => x.asset === base && x.text); if (!l?.text) return undefined;
  const c = paint(l.text, +id.slice(hash + 1));
  parts.set(id, c);
  while (parts.size > 48) parts.delete(parts.keys().next().value!);
  return c;
}
