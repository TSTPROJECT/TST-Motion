// Time ruler, one row per part with its keyframes, play controls.
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { project, rev, frame, playing, loop, selected, mode, edit, moveKeys, onion, advanced } from "../model/store";
import { keyFrames } from "../model/anim";
import { t } from "../i18n";
import { Icon } from "./icons";

const PAD = 10; // room so a key on frame 0 is not cut off
const fmt = (f: number, fps: number) => {
  const s = Math.floor(f / fps), ff = f - s * fps;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(ff).padStart(2, "0")}`;
};

export function Timeline() {
  rev.value;
  const p = project.value;
  const scroller = useRef<HTMLDivElement>(null);
  const [ppf, setPpf] = useState(0); // pixels per frame; 0 = fit the width
  const [trackW, setTrackW] = useState(600);
  const keyDrag = useRef<{ id: string; from: number; at: number; x0: number; moved: boolean } | null>(null);
  const [dragShow, setDragShow] = useState<{ id: string; from: number; at: number } | null>(null);
  const f = frame.value, total = p?.frames ?? 1;
  const fitPpf = trackW / Math.max(1, total);
  const scale = ppf || fitPpf;

  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const lw = parseFloat(getComputedStyle(el).getPropertyValue("--lw")) || 150;
      setTrackW(Math.max(120, el.clientWidth - lw - 14 - PAD));
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  // keep the playhead in view while playing
  useEffect(() => {
    const el = scroller.current; if (!el || !playing.value) return;
    const lwv = parseFloat(getComputedStyle(el).getPropertyValue("--lw")) || 150;
    const x = PAD + f * scale, left = el.scrollLeft, vis = el.clientWidth - lwv;
    if (x < left || x > left + vis - 20) el.scrollLeft = Math.max(0, x - 40);
  });

  if (!p) return null;
  const width = Math.max(trackW, total * scale);
  const lw = () => parseFloat(getComputedStyle(scroller.current!).getPropertyValue("--lw")) || 150;
  const xToFrame = (clientX: number) => {
    const el = scroller.current!, r = el.getBoundingClientRect();
    const x = clientX - r.left + el.scrollLeft - lw() - PAD;
    return Math.max(0, Math.min(total - 1, Math.round(x / scale)));
  };

  const scrub = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(".kf, .lab")) return;
    playing.value = false;
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    frame.value = xToFrame(e.clientX);
    const mv = (ev: PointerEvent) => (frame.value = xToFrame(ev.clientX));
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };

  // ruler ticks: choose a step that leaves room for labels
  const sec = p.fps, minPx = 56;
  const steps = [1, 2, 5, 10, 15, 30].map((k) => k).concat([1, 2, 5, 10, 15, 30, 60].map((k) => k * sec));
  const labelStep = steps.find((s) => s * scale >= minPx) ?? total;
  const minorStep = [1, 2, 5, 10, 15, 30, sec].find((s) => s * scale >= 10) ?? labelStep;
  const ticks: JSX.Element[] = [];
  for (let i = 0; i < total; i += minorStep) {
    const major = i % labelStep === 0;
    ticks.push(<span class={"tick" + (major ? "" : " minor")} style={{ left: `${PAD + i * scale}px` }}>{major ? (i % sec === 0 ? `${i / sec}s` : `${i}f`) : ""}</span>);
  }
  const layers = [...p.layers].reverse();

  return (
    <section class="card tl" aria-label={t("timeline")}>
      <div class="tl-h">
        <button class="ibtn ghost" title={t("to_start")} aria-label={t("to_start")} onClick={() => { playing.value = false; frame.value = 0; }}><Icon n="start" /></button>
        <button class="ibtn ghost" title={t("prev_frame")} aria-label={t("prev_frame")} onClick={() => { playing.value = false; frame.value = Math.max(0, f - 1); }}><Icon n="prev" /></button>
        <button class="play" title={playing.value ? t("pause") : t("play")} aria-label={playing.value ? t("pause") : t("play")} onClick={() => (playing.value = !playing.value)}>
          <svg viewBox="0 0 24 24">{playing.value ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4.5v15l13-7.5z" />}</svg>
        </button>
        <button class="ibtn ghost" title={t("next_frame")} aria-label={t("next_frame")} onClick={() => { playing.value = false; frame.value = Math.min(total - 1, f + 1); }}><Icon n="next" /></button>
        <button class={"ibtn ghost" + (loop.value ? " on" : "")} title={t("loop")} aria-label={t("loop")} aria-pressed={loop.value} onClick={() => (loop.value = !loop.value)}><Icon n="loop" /></button>
        <button class={"ibtn ghost" + (onion.value.on ? " on" : "")} title={t("onion_tip")} aria-label={t("onion")} aria-pressed={onion.value.on} onClick={() => (onion.value = { ...onion.value, on: !onion.value.on })}><Icon n="onion" /></button>
        {onion.value.on && advanced.value && (
          <span class="onionset" title={t("onion_set_tip")}>
            <label>{t("onion_before")}<input class="field num" type="number" min={0} max={5} value={onion.value.before} onChange={(e) => (onion.value = { ...onion.value, before: Math.max(0, Math.min(5, +(e.target as HTMLInputElement).value || 0)) })} /></label>
            <label>{t("onion_after")}<input class="field num" type="number" min={0} max={5} value={onion.value.after} onChange={(e) => (onion.value = { ...onion.value, after: Math.max(0, Math.min(5, +(e.target as HTMLInputElement).value || 0)) })} /></label>
            <label>{t("onion_step")}<input class="field num" type="number" min={1} max={30} value={onion.value.step} onChange={(e) => (onion.value = { ...onion.value, step: Math.max(1, Math.min(30, +(e.target as HTMLInputElement).value || 1)) })} /></label>
          </span>
        )}
        <span class="tc num">{fmt(f, p.fps)} <span>/ {fmt(total, p.fps)}</span></span>
        <div class="tl-right">
          <span class="lbl num">{t("frame_n", { n: f })} · {p.fps} fps</span>
          <input type="range" aria-label={t("zoom_tl")} title={t("zoom_tl")} min={0} max={100} value={ppf ? Math.round(Math.log(ppf / fitPpf) / Math.log(40 / fitPpf) * 100) : 0}
            onInput={(e) => { const k = +(e.target as HTMLInputElement).value / 100; setPpf(k <= 0 ? 0 : fitPpf * Math.pow(Math.max(1.0001, 40 / fitPpf), k)); }} />
        </div>
      </div>
      <div class={"tl-scroll" + (mode.value === "setup" ? " setup-veil" : "")} ref={scroller}>
        <div class="tl-inner" style={{ width: `calc(var(--lw) + ${width + 14 + PAD}px)` }}>
          <div class="row ruler"><div class="lab" /><div class="trk" onPointerDown={scrub as never}>{ticks}<span class="endzone" style={{ left: `${PAD + total * scale}px` }} /></div></div>
          {layers.length === 0 && <div class="tl-empty">{t("empty_title")}</div>}
          {layers.map((l) => (
            <div class={"row" + (l.id === selected.value ? " sel" : "")} key={l.id}>
              <div class="lab" title={l.name} onClick={() => (selected.value = l.id)}>{l.name}</div>
              <div class="trk" onPointerDown={(e) => { selected.value = l.id; scrub(e as unknown as PointerEvent); }}>
                {keyFrames(l).map((kf) => {
                  const at = dragShow && dragShow.id === l.id && dragShow.from === kf ? dragShow.at : kf;
                  const drop = () => {
                    const d = keyDrag.current; keyDrag.current = null; setDragShow(null);
                    if (d?.moved && d.at !== d.from) { edit((pp) => { const x = pp.layers.find((q) => q.id === d.id); if (x) moveKeys(x, d.from, d.at); }); frame.value = d.at; }
                  };
                  return (
                    <button class={"kf" + (at === f ? " now" : "")} style={{ left: `${PAD + at * scale}px` }} aria-label={`${l.name} ${kf}`}
                      onPointerDown={(e) => {
                        e.stopPropagation(); playing.value = false; selected.value = l.id; frame.value = kf;
                        (e.target as HTMLElement).setPointerCapture(e.pointerId);
                        keyDrag.current = { id: l.id, from: kf, at: kf, x0: e.clientX, moved: false };
                      }}
                      onPointerMove={(e) => {
                        const d = keyDrag.current; if (!d) return;
                        if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
                        d.moved = true;
                        const to = xToFrame(e.clientX);
                        if (to !== d.at) { d.at = to; setDragShow({ id: d.id, from: d.from, at: to }); }
                      }}
                      onPointerUp={drop} onPointerCancel={drop}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <div class="playhead" style={{ left: `calc(var(--lw) + ${PAD + f * scale}px)` }} />
        </div>
      </div>
    </section>
  );
}
