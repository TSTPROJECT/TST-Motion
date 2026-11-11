// Cut window: choose part of a layer's picture by hand (wand, lasso, brush), then cut it into its own layer,
// erase it, remove a plain background, or split the picture into its separate pieces.
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { project, cutToLayer, replaceAsset, splitLayer, type Piece } from "../model/store";
import { addAsset, getAssetBlob } from "../io/assets";
import * as M from "../cut/mask";
import { aiState, aiProgress, aiError, checkModel, downloadModel, embed, decode, MODEL_MB, poseState, poseProgress, poseError, checkPose, downloadPose, guessParts, POSE_MB } from "../cut/ai";
import { jointOverlap, meeting, seamFill, snapPivot } from "../cut/parts";
import { t, type Key } from "../i18n";
import { Icon } from "./icons";
import { toast } from "./shell";

/** id of the layer being cut, or null when the window is closed */
export const cutLayer = signal<string | null>(null);

type CutTool = "ai" | "auto" | "wand" | "lasso" | "brush" | "erase" | "hand";
const TOOLS: Array<{ id: CutTool; icon: string; key: string }> = [
  { id: "ai", icon: "sparkle", key: "a" }, { id: "auto", icon: "figure", key: "g" }, { id: "wand", icon: "wand", key: "w" }, { id: "lasso", icon: "lasso", key: "l" },
  { id: "brush", icon: "brush", key: "b" }, { id: "erase", icon: "eraser", key: "e" }, { id: "hand", icon: "hand", key: "h" },
];
const PARTS: Key[] = ["part_head", "part_hair", "part_face", "part_body", "part_arm_l", "part_arm_r", "part_hand", "part_leg_l", "part_leg_r", "part_cloth", "part_item"];

const PREFS = "tstm-cut";
interface Prefs { tool: CutTool; tol: number; contig: boolean; size: number; soft: boolean; level: 0 | 1 | 2; detail: 0 | 1 | 2 }
const DEF: Prefs = { tool: "ai", tol: 32, contig: true, size: 40, soft: true, level: 1, detail: 1 };
const loadPrefs = (): Prefs => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(PREFS) || "{}") }; } catch { return DEF; } };

const MAX_PIXELS = 50e6; // about 7000×7000; more would not fit in a 4 GB machine's memory
const TINT = [59, 116, 255, 70]; // light tint over chosen pixels
const DIM = [12, 14, 22, 150]; // darkens what is not chosen
const EDGE = [80, 160, 255]; // line around the selection
/** colours of the guessed parts (well apart from each other) */
const PART_COLORS: Array<[number, number, number]> = [
  [230, 70, 70], [60, 140, 255], [40, 190, 110], [250, 180, 30], [170, 90, 230], [20, 200, 210], [255, 120, 190],
  [140, 200, 40], [255, 140, 60], [100, 110, 255], [200, 60, 140], [60, 170, 160], [190, 150, 90], [120, 120, 120],
];
const partColor = (k: number) => PART_COLORS[(k - 1) % PART_COLORS.length];
/** extra parts the user can add to the guess */
const EXTRA_PARTS: Key[] = ["part_cloth", "part_item", "part_hair", "part_hand"];
interface AutoPart { key: string; name: string; pivot: [number, number] | null; parent: string | null; z: number; n: number }

interface Work {
  img: M.Img; mask: Uint8Array; first: M.Img; // the picture now, and as it was when the window opened
  pic: OffscreenCanvas; over: OffscreenCanvas; overCtx: OffscreenCanvasRenderingContext2D;
  stroke: OffscreenCanvas; strokeCtx: OffscreenCanvasRenderingContext2D;
  undo: Uint8Array[]; redo: Uint8Array[]; maxUndo: number; any: boolean;
  z: number; ox: number; oy: number; fitted: boolean; auto: boolean;
  lasso: Array<[number, number]> | null; brushAt: [number, number] | null; last: [number, number] | null;
  hover: [number, number] | null; space: boolean;
  pointers: Map<number, [number, number]>; pinch: { d: number; cx: number; cy: number } | null; pan: [number, number] | null;
  /** auto parts: part number per pixel (0 = none), its undo steps, and a tap or paint stroke in progress */
  labels: Uint8Array | null; lundo: Uint8Array[]; lredo: Uint8Array[];
  ldown: { at: [number, number]; last: [number, number]; start: [number, number]; moved: boolean } | null;
}

async function png(data: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d")!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return c.convertToBlob({ type: "image/png" });
}

