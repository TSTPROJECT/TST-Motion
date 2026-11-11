// Runs the "tap to select" model (SlimSAM, Apache-2.0) away from the screen thread, on the CPU.
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { boxMean, guided, guideStats, tidy } from "./mask";
import { planParts, assignParts, cleanLabels, type Detail, type Joint } from "./parts";

ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
ort.env.wasm.numThreads = 1; // one thread: several need a cross-origin-isolated window, which hung the runtime here

const SIZE = 1024, LOW = 256;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

let enc: ort.InferenceSession | null = null, dec: ort.InferenceSession | null = null;
let current: { key: string; w: number; h: number; nw: number; nh: number; emb: ort.Tensor; pos: ort.Tensor; gray: Float32Array; flat: OffscreenCanvas } | null = null;
let poseModel: ort.InferenceSession | null = null;
let stats: (ReturnType<typeof guideStats> & { key: string }) | null = null; // kept per picture: every answer's smoothing uses it
let jointsFor: { key: string; box: string; joints: Joint[] } | null = null; // "guess again" at another detail needs no new look

type In =
  | { id: number; type: "load"; enc: ArrayBuffer; dec: ArrayBuffer }
  | { id: number; type: "embed"; key: string; w: number; h: number; rgba: Uint8ClampedArray }
  | { id: number; type: "decode"; key: string; points: Array<[number, number, number]>; level: 0 | 1 | 2 }
  | { id: number; type: "loadPose"; model: ArrayBuffer }
  | { id: number; type: "pose"; key: string; box: [number, number, number, number] }
  | { id: number; type: "parts"; key: string; joints: Joint[]; detail: Detail; alpha: Uint8Array };

