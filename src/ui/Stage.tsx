// The canvas: draws the frame, lets you pick and drag parts, pan and zoom.
import { useEffect, useRef, useState } from "preact/hooks";
import { effect } from "@preact/signals";
import { project, rev, frame, selected, tool, mode, onion, camView, showPath, sketchArm, playing, writeKey, begin, live, finish, edit, writeProp, movePivotLive, uid, type Tool } from "../model/store";
import { apply, invert, mul, valueAt, pathFrames, posAt, headingAt, cameraOf, cameraMatrix, type Mat, type Solved } from "../model/anim";
import { solveShown } from "../model/physics";
import { unpinPoint, facePoint, type P } from "../model/warp";
import { pinChan } from "../model/types";
import type { Ghost } from "../render/renderer";
import { pull } from "../model/ik";
import type { Background, Layer, Project } from "../model/types";
import { createRenderer, type Renderer } from "../render/renderer";
import { hitAsset, onAssetsChanged } from "../io/assets";
import { t } from "../i18n";
import { Icon } from "./icons";
import { theme } from "./shell";

type Drag =
  | { k: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { k: "move"; id: string; p0: [number, number]; x0: number; y0: number; inv: Mat; cam?: number }
  | { k: "rotate"; id: string; c: [number, number]; last: number; acc: number; r0: number; sign: number }
  | { k: "scale"; id: string; ref: [number, number]; d0: number; sx0: number; sy0: number; cam?: boolean }
  | { k: "pivot"; id: string; inv: Mat }
  /** pin: drag a pin to bend the picture */
  | { k: "pin"; id: string; pin: string; inv: Mat; rx: number; ry: number }
  /** pose: the held part (and the one above it) turn so the held point follows the pointer */
  | { k: "ik"; ids: string[]; r0: number[]; sign: number[]; j1: [number, number]; j2: [number, number] | null; e0: [number, number] }
  /** sketch: the part follows the pointer while time runs; keys are written as it goes */
  | { k: "sketch"; id: string; f0: number; t0: number; last: number; at: [number, number]; trail: Array<[number, number]>; raf: number };

const HANDLE = 22; // touch-friendly hit radius in CSS px

export function Stage({ onImport, dropping }: { onImport: () => void; dropping: boolean }) {
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), ov = useRef<HTMLCanvasElement>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const st = useRef({ z: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1, fitted: false, auto: true, raf: 0, renderer: null as Renderer | null, solved: null as Solved | null, path: null as null | { key: string; pts: Array<[number, number]>; keys: number[] }, drag: null as Drag | null, pointers: new Map<number, [number, number]>(), pinch: null as null | { d: number; mx: number; my: number; z: number; ox: number; oy: number }, space: false });

  const view = (): Mat => { const s = st.current; return [s.z, 0, 0, s.z, s.ox, s.oy]; };
  const toComp = (x: number, y: number) => apply(invert(view()), x, y);

  function fit() {
    const s = st.current, p = project.value; if (!p || !s.w) return;
    const small = s.w < 600;
    const padX = small ? 16 : 40, padTop = small ? 16 : 52, padBot = small ? 64 : 74;
    s.z = Math.max(0.02, Math.min((s.w - padX * 2) / p.w, (s.h - padTop - padBot) / p.h));
    s.ox = (s.w - p.w * s.z) / 2; s.oy = padTop + (s.h - padTop - padBot - p.h * s.z) / 2; s.auto = true;
    setZoomPct(Math.round(s.z * 100)); schedule();
  }
  function zoomAt(k: number, x: number, y: number) {
    const s = st.current, nz = Math.min(16, Math.max(0.02, s.z * k)); s.auto = false;
    s.ox = x - (x - s.ox) * (nz / s.z); s.oy = y - (y - s.oy) * (nz / s.z); s.z = nz;
    setZoomPct(Math.round(nz * 100)); schedule();
  }

  function schedule() {
    const s = st.current; if (s.raf) return;
    s.raf = requestAnimationFrame(() => { s.raf = 0; draw(); });
  }
  function draw() {
    const s = st.current, p = project.value, c = cv.current, o = ov.current; if (!p || !c || !o || !s.w) return;
    if (!s.renderer) s.renderer = createRenderer(c);
    s.solved = solveShown(p, frame.value, camView.value);
    const dv: Mat = mul([s.dpr, 0, 0, s.dpr, 0, 0], view());
    // onion skin: frames before in red, after in green, fainter the further away
    const ghosts: Ghost[] = [];
    const on = onion.value;
    if (on.on) {
      for (const [dir, n, tint] of [[-1, on.before, [0.92, 0.25, 0.3]], [1, on.after, [0.15, 0.7, 0.35]]] as Array<[number, number, [number, number, number]]>) {
        for (let i = n; i >= 1; i--) {
          const g = frame.value + dir * i * on.step; if (g < 0 || g >= p.frames) continue;
          const S = solveShown(p, g, camView.value);
          ghosts.push({ world: S.world, alpha: S.alpha, follow: S.follow, deform: S.deform, pic: S.pic, tint, k: 0.42 * (1 - (i - 1) / (n + 1)) });
        }
      }
    }
    const S = s.solved;
    s.renderer.draw({ project: p, frame: frame.value, world: S.world, alpha: S.alpha, follow: S.follow, deform: S.deform, pic: S.pic, ghosts }, dv, c.width, c.height);
    drawOverlay(p, s.solved);
  }

  function screenOf(m: Mat, x: number, y: number) { return apply(mul(view(), m), x, y); }
  /** Pins of a part: rest point, where it is now (own pixels, after the 3D turn) and on screen. */
  function pinsOf(l: Layer, S: Solved) {
    const f = frame.value, m = S.world.get(l.id)!;
    const face = l.face ? { turn: valueAt(l, "turn", f), nod: valueAt(l, "nod", f) } : null;
    return (l.pins ?? []).map((q) => {
      const dx = valueAt(l, pinChan(q.id, "x"), f), dy = valueAt(l, pinChan(q.id, "y"), f);
      let at: P = [q.x + dx, q.y + dy];
      if (face && l.face && (face.turn || face.nod)) at = facePoint(l.face, face.turn, face.nod, at[0], at[1]);
      return { id: q.id, rest: [q.x, q.y] as P, dst: [q.x + dx, q.y + dy] as P, scr: screenOf(m, at[0], at[1]) };
    });
  }
  function handlesOf(p: Project, l: Layer, S: Solved) {
    // the camera's handles are its frame (the size of the output)
    const a = l.camera ? { w: p.w, h: p.h } : p.assets.find((x) => x.id === l.asset); if (!a) return null;
    const m = S.world.get(l.id)!;
    const corners = [[0, 0], [a.w, 0], [a.w, a.h], [0, a.h]].map(([x, y]) => screenOf(m, x, y));
    const piv = screenOf(m, l.px, l.py);
    const topMid: [number, number] = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
    const center = screenOf(m, a.w / 2, a.h / 2);
    const dx = topMid[0] - center[0], dy = topMid[1] - center[1], len = Math.hypot(dx, dy) || 1;
    const rot: [number, number] = [topMid[0] + (dx / len) * 28, topMid[1] + (dy / len) * 28];
    return { corners, piv, topMid, rot, center };
  }

  /** Where the part's joint is in the composition at every frame (cached until something changes). */
  function pathOf(p: Project, l: Layer) {
    const s = st.current, key = `${rev.value}|${l.id}|${camView.value}|${p.frames}`;
    if (s.path?.key === key) return s.path;
    const keys = pathFrames(l), pts: Array<[number, number]> = [];
    if (keys.length >= 2) {
      // a part on its own, without a camera view, needs no full solve per frame
      const plain = !l.parent && !(camView.value && cameraOf(p));
      for (let f = 0; f < p.frames; f++) {
        const m = plain ? null : solveShown(p, f, camView.value).world.get(l.id);
        pts.push(m ? apply(m, l.px, l.py) : posAt(l, f));
      }
    }
    return (s.path = { key, pts, keys });
  }
  /** Motion path: a line through where the joint goes, a dot per frame (close dots = slow), a square per key. */
  function drawPath(g: CanvasRenderingContext2D, p: Project, l: Layer, accent: string) {
    if (mode.value !== "animate" || !showPath.value || l.camera && camView.value || (tool.value !== "move" && tool.value !== "rotate")) return;
    const d = st.current.drag;
    if (d?.k === "sketch") {
      g.save(); g.strokeStyle = "#ff5a3c"; g.lineWidth = 2.5; g.lineCap = g.lineJoin = "round";
      g.beginPath(); d.trail.forEach(([x, y], i) => { const [sx, sy] = apply(view(), x, y); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); }); g.stroke(); g.restore();
      return;
    }
    const P = pathOf(p, l); if (!P.pts.length) return;
    const scr = P.pts.map(([x, y]) => apply(view(), x, y));
    g.save(); g.lineCap = g.lineJoin = "round";
    g.strokeStyle = "rgba(20,24,33,.45)"; g.lineWidth = 4; g.beginPath(); scr.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    g.strokeStyle = accent; g.lineWidth = 2; g.globalAlpha = .9; g.stroke();
    g.globalAlpha = 1; g.fillStyle = accent;
    for (const [x, y] of scr) { g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill(); }
    for (const f of P.keys) {
      const q = scr[Math.min(scr.length - 1, Math.max(0, f))]; if (!q) continue;
      const now = f === frame.value;
      g.fillStyle = now ? accent : "#fff"; g.strokeStyle = now ? "#fff" : accent; g.lineWidth = 2;
      g.save(); g.translate(q[0], q[1]); g.rotate(Math.PI / 4); g.fillRect(-5, -5, 10, 10); g.strokeRect(-5, -5, 10, 10); g.restore();
    }
    g.restore();
  }
  /** Path key under the pointer (screen px), if any. */
  function pathKeyAt(p: Project, l: Layer, x: number, y: number): number | null {
    if (mode.value !== "animate" || !showPath.value || l.camera && camView.value) return null;
    const P = pathOf(p, l); let best: number | null = null, bd = 12;
    for (const f of P.keys) { const q = P.pts[f]; if (!q) continue; const [sx, sy] = apply(view(), ...q), dd = Math.hypot(sx - x, sy - y); if (dd <= bd) { bd = dd; best = f; } }
    return best;
  }
  /** The parent's world matrix for moving a part: its parent, or the camera when looking through it. */
  function parentWorld(l: Layer, S: Solved, f = frame.value): Mat {
    const p = project.value!;
    if (l.parent) return S.world.get(l.parent) ?? [1, 0, 0, 1, 0, 0];
    const cam = cameraOf(p);
    return camView.value && cam && !l.camera ? cameraMatrix(p, cam, f) : [1, 0, 0, 1, 0, 0];
  }
  /** Own turn of a part, without the extra turn from facing along its path. */
  const ownRot = (l: Layer, S: Solved) => S.pose.get(l.id)!.rot - (l.path?.orient ? headingAt(l, frame.value) : 0);

  function drawOverlay(p: Project, S: Solved) {
    const s = st.current, o = ov.current!, g = o.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#3b74ff";
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, o.width, o.height);
    g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    // dim what lies outside the frame
    const [fx, fy] = [s.ox, s.oy], fw = p.w * s.z, fh = p.h * s.z;
    g.fillStyle = css.getPropertyValue("--outside").trim() || "rgba(0,0,0,.5)";
    g.beginPath(); g.rect(0, 0, s.w, s.h); g.rect(fx, fy, fw, fh); g.fill("evenodd");
    g.strokeStyle = css.getPropertyValue("--line-2").trim(); g.lineWidth = 1; g.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
    // the camera's frame: what the video will show
    const cam = p.layers.find((l) => l.camera && l.visible);
    if (cam && !camView.value) {
      const m = S.world.get(cam.id)!, pts = [[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]].map(([x, y]) => screenOf(m, x, y));
      g.save(); g.strokeStyle = "#ff5a3c"; g.lineWidth = 2; g.setLineDash([10, 6]);
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
      g.setLineDash([]); g.fillStyle = "#ff5a3c"; g.font = "600 12px Anuphan, sans-serif"; g.fillText("CAM", pts[0][0] + 6, pts[0][1] + 16);
      g.restore();
    }

    if (tool.value === "pose") {
      // the skeleton: a line from each joint to the joint of the part it follows
      g.save(); g.lineCap = "round";
      for (const l of p.layers) {
        if (!l.visible || !l.parent) continue;
        const par = p.layers.find((x) => x.id === l.parent); if (!par || !par.visible) continue;
        const [x, y] = screenOf(S.world.get(l.id)!, l.px, l.py), [qx, qy] = screenOf(S.world.get(par.id)!, par.px, par.py);
        g.strokeStyle = "rgba(20,24,33,.55)"; g.lineWidth = 5; g.beginPath(); g.moveTo(qx, qy); g.lineTo(x, y); g.stroke();
        g.strokeStyle = l.id === selected.value || par.id === selected.value ? accent : "rgba(255,255,255,.9)"; g.lineWidth = 2.5; g.stroke();
      }
      for (const l of p.layers) {
        if (!l.visible) continue;
        const [x, y] = screenOf(S.world.get(l.id)!, l.px, l.py);
        g.fillStyle = l.id === selected.value ? accent : "#fff"; g.strokeStyle = "rgba(20,24,33,.8)"; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      g.restore();
      return;
    }
    if (tool.value === "pin") {
      const l = p.layers.find((x) => x.id === selected.value);
      if (l && l.visible) {
        const h = handlesOf(p, l, S);
        if (h) { g.save(); g.setLineDash([4, 4]); g.strokeStyle = accent; g.lineWidth = 1; g.globalAlpha = .7; g.beginPath(); h.corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); g.restore(); }
        for (const q of pinsOf(l, S)) {
          const moved = Math.hypot(q.dst[0] - q.rest[0], q.dst[1] - q.rest[1]) > 0.5;
          g.fillStyle = moved ? accent : "#ffcf33"; g.strokeStyle = "rgba(20,24,33,.85)"; g.lineWidth = 2;
          g.beginPath(); g.arc(q.scr[0], q.scr[1], 7, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = "rgba(20,24,33,.85)"; g.beginPath(); g.arc(q.scr[0], q.scr[1], 2, 0, Math.PI * 2); g.fill();
        }
      }
      return;
    }
    if (tool.value === "pivot") {
      for (const l of p.layers) {
        if (!l.visible || l.id === selected.value) continue;
        const [x, y] = screenOf(S.world.get(l.id)!, l.px, l.py);
        g.fillStyle = "rgba(255,255,255,.9)"; g.strokeStyle = "rgba(20,24,33,.7)"; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
    const l = p.layers.find((x) => x.id === selected.value);
    if (!l || !l.visible) return;
    drawPath(g, p, l, accent);
    const h = handlesOf(p, l, S); if (!h) return;
    // link to the part it follows
    if (l.parent) {
      const par = p.layers.find((x) => x.id === l.parent);
      if (par) {
        const [qx, qy] = screenOf(S.world.get(par.id)!, par.px, par.py);
        g.save(); g.setLineDash([5, 4]); g.strokeStyle = accent; g.lineWidth = 1.5; g.globalAlpha = .8;
        g.beginPath(); g.moveTo(h.piv[0], h.piv[1]); g.lineTo(qx, qy); g.stroke(); g.restore();
        g.fillStyle = accent; g.beginPath(); g.arc(qx, qy, 4, 0, Math.PI * 2); g.fill();
      }
    }
    g.strokeStyle = accent; g.lineWidth = 1.5;
    g.beginPath(); h.corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
    if (!l.locked && tool.value !== "pivot") {
      g.beginPath(); g.moveTo(h.topMid[0], h.topMid[1]); g.lineTo(h.rot[0], h.rot[1]); g.stroke();
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(h.rot[0], h.rot[1], 6, 0, Math.PI * 2); g.fill(); g.stroke();
      for (const [x, y] of h.corners) { g.fillRect(x - 5, y - 5, 10, 10); g.strokeRect(x - 5, y - 5, 10, 10); }
    }
    // pivot (joint)
    const big = tool.value === "pivot";
    g.lineWidth = 2; g.strokeStyle = big ? accent : "#fff"; g.fillStyle = big ? "#fff" : accent;
    g.beginPath(); g.arc(h.piv[0], h.piv[1], big ? 8 : 5, 0, Math.PI * 2); g.fill(); g.stroke();
    if (big) { g.beginPath(); g.moveTo(h.piv[0] - 14, h.piv[1]); g.lineTo(h.piv[0] + 14, h.piv[1]); g.moveTo(h.piv[0], h.piv[1] - 14); g.lineTo(h.piv[0], h.piv[1] + 14); g.stroke(); }
  }

  // ---------- picking ----------
  function pickLayer(x: number, y: number): Layer | null {
    const p = project.value!, S = st.current.solved; if (!S) return null;
    const [cx, cy] = toComp(x, y);
    for (let i = p.layers.length - 1; i >= 0; i--) {
      const l = p.layers[i]; if (!l.visible || l.locked || !l.asset) continue;
      const a = p.assets.find((q) => q.id === l.asset); if (!a) continue;
      const [lx, ly] = apply(invert(S.world.get(l.id)!), cx, cy);
      if (hitAsset(a.id, a.w, a.h, lx, ly)) return l;
    }
    return null;
  }
  const near = (a: [number, number], x: number, y: number, r = HANDLE) => Math.hypot(a[0] - x, a[1] - y) <= r;

  function startDrag(x: number, y: number, e: PointerEvent) {
    const s = st.current, p = project.value!;
    let S = (s.solved = solveShown(p, frame.value, camView.value)), cur = tool.value as Tool; // fresh: the last paint may be behind
    if (cur === "hand" || e.button === 1 || s.space) { s.drag = { k: "pan", sx: x, sy: y, ox: s.ox, oy: s.oy }; return; }
    const sel = p.layers.find((l) => l.id === selected.value);
    if (sketchArm.value && sel && !sel.locked && mode.value === "animate") return sketchDown(sel, x, y);
    // a key square on the motion path: go to that frame and move the part there
    if (sel && sel.visible && !sel.locked && (cur === "move" || cur === "rotate")) {
      const kf = pathKeyAt(p, sel, x, y);
      if (kf !== null) {
        playing.value = false; frame.value = kf; S = s.solved = solveShown(p, kf, camView.value);
        const pose = S.pose.get(sel.id)!;
        begin(); s.drag = { k: "move", id: sel.id, p0: toComp(x, y), x0: pose.x, y0: pose.y, inv: invert(lin(parentWorld(sel, S))) };
        return;
      }
    }
    if (sel?.camera && !sel.locked) return camDown(sel, x, y);
    if (cur === "pin") return pinDown(sel, x, y, e);
    if (sel && sel.visible && !sel.locked) {
      const h = handlesOf(p, sel, S);
      if (h && cur === "pivot" && near(h.piv, x, y)) { begin(); s.drag = { k: "pivot", id: sel.id, inv: invert(S.world.get(sel.id)!) }; return; }
      if (h && cur !== "pivot") {
        if (near(h.rot, x, y)) return beginRotate(sel, x, y);
        const ci = h.corners.findIndex((c) => near(c, x, y, HANDLE - 4));
        if (ci >= 0) {
          const pv = h.piv, useP = Math.hypot(h.corners[ci][0] - pv[0], h.corners[ci][1] - pv[1]) > 12;
          const ref = useP ? pv : h.center, pose = S.pose.get(sel.id)!;
          begin(); s.drag = { k: "scale", id: sel.id, ref: toComp(...ref), d0: Math.max(1e-6, Math.hypot(...sub(toComp(x, y), toComp(...ref)))), sx0: pose.sx, sy0: pose.sy };
          return;
        }
      }
    }
    const hit = pickLayer(x, y);
    if (!hit) { selected.value = null; s.drag = { k: "pan", sx: x, sy: y, ox: s.ox, oy: s.oy }; return; }
    selected.value = hit.id;
    if (cur === "rotate") return beginRotate(hit, x, y);
    if (cur === "pose" && hit.parent) return beginPose(hit, x, y);
    if (cur === "pivot") {
      begin(); const inv = invert(S.world.get(hit.id)!); s.drag = { k: "pivot", id: hit.id, inv };
      const [lx, ly] = apply(inv, ...toComp(x, y)); movePivotLive(hit.id, lx, ly); return;
    }
    const pose = S.pose.get(hit.id)!, inv = invert(lin(parentWorld(hit, S)));
    begin(); s.drag = { k: "move", id: hit.id, p0: toComp(x, y), x0: pose.x, y0: pose.y, inv };
  }
  /**
   * The camera is selected: its corner handles zoom, the round handle turns it, and dragging anywhere
   * inside its frame moves it. Looking through the camera, the picture follows the pointer instead.
   */
  function camDown(cam: Layer, x: number, y: number) {
    const s = st.current, p = project.value!, S = s.solved!, h = handlesOf(p, cam, S)!, through = camView.value;
    const pose = S.pose.get(cam.id)!;
    if (near(h.rot, x, y)) { beginRotate(cam, x, y); if (s.drag?.k === "rotate") s.drag.sign = through ? -1 : 1; return; }
    const ci = h.corners.findIndex((c) => near(c, x, y, HANDLE - 4));
    if (ci >= 0) {
      begin(); s.drag = { k: "scale", id: cam.id, ref: toComp(...h.center), d0: Math.max(1e-6, Math.hypot(...sub(toComp(x, y), toComp(...h.center)))), sx0: pose.sx, sy0: pose.sy, cam: !through };
      return;
    }
    const [cx, cy] = toComp(x, y), inside = (() => {
      const q = apply(invert(S.world.get(cam.id)!), cx, cy); return q[0] >= 0 && q[1] >= 0 && q[0] <= p.w && q[1] <= p.h;
    })();
    if (!inside) { selected.value = null; s.drag = { k: "pan", sx: x, sy: y, ox: s.ox, oy: s.oy }; return; }
    // looking through it: drag the picture (the camera goes the other way, slower when zoomed in)
    const r = (pose.rot * Math.PI) / 180, z = Math.max(0.01, pose.sx);
    const inv: Mat = through ? [-Math.cos(r) / z, -Math.sin(r) / z, Math.sin(r) / z, -Math.cos(r) / z, 0, 0] : [1, 0, 0, 1, 0, 0];
    begin(); s.drag = { k: "move", id: cam.id, p0: [cx, cy], x0: pose.x, y0: pose.y, inv, cam: 1 };
  }
  /** Pin tool: press a pin to drag it (Alt / right button removes it); press the picture to add a pin. */
  function pinDown(sel: Layer | undefined, x: number, y: number, e: PointerEvent) {
    const s = st.current, S = s.solved!;
    if (sel && sel.visible && !sel.locked) {
      const hitPin = pinsOf(sel, S).find((q) => near(q.scr, x, y, 12));
      if (hitPin) {
        if (e.altKey || e.button === 2) { removePin(sel.id, hitPin.id); return; }
        begin(); s.drag = { k: "pin", id: sel.id, pin: hitPin.id, inv: invert(S.world.get(sel.id)!), rx: hitPin.rest[0], ry: hitPin.rest[1] };
        return;
      }
    }
    const hit = pickLayer(x, y);
    if (!hit) { selected.value = null; s.drag = { k: "pan", sx: x, sy: y, ox: s.ox, oy: s.oy }; return; }
    if (hit.id !== selected.value) { selected.value = hit.id; return; } // first press picks the part
    const at = apply(invert(S.world.get(hit.id)!), ...toComp(x, y)) as P;
    const now = pinsOf(hit, S);
    const rest = unpinPoint(now.map((q) => q.rest), now.map((q) => q.dst), at);
    const id = uid();
    edit((pp) => {
      const l = pp.layers.find((q) => q.id === hit.id); if (!l) return;
      (l.pins ??= []).push({ id, x: round2(rest[0]), y: round2(rest[1]) });
      // an extra pin holds the picture where it is now, at every frame
      l.base[pinChan(id, "x")] = round2(at[0] - rest[0]); l.base[pinChan(id, "y")] = round2(at[1] - rest[1]);
    });
  }
  function removePin(id: string, pin: string) {
    edit((pp) => {
      const l = pp.layers.find((q) => q.id === id); if (!l?.pins) return;
      l.pins = l.pins.filter((q) => q.id !== pin); if (!l.pins.length) delete l.pins;
      for (const ax of ["x", "y"] as const) { delete l.tracks[pinChan(pin, ax)]; delete l.base[pinChan(pin, ax)]; }
    });
  }
  function beginRotate(l: Layer, x: number, y: number) {
    const s = st.current, S = s.solved!, m = S.world.get(l.id)!;
    const c = apply(m, l.px, l.py), pt = toComp(x, y), parentM = l.parent ? S.world.get(l.parent) : null;
    const sign = parentM && parentM[0] * parentM[3] - parentM[1] * parentM[2] < 0 ? -1 : 1;
    begin(); s.drag = { k: "rotate", id: l.id, c, last: Math.atan2(pt[1] - c[1], pt[0] - c[0]), acc: 0, r0: ownRot(l, S), sign };
  }
  /** Pose: hold a part; it turns round its joint, and when the part above it is not the root (the body),
   *  that one turns too, so pulling a forearm bends the elbow and swings the upper arm. */
  function beginPose(l: Layer, x: number, y: number) {
    const s = st.current, S = s.solved!, p = project.value!;
    const byId = (id: string | null) => (id ? p.layers.find((q) => q.id === id) ?? null : null);
    const mirror = (id: string | null) => { const m = id ? S.world.get(id) : null; return m && m[0] * m[3] - m[1] * m[2] < 0 ? -1 : 1; };
    const par = byId(l.parent), two = !!par && !!par.parent && !par.locked;
    const pivotOf = (q: Layer) => apply(S.world.get(q.id)!, q.px, q.py);
    const chain = two ? [l, par!] : [l];
    begin();
    s.drag = {
      k: "ik", ids: chain.map((q) => q.id), r0: chain.map((q) => ownRot(q, S)), sign: chain.map((q) => mirror(q.parent)),
      j1: two ? pivotOf(par!) : pivotOf(l), j2: two ? pivotOf(l) : null, e0: toComp(x, y),
    };
  }
  /**
   * Motion sketch: hold and drag; time runs at the real speed from the current frame and the part follows
   * the pointer. Letting go keeps a key every few frames on a smooth curve.
   */
  function sketchDown(l: Layer, x: number, y: number) {
    const s = st.current, f0 = frame.value;
    playing.value = false; begin();
    const d: Drag = { k: "sketch", id: l.id, f0, t0: performance.now(), last: f0 - 1, at: toComp(x, y), trail: [], raf: 0 };
    s.drag = d;
    // clear what was there from here on, so the old path does not pull on the new one
    live((p) => {
      const q = p.layers.find((z) => z.id === l.id); if (!q) return;
      for (const ch of ["x", "y"] as const) if (q.tracks[ch]) q.tracks[ch] = q.tracks[ch]!.filter((k) => k.f < f0);
    });
    const tick = () => {
      if (s.drag !== d) return;
      const p = project.value!, f = Math.min(p.frames - 1, d.f0 + Math.floor(((performance.now() - d.t0) / 1000) * p.fps));
      if (f > d.last) {
        live((pp) => {
          const q = pp.layers.find((z) => z.id === d.id); if (!q) return;
          for (let g = d.last + 1; g <= f; g++) {
            // the pointer is in the composition; keys are in the parent's space at that frame
            const par = q.parent || (camView.value && cameraOf(pp)) ? parentWorld(q, solveShown(pp, g, camView.value), g) : null;
            const [lx, ly] = par ? apply(invert(par), ...d.at) : d.at;
            writeKey(q, "x", round2(lx), g, "linear"); writeKey(q, "y", round2(ly), g, "linear");
          }
        });
        d.last = f; frame.value = f; d.trail.push(d.at);
      }
      if (f >= p.frames - 1) { endDrag(); return; }
      d.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function endSketch(d: Extract<Drag, { k: "sketch" }>) {
    cancelAnimationFrame(d.raf);
    live((p) => {
      const q = p.layers.find((z) => z.id === d.id); if (!q) return;
      // keep a key every 3 frames (and the last one), on a curve through them
      const keep = (k: { f: number }) => k.f < d.f0 || k.f > d.last || (k.f - d.f0) % 3 === 0 || k.f === d.last;
      for (const ch of ["x", "y"] as const) if (q.tracks[ch]) q.tracks[ch] = q.tracks[ch]!.filter(keep);
      if (d.last > d.f0) q.path = { ...q.path, curve: true };
    });
    sketchArm.value = false;
    finish();
  }
  function moveDrag(x: number, y: number, e: PointerEvent) {
    const s = st.current, d = s.drag; if (!d) return;
    if (d.k === "sketch") { d.at = toComp(x, y); return; }
    if (d.k === "pan") { s.auto = false; s.ox = d.ox + x - d.sx; s.oy = d.oy + y - d.sy; schedule(); return; }
    const [cx, cy] = toComp(x, y);
    live((p) => {
      const l = p.layers.find((q) => q.id === (d.k === "ik" ? d.ids[0] : d.id)); if (!l) return;
      if (d.k === "pin") {
        const [lx, ly] = apply(d.inv, cx, cy);
        writeProp(l, pinChan(d.pin, "x"), round2(lx - d.rx)); writeProp(l, pinChan(d.pin, "y"), round2(ly - d.ry));
      } else if (d.k === "move") {
        const [dx, dy] = apply(d.inv, cx - d.p0[0], cy - d.p0[1]);
        writeProp(l, "x", round2(d.x0 + dx)); writeProp(l, "y", round2(d.y0 + dy));
      } else if (d.k === "rotate") {
        const a = Math.atan2(cy - d.c[1], cx - d.c[0]);
        let da = a - d.last; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        d.acc += da; d.last = a;
        let r = d.r0 + (d.sign * d.acc * 180) / Math.PI;
        if (e.shiftKey) r = Math.round(r / 15) * 15;
        writeProp(l, "rot", round2(r));
      } else if (d.k === "ik") {
        const { d1, d2 } = pull(d.j1, d.j2, d.e0, [cx, cy]), deg = 180 / Math.PI;
        if (d.ids.length === 1) writeProp(l, "rot", round2(d.r0[0] + d.sign[0] * d1 * deg));
        else {
          const up = p.layers.find((q) => q.id === d.ids[1]);
          if (up) writeProp(up, "rot", round2(d.r0[1] + d.sign[1] * d1 * deg));
          writeProp(l, "rot", round2(d.r0[0] + d.sign[0] * (d2 - d1) * deg));
        }
      } else if (d.k === "scale") {
        let k = Math.hypot(cx - d.ref[0], cy - d.ref[1]) / d.d0;
        if (d.cam) k = 1 / Math.max(1e-3, k); // a bigger camera frame sees more: zoom out
        writeProp(l, "sx", round3(d.sx0 * k)); writeProp(l, "sy", round3(d.sy0 * k));
      }
    });
    if (d.k === "pivot") { const [lx, ly] = apply(d.inv, cx, cy); movePivotLive(d.id, round2(lx), round2(ly)); }
  }
  function endDrag() {
    const s = st.current, d = s.drag; s.drag = null;
    if (d?.k === "sketch") { endSketch(d); return; }
    if (d && d.k !== "pan") finish();
  }

  useEffect(() => {
    const s = st.current, w = wrap.current!, o = ov.current!;
    const ro = new ResizeObserver(() => {
      if (!cv.current) return; // already closed
      const r = w.getBoundingClientRect();
      s.dpr = Math.min(2, window.devicePixelRatio || 1); s.w = r.width; s.h = r.height;
      for (const c of [cv.current!, o]) { c.width = Math.round(r.width * s.dpr); c.height = Math.round(r.height * s.dpr); }
      if ((!s.fitted || s.auto) && project.value) { s.fitted = true; fit(); } else schedule(); // keep fitting until the user zooms or pans
    });
    ro.observe(w);
    const stop = effect(() => { rev.value; frame.value; selected.value; tool.value; mode.value; theme.value; onion.value; camView.value; showPath.value; schedule(); });
    let lastPid = project.value?.id;
    const stopFit = effect(() => { const id = project.value?.id; if (id !== lastPid) { lastPid = id; s.fitted = false; if (s.w) { s.fitted = true; fit(); } } });
    onAssetsChanged(schedule);

    const pos = (e: PointerEvent | WheelEvent): [number, number] => { const r = o.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e: PointerEvent) => {
      if (!project.value) return;
      o.setPointerCapture(e.pointerId);
      s.pointers.set(e.pointerId, pos(e));
      if (s.pointers.size === 2) {
        if (s.drag) endDrag();
        const [a, b] = [...s.pointers.values()];
        s.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, z: s.z, ox: s.ox, oy: s.oy };
        return;
      }
      if (s.pointers.size > 2) return;
      const [x, y] = pos(e); startDrag(x, y, e);
    };
    const move = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return;
      s.pointers.set(e.pointerId, pos(e));
      if (s.pinch && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()], P = s.pinch;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const nz = Math.min(16, Math.max(0.02, P.z * (d / P.d)));
        s.auto = false; s.ox = mx - (P.mx - P.ox) * (nz / P.z); s.oy = my - (P.my - P.oy) * (nz / P.z); s.z = nz;
        setZoomPct(Math.round(nz * 100)); schedule(); return;
      }
      const [x, y] = pos(e); moveDrag(x, y, e);
    };
    const up = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId);
      if (s.pinch) { if (s.pointers.size < 2) s.pinch = null; return; }
      endDrag();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const [x, y] = pos(e);
      const mouseWheel = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0);
      if (e.ctrlKey || e.metaKey || mouseWheel) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), x, y);
      else { s.auto = false; s.ox -= e.deltaX; s.oy -= e.deltaY; schedule(); }
    };
    const dbl = (e: MouseEvent) => {
      const r = o.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (tool.value === "pin") {
        const p = project.value, sel = p?.layers.find((l) => l.id === selected.value);
        const q = sel && s.solved ? pinsOf(sel, s.solved).find((z) => near(z.scr, x, y, 12)) : undefined;
        if (q && sel) { removePin(sel.id, q.id); return; }
      }
      if (!pickLayer(x, y)) fit();
    };
    const ctx = (e: MouseEvent) => { if (tool.value === "pin") e.preventDefault(); };
    o.addEventListener("contextmenu", ctx);
    const key = (e: KeyboardEvent) => { if (e.code === "Space" && !(e.target as HTMLElement)?.closest?.("input, textarea, select")) s.space = e.type === "keydown"; };
    o.addEventListener("pointerdown", down); o.addEventListener("pointermove", move);
    o.addEventListener("pointerup", up); o.addEventListener("pointercancel", up);
    o.addEventListener("wheel", wheel, { passive: false }); o.addEventListener("dblclick", dbl);
    window.addEventListener("keydown", key); window.addEventListener("keyup", key);
    (window as Window & { __tstFit?: () => void }).__tstFit = fit;
    if (import.meta.env.DEV) (window as Window & { __tstView?: () => Mat }).__tstView = view; // for in-browser tests
    return () => { ro.disconnect(); stop(); stopFit(); window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); };
  }, []);

  const p = project.value;
  rev.value;
  const empty = !!p && p.layers.length === 0;
  const setBg = (bg: Background) => { if (p && p.bg !== bg) { begin(); live((pp) => (pp.bg = bg)); finish(); } };
  const tools: Array<[Tool, string, string]> = [["move", "move", t("t_move")], ["rotate", "rotate", t("t_rotate")], ["pose", "figure", t("t_pose")], ["pin", "pin", t("t_pin")], ["pivot", "pivot", t("t_pivot")], ["hand", "hand", t("t_hand")]];
  const cursor = sketchArm.value ? "crosshair" : tool.value === "hand" ? "grab" : tool.value === "pivot" || tool.value === "pin" ? "crosshair" : "default";

  return (
    <section class="stage" ref={wrap} aria-label="Canvas">
      <canvas ref={cv} />
      <canvas ref={ov} style={{ cursor }} />
      <div class="tipbar">
        <div class={"tip" + (sketchArm.value ? " hot" : "")}>{sketchArm.value ? t("tip_sketch") : t(("tip_" + tool.value) as "tip_move")}</div>
        <div class="zoombox">
          <button class="ibtn ghost" title="-" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, st.current.w / 2, st.current.h / 2)}><Icon n="minus" /></button>
          <span class="num">{zoomPct}%</span>
          <button class="ibtn ghost" title="+" aria-label="Zoom in" onClick={() => zoomAt(1.25, st.current.w / 2, st.current.h / 2)}><Icon n="plus" /></button>
          <button class="ibtn ghost" title={t("fit")} aria-label={t("fit")} onClick={fit}><Icon n="fit" /></button>
        </div>
      </div>
      {empty && (
        <div class="stage-empty"><div>
          <b>{t("empty_title")}</b>
          <p>{t("empty_body")}</p>
          <button class="btn primary" onClick={onImport}><Icon n="import" />{t("import")}</button>
        </div></div>
      )}
      {dropping && <div class="dropmask">{t("drop_here")}</div>}
      <div class="dock" role="toolbar" aria-label="Tools">
        {tools.map(([id, ic, label]) => (
          <button class="tool" aria-pressed={tool.value === id} title={label} onClick={() => (tool.value = id)}><Icon n={ic} /><span>{label}</span></button>
        ))}
        {p?.layers.some((l) => l.camera) && <>
          <i class="sep" />
          <button class="tool" aria-pressed={camView.value} title={t("cam_view_tip")} onClick={() => (camView.value = !camView.value)}><Icon n="camera" /><span>{t("cam_view")}</span></button>
        </>}
        <i class="sep" />
        {(["alpha", "green", "white"] as Background[]).map((bg) => (
          <button class={"bgsw" + (bg === "alpha" ? " alpha" : "")} style={bg === "green" ? { background: "#00b140" } : bg === "white" ? { background: "#fff" } : undefined} aria-pressed={p?.bg === bg} aria-label={t(("bg_" + bg) as "bg_alpha")} title={t(("bg_" + bg) as "bg_alpha")} onClick={() => setBg(bg)} />
        ))}
      </div>
    </section>
  );
}

const sub = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];
const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const lin = (m: Mat): Mat => [m[0], m[1], m[2], m[3], 0, 0];