export function CutDialog() {
  const id = cutLayer.value;
  const p = project.value;
  const layer = p?.layers.find((l) => l.id === id) ?? null;
  const asset = layer?.asset ? p!.assets.find((a) => a.id === layer.asset) ?? null : null;
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [how, setHow] = useState<M.Combine>("replace");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [chosen, setChosen] = useState(0); // pixels chosen, for the counter and buttons
  const [undoN, setUndoN] = useState(0);
  const [redoN, setRedoN] = useState(0);
  const [name, setName] = useState("");
  const [tipOff, setTipOff] = useState(false);
  const [aiSign, setAiSign] = useState<1 | 0>(1); // next tap: 1 = "this part", 0 = "not this"
  const [aiLooking, setAiLooking] = useState(false);
  const [parts, setParts] = useState<AutoPart[] | null>(null);
  const [active, setActive] = useState(1); // part that taps and paint go to
  const activeRef = useRef(active); activeRef.current = active;
  const aiPts = useRef<Array<[number, number, number]>>([]);
  const aiBase = useRef<Uint8Array | null>(null);
  const openedWith = useRef(""); // asset id when the window opened
  const aiQueue = useRef<Promise<void>>(Promise.resolve());
  const aiSignRef = useRef(aiSign); aiSignRef.current = aiSign;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const W = useRef<Work | null>(null);
  const raf = useRef(0);
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const howRef = useRef(how); howRef.current = how;

  const upd = (x: Partial<Prefs>) => setPrefs((o) => { const n = { ...o, ...x }; try { localStorage.setItem(PREFS, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const close = () => (cutLayer.value = null);

  // ---------- drawing ----------
  const draw = () => {
    raf.current = 0;
    const c = cv.current, w = W.current; if (!c || !w) return;
    const g = c.getContext("2d")!, dpr = devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w: iw, h: ih } = w.img;
    // checkerboard under the picture so see-through parts are visible
    g.save(); g.beginPath(); g.rect(w.ox, w.oy, iw * w.z, ih * w.z); g.clip();
    const cell = 10; g.fillStyle = "#ffffff"; g.fillRect(w.ox, w.oy, iw * w.z, ih * w.z); g.fillStyle = "#e3e6ec";
    for (let y = Math.floor(w.oy / cell) * cell; y < w.oy + ih * w.z; y += cell)
      for (let x = Math.floor(w.ox / cell) * cell + (((y / cell) & 1) ? cell : 0); x < w.ox + iw * w.z; x += cell * 2) g.fillRect(x, y, cell, cell);
    g.restore();
    g.save(); g.translate(w.ox, w.oy); g.scale(w.z, w.z);
    g.imageSmoothingEnabled = w.z < 2; g.imageSmoothingQuality = "high";
    g.drawImage(w.pic, 0, 0); g.drawImage(w.over, 0, 0);
    g.restore();
    g.strokeStyle = "rgba(127,127,127,.6)"; g.lineWidth = 1; g.strokeRect(w.ox - 0.5, w.oy - 0.5, iw * w.z + 1, ih * w.z + 1);
    // lasso line
    if (w.lasso && w.lasso.length > 1) {
      g.beginPath(); w.lasso.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, w.ox + x * w.z, w.oy + y * w.z));
      g.lineWidth = 3; g.strokeStyle = "rgba(0,0,0,.55)"; g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = "#fff"; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]);
    }
    // AI taps: green = this part, red = not this
    for (const [x, y, l] of aiPts.current) {
      const sx = w.ox + x * w.z, sy = w.oy + y * w.z;
      g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fillStyle = l ? "#13a067" : "#d93a4a"; g.fill();
      g.lineWidth = 2; g.strokeStyle = "#fff"; g.stroke();
      g.beginPath(); g.moveTo(sx - 3.5, sy); g.lineTo(sx + 3.5, sy); if (l) { g.moveTo(sx, sy - 3.5); g.lineTo(sx, sy + 3.5); } g.stroke();
    }
    // brush outline
    const tl = prefsRef.current.tool;
    if (w.hover && (tl === "brush" || tl === "erase") && !w.space) {
      const r = prefsRef.current.size / 2;
      g.beginPath(); g.arc(w.hover[0], w.hover[1], r, 0, Math.PI * 2);
      g.lineWidth = 3; g.strokeStyle = "rgba(0,0,0,.5)"; g.stroke(); g.lineWidth = 1.5; g.strokeStyle = "#fff"; g.stroke();
    }
  };
  const paint = () => { if (!raf.current) raf.current = requestAnimationFrame(draw); };

  /**
   * Redraw the layer shown over the picture (only `box` when given): with a selection, the rest of the
   * picture is dimmed, the chosen part gets a light tint and its edge a solid line.
   */
  const refreshOverlay = (box?: M.Box) => {
    const w = W.current!; const { w: iw, h: ih } = w.img, mask = w.mask;
    if (prefsRef.current.tool === "auto") { drawLabels(box); return; }
    if (box && !w.any) { // first pixels chosen: the whole picture needs dimming
      for (let y = box.y; y < box.y + box.h && !w.any; y++) for (let x = box.x; x < box.x + box.w; x++) if (mask[y * iw + x]) { w.any = true; break; }
      if (w.any) box = undefined;
    }
    const b = box ?? { x: 0, y: 0, w: iw, h: ih };
    if (b.w <= 0 || b.h <= 0) return;
    const id = w.overCtx.createImageData(b.w, b.h), d = id.data;
    if (w.any) for (let y = 0; y < b.h; y++) {
      const yy = b.y + y; let m = yy * iw + b.x, o = y * b.w * 4;
      for (let x = 0; x < b.w; x++, m++, o += 4) {
        const v = mask[m], xx = b.x + x;
        if (v >= 128 && ((xx > 0 && mask[m - 1] < 128) || (xx < iw - 1 && mask[m + 1] < 128) || (yy > 0 && mask[m - iw] < 128) || (yy < ih - 1 && mask[m + iw] < 128))) {
          d[o] = EDGE[0]; d[o + 1] = EDGE[1]; d[o + 2] = EDGE[2]; d[o + 3] = 255; continue;
        }
        // blend between "dimmed" (v = 0) and "tinted" (v = 255)
        const k = v / 255;
        d[o] = Math.round(DIM[0] * (1 - k) + TINT[0] * k); d[o + 1] = Math.round(DIM[1] * (1 - k) + TINT[1] * k); d[o + 2] = Math.round(DIM[2] * (1 - k) + TINT[2] * k);
        d[o + 3] = Math.round(DIM[3] * (1 - k) + TINT[3] * k);
      }
    }
    w.overCtx.putImageData(id, b.x, b.y);
    paint();
  };
  /** Colour every guessed part (the chosen one stronger), with a line where two parts meet. */
  const drawLabels = (box?: M.Box) => {
    const w = W.current!; const { w: iw, h: ih } = w.img, lab = w.labels;
    const b = box ?? { x: 0, y: 0, w: iw, h: ih };
    if (b.w <= 0 || b.h <= 0) return;
    const id = w.overCtx.createImageData(b.w, b.h), d = id.data, act = activeRef.current;
    if (lab) for (let y = 0; y < b.h; y++) {
      const yy = b.y + y; let m = yy * iw + b.x, o = y * b.w * 4;
      for (let x = 0; x < b.w; x++, m++, o += 4) {
        const k = lab[m]; if (!k) continue;
        const xx = b.x + x, c = partColor(k);
        const edge = (xx > 0 && lab[m - 1] !== k) || (xx < iw - 1 && lab[m + 1] !== k) || (yy > 0 && lab[m - iw] !== k) || (yy < ih - 1 && lab[m + iw] !== k);
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = edge ? 235 : k === act ? 150 : 85;
      }
    }
    w.overCtx.putImageData(id, b.x, b.y);
    paint();
  };
  /** After the part map changed: count each part's pixels and update the undo buttons. */
  const afterLabels = (box?: M.Box) => {
    const w = W.current!; refreshOverlay(box);
    setUndoN(w.lundo.length); setRedoN(w.lredo.length);
    if (!w.labels) return;
    const n = new Array(256).fill(0); for (const v of w.labels) n[v]++;
    setParts((ps) => ps && ps.map((q, k) => ({ ...q, n: n[k + 1] })));
  };
  const pushLabelUndo = () => {
    const w = W.current!; if (!w.labels) return;
    w.lundo.push(w.labels.slice()); if (w.lundo.length > w.maxUndo) w.lundo.shift(); w.lredo = [];
  };
  const changed = (box?: M.Box) => {
    const w = W.current!, n = M.amount(w.mask);
    if (!!n !== w.any) { w.any = !!n; box = undefined; } // selection appeared or emptied: redraw all
    refreshOverlay(box);
    setChosen(n); setUndoN(w.undo.length); setRedoN(w.redo.length);
  };
  const pushUndo = () => {
    const w = W.current!; w.undo.push(w.mask.slice()); if (w.undo.length > w.maxUndo) w.undo.shift(); w.redo = [];
  };
  /** Forget the AI taps (the next tap starts a new AI pick on top of the current selection). */
  const endAi = () => { aiPts.current = []; aiBase.current = null; paint(); };
  // The AI reads the picture once per opening of this window. Later cuts only remove pixels, and every
  // answer is limited to pixels that are still there, so reading it again would only cost time.
  const aiKey = () => `${id}:${openedWith.current}`;
  const aiLook = () => {
    const w = W.current; if (!w || aiState.value !== "ready") return;
    setAiLooking(true);
    embed(aiKey(), w.first).catch((e) => { console.error(e); toast(t("cut_failed"), true); }).finally(() => setAiLooking(false));
  };
  const aiTap = (at: [number, number], label: number) => { aiQueue.current = aiQueue.current.then(() => aiTapNow(at, label)); };
  const aiTapNow = async (at: [number, number], label: number) => {
    const w = W.current; if (!w) return;
    if (aiState.value !== "ready") { toast(t("ai_need_model"), true); return; }
    if (at[0] < 0 || at[1] < 0 || at[0] >= w.img.w || at[1] >= w.img.h) return;
    if (!aiPts.current.length && label === 0) return; // a "not this" tap needs a "this" tap first
    if (!aiBase.current) aiBase.current = howRef.current === "replace" ? new Uint8Array(w.mask.length) : w.mask.slice();
    aiPts.current.push([at[0], at[1], label]); paint();
    setAiLooking(true);
    try {
      let res = await decode(aiKey(), w.first, aiPts.current, prefsRef.current.level);
      if (prefsRef.current.soft) res = M.grow(res, w.img.w, w.img.h); // take the blended edge pixels too
      if (W.current !== w) return;
      w.undo.push(w.mask.slice()); if (w.undo.length > w.maxUndo) w.undo.shift(); w.redo = [];
      const sub = howRef.current === "sub";
      const m = aiBase.current!.slice(); M.combine(m, res, sub ? "sub" : "add"); M.onlySolid(m, w.img);
      // small loose bits that the cut would leave behind go with the piece
      if (!sub) M.absorbCrumbs(m, w.img, Math.max(64, Math.round(w.img.w * w.img.h * 0.0015)));
      w.mask = m; changed();
    } catch (e) { console.error(e); aiPts.current.pop(); toast(t("cut_failed"), true); }
    finally { setAiLooking(false); paint(); }
  };

  /** Ask again with the same taps (after the part size changed). */
  const aiRedo = () => {
    const pts = aiPts.current; if (!pts.length) return;
    const last = pts.pop()!; aiTap([last[0], last[1]], last[2]);
  };

  const undoMask = () => {
    const w = W.current; if (!w) return;
    if (prefsRef.current.tool === "auto") { const m = w.lundo.pop(); if (!m || !w.labels) return; w.lredo.push(w.labels); w.labels = m; afterLabels(); return; }
    const m = w.undo.pop(); if (!m) return; endAi(); w.redo.push(w.mask); w.mask = m; changed();
  };
  const redoMask = () => {
    const w = W.current; if (!w) return;
    if (prefsRef.current.tool === "auto") { const m = w.lredo.pop(); if (!m || !w.labels) return; w.lundo.push(w.labels); w.labels = m; afterLabels(); return; }
    const m = w.redo.pop(); if (!m) return; endAi(); w.undo.push(w.mask); w.mask = m; changed();
  };
  const setAll = (v: 0 | 255) => { const w = W.current; if (!w) return; endAi(); pushUndo(); w.mask.fill(v); if (v) M.onlySolid(w.mask, w.img); changed(); };
  const invertSel = () => { const w = W.current; if (!w) return; endAi(); pushUndo(); M.invert(w.mask); M.onlySolid(w.mask, w.img); changed(); };
  const selectBg = () => {
    const w = W.current; if (!w) return;
    let bg = M.background(w.img, prefsRef.current.tol);
    if (!M.amount(bg)) { toast(t("cut_no_bg"), true); return 0; }
    if (prefsRef.current.soft) bg = M.grow(bg, w.img.w, w.img.h);
    endAi(); pushUndo(); M.combine(w.mask, bg, howRef.current); changed(); return 1;
  };

  // ---------- fit / view ----------
  const fit = () => {
    const w = W.current, c = cv.current; if (!w || !c) return;
    const r = c.getBoundingClientRect(), pad = 28;
    w.z = Math.min((r.width - pad * 2) / w.img.w, (r.height - pad * 2) / w.img.h, 8);
    w.ox = (r.width - w.img.w * w.z) / 2; w.oy = (r.height - w.img.h * w.z) / 2; w.fitted = true; w.auto = true; paint();
  };
  const zoomAt = (k: number, sx: number, sy: number) => {
    const w = W.current; if (!w) return;
    const z = Math.min(32, Math.max(0.02, w.z * k)); k = z / w.z;
    w.ox = sx - (sx - w.ox) * k; w.oy = sy - (sy - w.oy) * k; w.z = z; w.auto = false; paint();
  };

  // ---------- load the picture ----------
  useEffect(() => {
    if (!layer || !asset) { close(); return; }
    let live = true;
    (async () => {
      const blob = getAssetBlob(asset.id);
      if (!blob) { toast(t("cut_no_image"), true); close(); return; }
      if (asset.w * asset.h > MAX_PIXELS) { toast(t("cut_too_big"), true); close(); return; }
      openedWith.current = asset.id;
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const iw = bmp.width, ih = bmp.height;
      const pic = new OffscreenCanvas(iw, ih), pg = pic.getContext("2d", { willReadFrequently: true })!;
      pg.drawImage(bmp, 0, 0); bmp.close();
      const data = pg.getImageData(0, 0, iw, ih).data;
      if (!live) return;
      const over = new OffscreenCanvas(iw, ih), stroke = new OffscreenCanvas(iw, ih);
      W.current = {
        img: { w: iw, h: ih, data }, first: { w: iw, h: ih, data }, mask: new Uint8Array(iw * ih),
        pic, over, overCtx: over.getContext("2d")!, stroke, strokeCtx: stroke.getContext("2d", { willReadFrequently: true })!,
        undo: [], redo: [], any: false, maxUndo: Math.max(3, Math.min(20, Math.floor(120e6 / (iw * ih)))),
        z: 1, ox: 0, oy: 0, fitted: false, auto: true, lasso: null, brushAt: null, last: null, hover: null, space: false,
        pointers: new Map(), pinch: null, pan: null, labels: null, lundo: [], lredo: [], ldown: null,
      };
      setReady(true);
    })().catch((e) => { console.error(e); toast(t("cut_no_image"), true); close(); });
    return () => { live = false; };
  }, []);

  // canvas size follows the window
  useEffect(() => {
    const el = wrap.current, c = cv.current; if (!el || !c) return;
    const ro = new ResizeObserver(() => {
      if (!cv.current) return;
      const r = el.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
      c.style.width = `${r.width}px`; c.style.height = `${r.height}px`;
      if (W.current && (!W.current.fitted || W.current.auto)) fit(); else paint(); // keep fitting until the user zooms or pans
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (ready) fit(); }, [ready]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(paint, [prefs.size, prefs.tool]);
  useEffect(() => setTipOff(false), [prefs.tool]);
  useEffect(() => { void checkModel(); }, []);
  // the colours shown and the undo steps belong to the tool in use
  useEffect(() => {
    const w = W.current; if (!ready || !w) return;
    refreshOverlay();
    if (prefs.tool === "auto") { setUndoN(w.lundo.length); setRedoN(w.lredo.length); } else { setUndoN(w.undo.length); setRedoN(w.redo.length); }
  }, [prefs.tool, ready]);
  useEffect(() => { if (prefs.tool === "auto") void (async () => { await checkModel(); if (aiState.value === "ready") await checkPose(); })(); }, [prefs.tool, aiState.value]);
  useEffect(() => { if (W.current?.labels) refreshOverlay(); }, [active]);
  useEffect(() => { endAi(); if (ready && prefs.tool === "ai" && aiState.value === "ready") aiLook(); }, [prefs.tool, ready, aiState.value]);

  // ---------- pointer ----------
  const toImg = (e: PointerEvent | WheelEvent): [number, number] => {
    const w = W.current!, r = cv.current!.getBoundingClientRect();
    return [(e.clientX - r.left - w.ox) / w.z, (e.clientY - r.top - w.oy) / w.z];
  };
  const local = (e: PointerEvent | WheelEvent): [number, number] => { const r = cv.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const modeOf = (e: PointerEvent): M.Combine => (e.altKey ? "sub" : e.shiftKey ? "add" : howRef.current);

  /** Paint one brush segment into the mask (adds for the brush, removes for the eraser). */
  const brushSeg = (a: [number, number], b: [number, number], erase: boolean) => {
    const w = W.current!, { w: iw, h: ih } = w.img, r = prefsRef.current.size / 2 / w.z;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r - 1)), y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r - 1));
    const x1 = Math.min(iw, Math.ceil(Math.max(a[0], b[0]) + r + 1)), y1 = Math.min(ih, Math.ceil(Math.max(a[1], b[1]) + r + 1));
    if (x1 <= x0 || y1 <= y0) return;
    const g = w.strokeCtx;
    g.clearRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = g.fillStyle = "#000"; g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = r * 2;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0] + 0.01, b[1]); g.stroke();
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, d = g.getImageData(x0, y0, box.w, box.h).data;
    const add = new Uint8Array(box.w * box.h); for (let i = 0; i < add.length; i++) add[i] = d[i * 4 + 3];
    g.clearRect(x0, y0, box.w, box.h);
    if (!erase) for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) { // the brush never picks empty pixels
      if (w.img.data[((y0 + y) * iw + x0 + x) * 4 + 3] === 0) add[y * box.w + x] = 0;
    }
    M.combine(w.mask, add, erase ? "sub" : "add", box, iw);
    refreshOverlay(box);
  };
  /** Paint part of the picture into the chosen part (only pixels that are not see-through). */
  const paintLabel = (a: [number, number], b: [number, number]) => {
    const w = W.current!, lab = w.labels; if (!lab) return;
    const { w: iw, h: ih } = w.img, r = prefsRef.current.size / 2 / w.z;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r - 1)), y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r - 1));
    const x1 = Math.min(iw, Math.ceil(Math.max(a[0], b[0]) + r + 1)), y1 = Math.min(ih, Math.ceil(Math.max(a[1], b[1]) + r + 1));
    if (x1 <= x0 || y1 <= y0) return;
    const g = w.strokeCtx, bw = x1 - x0, bh = y1 - y0;
    g.clearRect(x0, y0, bw, bh); g.strokeStyle = "#000"; g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = r * 2;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0] + 0.01, b[1]); g.stroke();
    const d = g.getImageData(x0, y0, bw, bh).data; g.clearRect(x0, y0, bw, bh);
    const k = activeRef.current;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (y0 + y) * iw + x0 + x;
      if (d[(y * bw + x) * 4 + 3] >= 128 && w.img.data[i * 4 + 3] > 0) lab[i] = k;
    }
    const bx0 = Math.max(0, x0 - 1), by0 = Math.max(0, y0 - 1);
    refreshOverlay({ x: bx0, y: by0, w: Math.min(iw, x1 + 1) - bx0, h: Math.min(ih, y1 + 1) - by0 });
  };
  /** A tap while fixing the guess: the AI finds the part under the finger and it moves to the chosen part. */
  const tapPart = async (at: [number, number]) => {
    const w = W.current; if (!w?.labels) return;
    if (at[0] < 0 || at[1] < 0 || at[0] >= w.img.w || at[1] >= w.img.h || aiState.value !== "ready") { w.lundo.pop(); return; }
    setAiLooking(true);
    try {
      const m = await decode(aiKey(), w.first, [[at[0], at[1], 1]], prefsRef.current.level);
      const lab = w.labels, k = activeRef.current;
      if (W.current !== w || !lab) return;
      for (let i = 0; i < lab.length; i++) if (m[i] && w.img.data[i * 4 + 3] > 0) lab[i] = k;
      afterLabels();
    } catch (e) { console.error(e); w.lundo.pop(); toast(t("cut_failed"), true); }
    finally { setAiLooking(false); }
  };
  const lassoDone = (how: M.Combine) => {
    const w = W.current!, pts = w.lasso; w.lasso = null;
    if (!pts || pts.length < 3) { paint(); return; }
    const { w: iw, h: ih } = w.img;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
    const x1 = Math.min(iw, Math.ceil(Math.max(...xs)) + 1), y1 = Math.min(ih, Math.ceil(Math.max(...ys)) + 1);
    pushUndo();
    if (x1 <= x0 || y1 <= y0) { if (how === "replace") w.mask.fill(0); changed(); return; }
    const g = w.strokeCtx, box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    g.clearRect(x0, y0, box.w, box.h); g.fillStyle = "#000";
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
    const d = g.getImageData(x0, y0, box.w, box.h).data; g.clearRect(x0, y0, box.w, box.h);
    const add = new Uint8Array(box.w * box.h); for (let i = 0; i < add.length; i++) add[i] = d[i * 4 + 3];
    M.combine(w.mask, add, how, box, iw);
    if (how !== "sub") M.onlySolid(w.mask, w.img);
    changed(how === "replace" ? undefined : box);
  };

  const down = (e: PointerEvent) => {
    const w = W.current; if (!w || busy) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!tipOff) setTipOff(true);
    w.pointers.set(e.pointerId, local(e));
    if (w.pointers.size === 2) {
      // second finger: stop drawing and zoom/pan instead
      if (w.brushAt) { undoMask(); w.redo = []; setRedoN(0); }
      if (w.ldown) { const m = w.lundo.pop(); if (m) w.labels = m; w.ldown = null; afterLabels(); }
      w.brushAt = null; w.lasso = null; w.pan = null;
      const [a, b] = [...w.pointers.values()];
      w.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
      paint(); return;
    }
    if (w.pointers.size > 2) return;
    const tl = prefsRef.current.tool;
    if (tl === "hand" || w.space || e.button === 1) { w.pan = local(e); return; }
    const at = toImg(e);
    if (tl === "auto") {
      if (e.button !== 0) return;
      if (!w.labels) { toast(t("auto_need_guess")); return; }
      pushLabelUndo(); w.ldown = { at, last: at, start: local(e), moved: false }; return;
    }
    if (tl === "ai" && (e.button === 0 || e.button === 2)) { void aiTap(at, e.button === 2 || e.altKey ? 0 : aiSignRef.current); return; }
    if (e.button !== 0) return;
    if (tl === "wand") {
      if (at[0] < 0 || at[1] < 0 || at[0] >= w.img.w || at[1] >= w.img.h) return;
      let sel = M.wand(w.img, at[0], at[1], prefsRef.current.tol, prefsRef.current.contig);
      if (prefsRef.current.soft) sel = M.grow(sel, w.img.w, w.img.h); // take the blended edge pixels too
      pushUndo(); M.combine(w.mask, sel, modeOf(e)); changed();
    } else if (tl === "lasso") {
      w.lasso = [at]; w.last = null; (w as Work & { lassoHow?: M.Combine }).lassoHow = modeOf(e);
    } else {
      pushUndo(); w.brushAt = at; brushSeg(at, at, tl === "erase");
    }
  };
  const move = (e: PointerEvent) => {
    const w = W.current; if (!w) return;
    const lp = local(e);
    if (w.pointers.has(e.pointerId)) w.pointers.set(e.pointerId, lp);
    if (w.pinch && w.pointers.size >= 2) {
      const [a, b] = [...w.pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      w.ox += cx - w.pinch.cx; w.oy += cy - w.pinch.cy;
      if (w.pinch.d > 0) zoomAt(d / w.pinch.d, cx, cy);
      w.pinch = { d, cx, cy }; paint(); return;
    }
    w.hover = lp;
    if (w.pan) { w.ox += lp[0] - w.pan[0]; w.oy += lp[1] - w.pan[1]; w.pan = lp; w.auto = false; paint(); return; }
    const at = toImg(e);
    if (w.ldown) {
      const ld = w.ldown;
      if (!ld.moved && Math.hypot(lp[0] - ld.start[0], lp[1] - ld.start[1]) > 5) ld.moved = true;
      if (ld.moved) { paintLabel(ld.last, at); ld.last = at; }
      return;
    }
    if (w.lasso) { const l = w.lasso[w.lasso.length - 1]; if (Math.hypot(at[0] - l[0], at[1] - l[1]) * w.z > 2) w.lasso.push(at); paint(); return; }
    if (w.brushAt) { brushSeg(w.brushAt, at, prefsRef.current.tool === "erase"); w.brushAt = at; return; }
    paint();
  };
  const up = (e: PointerEvent) => {
    const w = W.current; if (!w) return;
    w.pointers.delete(e.pointerId);
    if (w.pinch) { if (w.pointers.size < 2) w.pinch = null; return; }
    w.pan = null;
    if (w.lasso) lassoDone((w as Work & { lassoHow?: M.Combine }).lassoHow ?? howRef.current);
    if (w.brushAt) { w.brushAt = null; changed(); }
    if (w.ldown) { const ld = w.ldown; w.ldown = null; if (ld.moved) afterLabels(); else void tapPart(ld.at); }
  };
  const leave = () => { const w = W.current; if (w) { w.hover = null; paint(); } };

  useEffect(() => {
    const c = cv.current; if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const w = W.current; if (!w) return;
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), ...local(e));
      else { w.ox -= e.deltaX; w.auto = false; paint(); }
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, []);

  // ---------- keys ----------
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const w = W.current;
      if (e.code === "Space" && w) { w.space = e.type === "keydown"; if (e.target === document.body) e.preventDefault(); paint(); }
      if (e.type !== "keydown") return;
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) { if (e.key === "Escape") (e.target as HTMLElement).blur(); return; }
      const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (key === "escape") { e.preventDefault(); if (w?.lasso) { w.lasso = null; paint(); } else close(); return; }
      if (ctrl && key === "z") { e.preventDefault(); e.shiftKey ? redoMask() : undoMask(); return; }
      if (ctrl && key === "y") { e.preventDefault(); redoMask(); return; }
      if (ctrl && key === "a") { e.preventDefault(); setAll(255); return; }
      if (ctrl && key === "d") { e.preventDefault(); setAll(0); return; }
      if (ctrl && e.shiftKey && key === "i") { e.preventDefault(); invertSel(); return; }
      if (ctrl) return;
      const tl = TOOLS.find((x) => x.key === key); if (tl) { upd({ tool: tl.id }); return; }
      if (key === "[" || key === "]") upd({ size: Math.min(300, Math.max(2, Math.round(prefsRef.current.size * (key === "]" ? 1.25 : 0.8)))) });
      if (key === "delete" || key === "backspace") { e.preventDefault(); void erase(); }
    };
    window.addEventListener("keydown", k); window.addEventListener("keyup", k);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("keyup", k); };
  }, []);

  // ---------- actions ----------
  const work = async (label: string, fn: () => Promise<void>) => {
    if (busy) return; setBusy(label);
    await new Promise((r) => setTimeout(r, 30)); // let the "working" note show first
    try { await fn(); } catch (e) { console.error(e); toast(t("cut_failed"), true); } finally { setBusy(""); }
  };
  /**
   * Weights for output. With soft edges the cut piece fades out just inside the selection edge, and the
   * picture left behind loses the whole selection and fades just outside it, so no thin ring is left over.
   */
  const outMasks = (raw = W.current!.mask) => {
    const w = W.current!;
    if (!prefsRef.current.soft) return { piece: raw, rest: raw };
    const s = M.soften(raw, w.img.w, w.img.h), piece = new Uint8Array(raw.length), rest = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) { piece[i] = Math.min(raw[i], s[i]); rest[i] = Math.max(raw[i], s[i]); }
    return { piece, rest };
  };
  /** After the layer's picture changed: show the new one and clear the selection. */
  const usePicture = (data: Uint8ClampedArray) => {
    const w = W.current!; w.img = { ...w.img, data };
    w.pic.getContext("2d")!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w.img.w, w.img.h), 0, 0);
    w.undo = []; w.redo = []; w.mask.fill(0); endAi();
    w.labels = null; w.lundo = []; w.lredo = []; setParts(null); // the guess was for the old picture
    changed();
  };
  const restOf = (m: Uint8Array) => { const w = W.current!; return M.extract(w.img, { x: 0, y: 0, w: w.img.w, h: w.img.h }, (i) => 255 - m[i]); };

  const cut = (copy: boolean) => work(t("cut_working"), async () => {
    const w = W.current!, l = project.value?.layers.find((x) => x.id === id); if (!l || !asset) return;
    const { piece: m, rest: rm } = outMasks(), d = w.img.data;
    const box = M.bounds(w.img.w, w.img.h, (i) => (m[i] && d[i * 4 + 3] ? 1 : 0));
    if (!box) { toast(t("cut_nothing"), true); return; }
    const pid = project.value!.id;
    const pieceName = name.trim() || t("cut_piece_name", { name: l.name });
    const pa = await addAsset(pid, pieceName, await png(M.extract(w.img, box, (i) => m[i]), box.w, box.h), box.w, box.h);
    let rest: Uint8ClampedArray | null = null, ra = null;
    if (!copy) { rest = restOf(rm); ra = await addAsset(pid, asset.name, await png(rest, w.img.w, w.img.h), w.img.w, w.img.h); }
    const piece: Piece = { asset: pa, x: box.x, y: box.y, name: pieceName };
    cutToLayer(l.id, piece, ra);
    toast(t(copy ? "cut_copied" : "cut_done", { name: pieceName }));
    setName("");
    if (rest) usePicture(rest); else { pushUndo(); w.mask.fill(0); changed(); }
  });
  const erase = () => work(t("cut_working"), async () => {
    const w = W.current; if (!w || !asset || !M.amount(w.mask)) { toast(t("cut_nothing"), true); return; }
    const rest = restOf(outMasks().rest);
    replaceAsset(id!, await addAsset(project.value!.id, asset.name, await png(rest, w.img.w, w.img.h), w.img.w, w.img.h));
    usePicture(rest);
  });
  const removeBg = () => work(t("cut_working"), async () => {
    const w = W.current; if (!w || !asset) return;
    const bg = M.background(w.img, prefsRef.current.tol);
    if (!M.amount(bg)) { toast(t("cut_no_bg"), true); return; }
    const rest = restOf(outMasks(prefsRef.current.soft ? M.grow(bg, w.img.w, w.img.h) : bg).rest);
    replaceAsset(id!, await addAsset(project.value!.id, asset.name, await png(rest, w.img.w, w.img.h), w.img.w, w.img.h));
    usePicture(rest); toast(t("cut_bg_done"));
  });
  const split = () => work(t("cut_working"), async () => {
    const w = W.current, l = project.value?.layers.find((x) => x.id === id); if (!w || !l) return;
    const { labels, count } = M.islands(w.img, Math.max(64, Math.round(w.img.w * w.img.h * 0.0004)));
    // one piece (a character drawn in one go): splitting by gaps cannot help, the automatic parts can
    if (count < 2) { toast(t("cut_one_piece_auto")); upd({ tool: "auto" }); return; }
    if (count > 60) { toast(t("cut_many_pieces", { n: count }), true); return; }
    const { w: iw, h: ih } = w.img, bx = Array.from({ length: count + 1 }, () => [iw, ih, -1, -1]);
    for (let i = 0; i < labels.length; i++) {
      const k = labels[i]; if (!k) continue;
      const x = i % iw, y = (i - x) / iw, b = bx[k];
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
    }
    const pieces: Piece[] = [], pid = project.value!.id;
    for (let k = 1; k <= count; k++) {
      const [x0, y0, x1, y1] = bx[k]; if (x1 < 0) continue;
      const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, nm = `${l.name} ${k}`;
      const a = await addAsset(pid, nm, await png(M.extract(w.img, box, (i) => (labels[i] === k ? 255 : 0)), box.w, box.h), box.w, box.h);
      pieces.push({ asset: a, x: box.x, y: box.y, name: nm });
    }
    splitLayer(l.id, pieces);
    toast(t("cut_split_done", { n: pieces.length }));
    close();
  });

  // ---------- automatic parts ----------
  const guess = () => work(t("auto_working"), async () => {
    const w = W.current; if (!w) return;
    const { w: iw, h: ih, data } = w.img, alpha = new Uint8Array(iw * ih);
    let clear = 0;
    for (let i = 0; i < alpha.length; i++) { alpha[i] = data[i * 4 + 3]; if (alpha[i] < 128) clear++; }
    // a picture with a solid background (a photo, a JPG): leave the plain colour around the character out
    if (clear < alpha.length * 0.01) { const bg = M.background(w.img, prefsRef.current.tol); for (let i = 0; i < alpha.length; i++) if (bg[i]) alpha[i] = 0; }
    const b = M.bounds(iw, ih, (i) => (alpha[i] > 16 ? 1 : 0)) ?? { x: 0, y: 0, w: iw, h: ih };
    const r = await guessParts(aiKey(), w.first, alpha, [b.x, b.y, b.w, b.h], prefsRef.current.detail);
    if (W.current !== w) return;
    if (!r) { toast(t("auto_no_person"), true); return; }
    w.labels = r.labels; w.lundo = []; w.lredo = [];
    setParts(r.parts.map((q) => ({ key: q.key, name: t(q.key as Key), pivot: q.pivot, parent: q.parent, z: q.z, n: 0 })));
    setActive(1); activeRef.current = 1;
    afterLabels();
  });
  const addPart = (key: Key) => {
    const w = W.current; if (!w?.labels || !parts || parts.length >= 250) return;
    const same = parts.filter((q) => q.key === key).length;
    const name = t(key) + (same ? ` ${same + 1}` : "");
    setParts([...parts, { key, name, pivot: null, parent: "part_body", z: key === "part_cloth" ? 2.5 : key === "part_hair" ? 7.5 : 8, n: 0 }]);
    setActive(parts.length + 1); activeRef.current = parts.length + 1;
  };
  const clearGuess = () => { const w = W.current; if (!w) return; w.labels = null; w.lundo = []; w.lredo = []; setParts(null); afterLabels(); };
  /** Turn the guessed parts into layers that turn at their joints and follow each other (forearm → upper arm → body). */
  const makeLayers = () => work(t("cut_working"), async () => {
    const w = W.current, l = project.value?.layers.find((x) => x.id === id), lab = w?.labels;
    if (!w || !l || !lab || !parts) return;
    const { w: iw, h: ih } = w.img, n = parts.length;
    const bx = Array.from({ length: n + 1 }, () => [iw, ih, -1, -1, 0, 0, 0]); // box, then sum x, sum y, count
    for (let i = 0; i < lab.length; i++) {
      const k = lab[i]; if (!k || k > n) continue;
      const x = i % iw, y = (i - x) / iw, b = bx[k];
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
      b[4] += x; b[5] += y; b[6]++;
    }
    const used = parts.map((q, k) => ({ q, k: k + 1 })).filter(({ k }) => bx[k][6] > 0).sort((a, b) => a.q.z - b.q.z); // back to front
    if (used.length < 2) { toast(t("cut_one_piece"), true); return; }
    const pid = project.value!.id, pieces: Piece[] = [];
    const index = new Map(used.map(({ q }, i) => [q.key, i])); // first part of each kind
    const parentOf = (key: string | null): number | undefined => {
      // follow the chain up when a part is missing (e.g. no upper arm found: the forearm follows the body)
      for (let k = key; k; k = parts.find((q) => q.key === k)?.parent ?? null) { const i = index.get(k); if (i !== undefined) return i; }
      return undefined;
    };
    const plan = used.map(({ q, k }) => {
      const [, , , , sx, sy, c] = bx[k];
      return { q, k, pivot: q.pivot ?? ([sx / c, sy / c] as [number, number]), parent: parentOf(q.parent) };
    });
    plan.forEach((pc, i) => { if (pc.parent === i) pc.parent = undefined; });
    // overlap at each joint, so turning a part never opens a gap
    const extra = new Map<number, number[]>();
    for (const pc of plan) {
      if (pc.parent === undefined) continue;
      const pa = plan[pc.parent], back = pc.q.z <= pa.q.z ? pc.k : pa.k, front = back === pc.k ? pa.k : pc.k;
      const m = meeting(lab, iw, ih, back, front, pc.k, pc.pivot);
      pc.pivot = snapPivot(m, pc.pivot); // turn where the two parts really meet
      const add = jointOverlap(lab, iw, ih, { back, front, child: pc.k, pivot: pc.pivot }, m);
      if (add.length) extra.set(back, (extra.get(back) ?? []).concat(add));
    }
    // and a thin edge along every other place two parts touch, so no hairline shows between them
    const zOf = new Map(plan.map((pc) => [pc.k, pc.q.z]));
    for (const [k, more] of seamFill(lab, iw, ih, (k) => zOf.get(k) ?? -1)) extra.set(k, (extra.get(k) ?? []).concat(more));
    for (const pc of plan) {
      // only solid pixels: a see-through edge drawn twice would look darker
      const k = pc.k, b = bx[k], more = extra.get(k)?.filter((i) => w.img.data[i * 4 + 3] >= 250), mine = more ? new Uint8Array(lab.length) : null;
      if (more) for (const i of more) {
        mine![i] = 1; const x = i % iw, y = (i - x) / iw;
        if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
      }
      const box = { x: b[0], y: b[1], w: b[2] - b[0] + 1, h: b[3] - b[1] + 1 };
      const a = await addAsset(pid, pc.q.name, await png(M.extract(w.img, box, (i) => (lab[i] === k || mine?.[i] ? 255 : 0)), box.w, box.h), box.w, box.h);
      pieces.push({ asset: a, x: box.x, y: box.y, name: pc.q.name, pivot: pc.pivot, parent: pc.parent });
    }
    splitLayer(l.id, pieces);
    toast(t("auto_done", { n: pieces.length }));
    close();
  });

  if (!layer || !asset) return null;
  const tool = prefs.tool, has = chosen > 0;
  const toolName = (x: CutTool) => t(`cut_t_${x}` as Key);

  return (
    <div class="overlay cutwin" role="dialog" aria-modal="true" aria-label={t("cut_title")}>
      <header class="cw-top">
        <button class="ibtn ghost" aria-label={t("close")} title={t("close")} onClick={close}><Icon n="left" /></button>
        <div class="cw-title"><b>{t("cut_title")}</b><small class="muted">{layer.name} · <span class="num">{asset.w}×{asset.h}</span></small></div>
        <button class="ibtn ghost" title={t("undo")} aria-label={t("undo")} disabled={!undoN} onClick={undoMask}><Icon n="undo" /></button>
        <button class="ibtn ghost" title={t("redo")} aria-label={t("redo")} disabled={!redoN} onClick={redoMask}><Icon n="redo" /></button>
        <button class="btn primary" onClick={close}>{t("cut_finish")}</button>
      </header>

      <div class="cw-tools" role="toolbar" aria-label={t("cut_title")}>
        {TOOLS.map((x) => (
          <button class={"ibtn" + (tool === x.id ? " on" : " ghost")} title={`${toolName(x.id)} (${x.key.toUpperCase()})`} aria-label={toolName(x.id)} aria-pressed={tool === x.id} onClick={() => upd({ tool: x.id })}><Icon n={x.icon} /></button>
        ))}
        <span class="cw-sep" />
        <button class="ibtn ghost" title={t("fit")} aria-label={t("fit")} onClick={fit}><Icon n="fit" /></button>
      </div>

      <div class="cw-stage" ref={wrap}>
        <canvas ref={cv} data-tool={tool} onContextMenu={(e) => e.preventDefault()} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={leave} />
        {!ready && <div class="cw-busy">{t("cut_loading")}</div>}
        {busy && <div class="cw-busy">{busy}</div>}
        {aiLooking && (tool === "ai" || tool === "auto") && <div class="cw-ai-note" role="status"><span class="cw-spin" />{t("ai_looking")}</div>}
        {!tipOff && <div class="cw-tip">{t(`cut_tip_${tool}` as Key)}</div>}
      </div>

      <aside class="cw-side">
        <section>
          <h4>{toolName(tool)}</h4>
          {tool === "ai" && <AiPanel sign={aiSign} setSign={(v) => setAiSign(v)} looking={aiLooking} points={aiPts.current.length} clear={endAi}
            level={prefs.level} setLevel={(v) => { upd({ level: v }); prefsRef.current = { ...prefsRef.current, level: v }; aiRedo(); }} />}
          {tool === "auto" && <AutoPanel detail={prefs.detail} setDetail={(v) => upd({ detail: v })} parts={parts} active={active}
            setActive={(k) => { setActive(k); activeRef.current = k; }} guess={guess} addPart={addPart} clear={clearGuess} make={makeLayers}
            busy={!!busy} size={prefs.size} setSize={(v) => upd({ size: v })} />}
          {(tool === "wand" || tool === "lasso" || (tool === "ai" && aiState.value === "ready")) && (
            <div class="seg cw-how" role="group" aria-label={t("cut_how")}>
              {(["replace", "add", "sub"] as M.Combine[]).map((m) => <button aria-pressed={how === m} title={t(`cut_how_${m}_tip` as Key)} onClick={() => setHow(m)}>{t(`cut_how_${m}` as Key)}</button>)}
            </div>
          )}
          {tool === "wand" && <>
            <label class="cw-range">{t("cut_tol")} <span class="num">{prefs.tol}</span>
              <input type="range" min={0} max={160} value={prefs.tol} onInput={(e) => upd({ tol: +(e.target as HTMLInputElement).value })} /></label>
            <label class="cw-check"><input type="checkbox" checked={prefs.contig} onChange={() => upd({ contig: !prefs.contig })} />{t("cut_contig")}</label>
          </>}
          {(tool === "brush" || tool === "erase") && (
            <label class="cw-range">{t("cut_size")} <span class="num">{prefs.size}px</span>
              <input type="range" min={2} max={300} value={prefs.size} onInput={(e) => upd({ size: +(e.target as HTMLInputElement).value })} /></label>
          )}
        </section>

        {tool !== "auto" && <section>
          <h4>{t("cut_select")} <span class="muted num cw-count">{has ? t("cut_count", { n: Math.round(chosen).toLocaleString() }) : t("cut_none")}</span></h4>
          <div class="cw-grid">
            <button class="btn" onClick={() => setAll(255)}>{t("cut_all")}</button>
            <button class="btn" disabled={!has} onClick={() => setAll(0)}>{t("cut_clear")}</button>
            <button class="btn" onClick={invertSel}>{t("cut_invert")}</button>
            <button class="btn" onClick={selectBg}>{t("cut_sel_bg")}</button>
          </div>
        </section>}

        {tool !== "auto" && <section>
          <h4>{t("cut_new_part")}</h4>
          <input class="field" value={name} maxLength={60} placeholder={t("cut_piece_name", { name: layer.name })} aria-label={t("cut_part_name")} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <div class="chips cw-parts">{PARTS.map((k) => <button class="chip" aria-pressed={name === t(k)} onClick={() => setName(t(k))}>{t(k)}</button>)}</div>
          <div class="cw-grid">
            <button class="btn primary" disabled={!has || !!busy} onClick={() => cut(false)}><Icon n="scissors" />{t("cut_cut")}</button>
            <button class="btn" disabled={!has || !!busy} onClick={() => cut(true)}><Icon n="copy" />{t("cut_copy")}</button>
          </div>
          <label class="cw-check"><input type="checkbox" checked={prefs.soft} onChange={() => upd({ soft: !prefs.soft })} />{t("cut_soft")}</label>
        </section>}

        <section>
          <h4>{t("cut_picture")}</h4>
          {tool !== "auto" && <button class="btn primary wide" style={{ width: "100%", marginBottom: "8px" }} disabled={!!busy} onClick={() => upd({ tool: "auto" })}>
            <Icon n="figure" />{t("cut_auto_btn")}</button>}
          <div class="cw-grid">
            <button class="btn danger" disabled={!has || !!busy} onClick={erase}><Icon n="trash" />{t("cut_erase")}</button>
            <button class="btn" disabled={!!busy} onClick={removeBg}>{t("cut_remove_bg")}</button>
            <button class="btn wide" disabled={!!busy} onClick={split}><Icon n="split" />{t("cut_split")}</button>
          </div>
          <p class="muted cw-note">{t("cut_split_note")}</p>
        </section>
      </aside>
    </div>
  );
}