const reply = (id: number, data: object, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage({ id, ...data }, transfer);

// One job at a time: the runtime must not run two models at once, and a tap must wait for the look before it.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<In>) => { queue = queue.then(() => handle(e.data)); };

// The model's guesses for one tap, kept until the next picture.
const asked = new Map<string, { scores: Float32Array; masks: Float32Array }>();
async function guessesAt(x: number, y: number) {
  const c = current!, id = `${Math.round(x)},${Math.round(y)}`;
  let g = asked.get(id);
  if (!g) {
    const out = await dec!.run({
      input_points: new ort.Tensor("float32", new Float32Array([(x * c.nw) / c.w, (y * c.nh) / c.h]), [1, 1, 1, 2]),
      input_labels: new ort.Tensor("int64", new BigInt64Array([1n]), [1, 1, 1]),
      image_embeddings: c.emb, image_positional_embeddings: c.pos,
    });
    g = { scores: out.iou_scores.data as Float32Array, masks: out.pred_masks.data as Float32Array };
    asked.set(id, g);
  }
  return g;
}
/**
 * The part at a tap, as 256×256 scores (above 0 = in). The model offers up to three guesses (a small bit,
 * the part, the whole thing). Guesses that would swallow a tap of the other kind are skipped; of the
 * confident ones left, ordered by size, the size the user chose is taken.
 */
async function partAt(p: [number, number, number], others: Array<[number, number, number]>, level: 0 | 1 | 2) {
  const c = current!, { scores, masks } = await guessesAt(p[0], p[1]), N = LOW * LOW, count = scores.length;
  const cellOf = (x: number, y: number) => Math.min(LOW - 1, Math.floor(((y * c.nh) / c.h) / (SIZE / LOW))) * LOW + Math.min(LOW - 1, Math.floor(((x * c.nw) / c.w) / (SIZE / LOW)));
  const area = (i: number) => { let n = 0; for (let j = i * N; j < (i + 1) * N; j++) if (masks[j] > 0) n++; return n; };
  const all = [...Array(count).keys()].filter((i) => area(i) > 0);
  const clean = all.filter((i) => others.every(([x, y]) => masks[i * N + cellOf(x, y)] <= 0));
  let best: number;
  if (clean.length) {
    const top = Math.max(...clean.map((i) => scores[i]));
    const ok = clean.filter((i) => scores[i] >= top - 0.15).sort((a, b) => area(a) - area(b));
    best = ok[Math.round((level / 2) * (ok.length - 1))];
  } else best = all.length ? all.sort((a, b) => area(a) - area(b))[0] : 0; // nothing fits: the smallest
  return masks.subarray(best * N, (best + 1) * N);
}

/**
 * The answer is a rough 256×256 grid (one cell is several picture pixels). Where the model is unsure the cells
 * flip between yes and no, which looked like scattered crumbs. So it is sampled smoothly at every picture
 * pixel and its edges are let settle onto the drawing's own edges before deciding in or out.
 */
function fullSize(logits: Float32Array): Uint8Array {
  const { w, h, nw, nh, gray } = current!, out = new Uint8Array(w * h), k = SIZE / LOW;
  const r = Math.max(2, Math.round((Math.max(w, h) / LOW) * 1.5));
  if (stats?.key !== current!.key || stats.r !== r) stats = { key: current!.key, ...guideStats(gray, w, h, r) };
  // only work on the area the answer covers (plus room for the smoothing): parts are often small
  let cx0 = LOW, cy0 = LOW, cx1 = -1, cy1 = -1;
  for (let i = 0; i < LOW * LOW; i++) if (logits[i] > -4) { const x = i % LOW, y = (i - x) / LOW; if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; }
  if (cx1 < 0) return out;
  const toX = (c: number) => (c * k * w) / nw, toY = (c: number) => (c * k * h) / nh, pad = r * 2 + 2;
  const X0 = Math.max(0, Math.floor(toX(cx0 - 1)) - pad), X1 = Math.min(w, Math.ceil(toX(cx1 + 2)) + pad);
  const Y0 = Math.max(0, Math.floor(toY(cy0 - 1)) - pad), Y1 = Math.min(h, Math.ceil(toY(cy1 + 2)) + pad);
  if (X1 <= X0 || Y1 <= Y0) return out;
  const cw = X1 - X0, ch = Y1 - Y0, n = cw * ch;
  const prob = new Float32Array(n), g = new Float32Array(n), mI = new Float32Array(n), vI = new Float32Array(n);
  for (let y = 0; y < ch; y++) {
    const Y = y + Y0, ly = Math.min(LOW - 1, Math.max(0, (((Y + 0.5) * nh) / h) / k - 0.5)), y0 = Math.floor(ly), y1 = Math.min(LOW - 1, y0 + 1), fy = ly - y0;
    const src = Y * w + X0, o = y * cw;
    g.set(gray.subarray(src, src + cw), o); mI.set(stats.mI.subarray(src, src + cw), o); vI.set(stats.vI.subarray(src, src + cw), o);
    for (let x = 0; x < cw; x++) {
      const lx = Math.min(LOW - 1, Math.max(0, (((x + X0 + 0.5) * nw) / w) / k - 0.5)), x0 = Math.floor(lx), x1 = Math.min(LOW - 1, x0 + 1), fx = lx - x0;
      const v = (logits[y0 * LOW + x0] * (1 - fx) + logits[y0 * LOW + x1] * fx) * (1 - fy) + (logits[y1 * LOW + x0] * (1 - fx) + logits[y1 * LOW + x1] * fx) * fy;
      prob[o + x] = 1 / (1 + Math.exp(-v));
    }
  }
  const smooth = guided(g, prob, cw, ch, r, 1e-3, { r, mI, vI });
  // in or out: "half sure" pixels would leave see-through ghosts
  for (let y = 0; y < ch; y++) { const o = y * cw, d = (y + Y0) * w + X0; for (let x = 0; x < cw; x++) if (smooth[o + x] > 0.5) out[d + x] = 255; }
  return out;
}

/**
 * Find the body's joints (ViTPose, COCO order) inside box [x, y, w, h] of the picture.
 * Each joint: x, y in picture pixels and how sure the model is.
 */
async function findJoints(box: [number, number, number, number]): Promise<Joint[]> {
  const W = 192, H = 256, c = current!;
  // widen the box to the model's 3:4 shape plus a margin, like the model was trained
  let bw = box[2], bh = box[3]; const cx = box[0] + bw / 2, cy = box[1] + bh / 2;
  if (bw / bh > W / H) bh = (bw * H) / W; else bw = (bh * W) / H;
  bw *= 1.25; bh *= 1.25;
  const k = W / bw, cv = new OffscreenCanvas(W, H), g = cv.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.imageSmoothingQuality = "high";
  g.drawImage(c.flat, W / 2 - cx * k, H / 2 - cy * k, c.w * k, c.h * k);
  const d = g.getImageData(0, 0, W, H).data, x = new Float32Array(3 * W * H);
  for (let i = 0; i < W * H; i++) for (let ch = 0; ch < 3; ch++) x[ch * W * H + i] = (d[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  const out = await poseModel!.run({ [poseModel!.inputNames[0]]: new ort.Tensor("float32", x, [1, 3, H, W]) });
  const hm = out[poseModel!.outputNames[0]], [, n, hh, ww] = hm.dims as number[], hd = hm.data as Float32Array;
  const joints: Joint[] = [];
  for (let j = 0; j < n; j++) {
    const o = j * hh * ww; let bi = 0, bv = -Infinity;
    for (let i = 0; i < hh * ww; i++) if (hd[o + i] > bv) { bv = hd[o + i]; bi = i; }
    let gx = bi % ww, gy = (bi - gx) / ww;
    // a quarter cell towards the higher neighbour (the usual sub-cell guess)
    const v = (xx: number, yy: number) => hd[o + Math.min(hh - 1, Math.max(0, yy)) * ww + Math.min(ww - 1, Math.max(0, xx))];
    const dx = v(gx + 1, gy) - v(gx - 1, gy), dy = v(gx, gy + 1) - v(gx, gy - 1);
    gx += 0.25 * Math.sign(dx); gy += 0.25 * Math.sign(dy);
    const px = ((gx + 0.5) / ww) * W, py = ((gy + 0.5) / hh) * H;
    joints.push([(px - W / 2) / k + cx, (py - H / 2) / k + cy, bv]);
  }
  return joints;
}

async function handle(m: In) {
  try {
    if (m.type === "load") {
      const opts: ort.InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
      enc = await ort.InferenceSession.create(new Uint8Array(m.enc), opts);
      dec = await ort.InferenceSession.create(new Uint8Array(m.dec), opts);
      reply(m.id, { ok: true, inputs: [...enc.inputNames, "|", ...dec.inputNames], outputs: [...enc.outputNames, "|", ...dec.outputNames] });
    } else if (m.type === "embed") {
      const t0 = performance.now();
      current = null; asked.clear();
      const s = SIZE / Math.max(m.w, m.h), nw = Math.round(m.w * s), nh = Math.round(m.h * s);
      // see-through parts become white: the model was trained on ordinary photos
      const flat = new Uint8ClampedArray(m.rgba.length);
      for (let i = 0; i < flat.length; i += 4) {
        const a = m.rgba[i + 3] / 255;
        flat[i] = m.rgba[i] * a + 255 * (1 - a); flat[i + 1] = m.rgba[i + 1] * a + 255 * (1 - a); flat[i + 2] = m.rgba[i + 2] * a + 255 * (1 - a); flat[i + 3] = 255;
      }
      const src = new OffscreenCanvas(m.w, m.h); src.getContext("2d")!.putImageData(new ImageData(flat as Uint8ClampedArray<ArrayBuffer>, m.w, m.h), 0, 0);
      const small = new OffscreenCanvas(nw, nh), g = small.getContext("2d", { willReadFrequently: true })!;
      g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, nw, nh);
      const px = g.getImageData(0, 0, nw, nh).data;
      const gray = new Float32Array(m.w * m.h); // brightness of the full picture, to make the answer's edges follow the drawing
      for (let i = 0; i < gray.length; i++) gray[i] = (0.299 * flat[i * 4] + 0.587 * flat[i * 4 + 1] + 0.114 * flat[i * 4 + 2]) / 255;
      const data = new Float32Array(3 * SIZE * SIZE); // padded with zeros (right and bottom)
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const i = (y * nw + x) * 4, o = y * SIZE + x;
        for (let c = 0; c < 3; c++) data[c * SIZE * SIZE + o] = (px[i + c] / 255 - MEAN[c]) / STD[c];
      }
      const out = await enc!.run({ pixel_values: new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]) });
      current = { key: m.key, w: m.w, h: m.h, nw, nh, emb: out.image_embeddings, pos: out.image_positional_embeddings, gray, flat: src };
      reply(m.id, { ok: true, ms: Math.round(performance.now() - t0) });
    } else if (m.type === "decode") {
      if (!current || current.key !== m.key) throw new Error("not embedded");
      const { w, h } = current;
      // Every tap is asked on its own ("what is the part here?"). "This" parts are added together and
      // "not this" parts are taken away. Asking about all taps at once made the model look for one thing
      // that covers every tap, which grew to whole outfits.
      const pos = m.points.filter((p) => p[2] === 1), neg = m.points.filter((p) => p[2] === 0);
      const join = async (pts: typeof pos, others: typeof pos) => {
        const l = new Float32Array(LOW * LOW).fill(-20);
        for (const p of pts) { const seg = await partAt(p, others, m.level); for (let i = 0; i < seg.length; i++) if (seg[i] > l[i]) l[i] = seg[i]; }
        return l;
      };
      const n2 = w * h, cell = Math.max(w, h) / LOW;
      const raw = fullSize(await join(pos, neg));
      if (neg.length) {
        // take the "not this" parts away, with a few pixels to spare so no hairline of their outline stays behind
        const spare = boxMean(Float32Array.from(fullSize(await join(neg, pos))), w, h, Math.max(2, Math.round(cell / 2)));
        for (let i = 0; i < n2; i++) if (spare[i] > 0) raw[i] = 0;
      }
      const yes = pos.map((p): [number, number] => [p[0], p[1]]);
      const mask = tidy(raw, w, h, yes, Math.max(64, Math.round(n2 * 0.002)));
      reply(m.id, { ok: true, mask }, [mask.buffer]);
    } else if (m.type === "loadPose") {
      poseModel = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      reply(m.id, { ok: true });
    } else if (m.type === "pose") {
      if (!current || current.key !== m.key) throw new Error("not embedded");
      const box = m.box.join(",");
      if (jointsFor?.key !== m.key || jointsFor.box !== box) jointsFor = { key: m.key, box, joints: await findJoints(m.box) };
      reply(m.id, { ok: true, joints: jointsFor.joints });
    } else if (m.type === "parts") {
      if (!current || current.key !== m.key) throw new Error("not embedded");
      const plan = planParts(m.joints, m.detail);
      if (!plan) { reply(m.id, { ok: true, labels: null }); return; }
      const { w, h } = current;
      // ask the cutting AI about each part's own points; points of the other parts must stay outside
      const found: Array<Uint8Array | null> = [], ms = { ask: 0, size: 0, assign: 0, clean: 0 };
      let t = performance.now();
      const lap = (k: keyof typeof ms) => { const n = performance.now(); ms[k] += n - t; t = n; };
      for (const part of plan) {
        const others = plan.filter((q) => q !== part).flatMap((q) => q.taps.map((t): [number, number, number] => [t[0], t[1], 1]));
        const l = new Float32Array(LOW * LOW).fill(-20);
        for (const t of part.taps) {
          if (t[0] < 0 || t[1] < 0 || t[0] >= w || t[1] >= h) continue;
          const seg = await partAt([t[0], t[1], 1], others, 1);
          for (let i = 0; i < seg.length; i++) if (seg[i] > l[i]) l[i] = seg[i];
        }
        lap("ask");
        found.push(fullSize(l));
        lap("size");
      }
      const sw = Math.hypot(m.joints[5][0] - m.joints[6][0], m.joints[5][1] - m.joints[6][1]);
      // parts other than the body only pull in cloth close to them: loose coat tails stay with the body
      const within = plan.map((q) => (q.poly ? Infinity : sw * 0.5));
      const labels = assignParts(w, h, m.alpha, plan, found, Math.max(8, sw * 0.45), within);
      lap("assign");
      cleanLabels(labels, w, h);
      lap("clean");
      reply(m.id, { ok: true, ms, labels, plan: plan.map((q) => ({ key: q.key, pivot: q.pivot, parent: q.parent, z: q.z })) }, [labels.buffer]);
    }
  } catch (err) {
    reply(m.id, { ok: false, error: String((err as Error)?.message ?? err) });
  }
}