function AiPanel({ sign, setSign, looking, points, clear, level, setLevel }: { sign: 1 | 0; setSign: (v: 1 | 0) => void; looking: boolean; points: number; clear: () => void; level: 0 | 1 | 2; setLevel: (v: 0 | 1 | 2) => void }) {
  const st = aiState.value;
  if (st === "ready") return <>
    <div class="cw-range">{t("ai_level")}
      <div class="seg" role="group" aria-label={t("ai_level")} style={{ width: "100%" }}>
        {([0, 1, 2] as const).map((v) => <button style={{ flex: "1" }} aria-pressed={level === v} title={t(`ai_level_${v}_tip` as Key)} onClick={() => setLevel(v)}>{t(`ai_level_${v}` as Key)}</button>)}
      </div>
    </div>
    <div class="seg cw-how" role="group" aria-label={t("ai_tap")}>
      <button aria-pressed={sign === 1} onClick={() => setSign(1)}>+ {t("ai_this")}</button>
      <button aria-pressed={sign === 0} onClick={() => setSign(0)}>&minus; {t("ai_not")}</button>
    </div>
    <p class="muted cw-note">{looking ? t("ai_looking") : t("ai_hint")}</p>
    {points > 0 && <button class="btn" onClick={clear}>{t("ai_new_pick")}</button>}
  </>;
  if (st === "downloading") return <>
    <p class="cw-note">{t("ai_downloading", { mb: MODEL_MB })}</p>
    <div class="xbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(aiProgress.value * 100)}><i style={{ width: `${aiProgress.value * 100}%` }} /></div>
    <p class="muted num cw-note">{Math.round(aiProgress.value * 100)}%</p>
  </>;
  if (st === "loading" || st === "unknown") return <p class="muted cw-note">{t("ai_starting")}</p>;
  return <>
    <p class="cw-note">{t("ai_about", { mb: MODEL_MB })}</p>
    {st === "error" && <p class="cw-note" style={{ color: "var(--danger)" }}>{t("ai_failed", { msg: aiError.value })}</p>}
    <button class="btn primary" onClick={() => void downloadModel()}><Icon n="install" />{t(st === "error" ? "ai_retry" : "ai_download", { mb: MODEL_MB })}</button>
  </>;
}

function AutoPanel({ detail, setDetail, parts, active, setActive, guess, addPart, clear, make, busy, size, setSize }: {
  detail: 0 | 1 | 2; setDetail: (v: 0 | 1 | 2) => void; parts: AutoPart[] | null; active: number; setActive: (k: number) => void;
  guess: () => void; addPart: (k: Key) => void; clear: () => void; make: () => void; busy: boolean; size: number; setSize: (v: number) => void;
}) {
  const ai = aiState.value, st = poseState.value;
  const need = (ai === "ready" ? 0 : MODEL_MB) + POSE_MB;
  if (ai === "downloading" || st === "downloading") {
    const v = ai === "downloading" ? aiProgress.value * (MODEL_MB / need) : (need - POSE_MB) / need + poseProgress.value * (POSE_MB / need);
    return <>
      <p class="cw-note">{t("auto_downloading", { mb: need })}</p>
      <div class="xbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}><i style={{ width: `${v * 100}%` }} /></div>
      <p class="muted num cw-note">{Math.round(v * 100)}%</p>
    </>;
  }
  if (st === "loading" || st === "unknown" || ai === "loading" || ai === "unknown") return <p class="muted cw-note">{t("ai_starting")}</p>;
  if (st !== "ready" || ai !== "ready") return <>
    <p class="cw-note">{t("auto_about", { mb: need })}</p>
    {(st === "error" || ai === "error") && <p class="cw-note" style={{ color: "var(--danger)" }}>{t("ai_failed", { msg: poseError.value || aiError.value })}</p>}
    <button class="btn primary" onClick={() => void downloadPose()}><Icon n="install" />{t(st === "error" || ai === "error" ? "ai_retry" : "auto_download", { mb: need })}</button>
  </>;
  const total = parts?.reduce((n, q) => n + (q.n > 0 ? 1 : 0), 0) ?? 0;
  return <>
    <div class="cw-range">{t("auto_detail")}
      <div class="seg" role="group" aria-label={t("auto_detail")} style={{ width: "100%" }}>
        {([0, 1, 2] as const).map((v) => <button style={{ flex: "1" }} aria-pressed={detail === v} title={t(`auto_detail_${v}_tip` as Key)} onClick={() => setDetail(v)}>{t(`auto_detail_${v}` as Key)}</button>)}
      </div>
    </div>
    <p class="muted cw-note">{t(`auto_detail_${detail}_tip` as Key)}</p>
    <button class={"btn" + (parts ? "" : " primary")} disabled={busy} onClick={guess}><Icon n="figure" />{t(parts ? "auto_again" : "auto_guess")}</button>
    {parts && <>
      <h4 style={{ marginTop: "10px" }}>{t("auto_parts")}</h4>
      <div class="chips cw-parts" role="radiogroup" aria-label={t("auto_parts")}>
        {parts.map((q, i) => {
          const c = partColor(i + 1);
          return <button class="chip" role="radio" aria-checked={active === i + 1} aria-pressed={active === i + 1} onClick={() => setActive(i + 1)} style={{ opacity: q.n ? 1 : 0.55 }}>
            <i class="cw-dot" style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />{q.name}</button>;
        })}
      </div>
      <p class="muted cw-note">{t("auto_hint")}</p>
      <label class="cw-range">{t("auto_brush")} <span class="num">{size}px</span>
        <input type="range" min={2} max={300} value={size} onInput={(e) => setSize(+(e.target as HTMLInputElement).value)} /></label>
      <div class="chips cw-parts" aria-label={t("auto_add")}>
        <span class="muted cw-note">{t("auto_add")}:</span>
        {EXTRA_PARTS.map((k) => <button class="chip" onClick={() => addPart(k)}>+ {t(k)}</button>)}
      </div>
      <div class="cw-grid">
        <button class="btn primary wide" disabled={busy || total < 2} onClick={make}><Icon n="split" />{t("auto_make", { n: total })}</button>
        <button class="btn wide" disabled={busy} onClick={clear}>{t("auto_clear")}</button>
      </div>
    </>}
  </>;
}
