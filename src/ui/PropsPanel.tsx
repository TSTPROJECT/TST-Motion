// Numbers for the selected part: position, rotation, size, opacity, pivot, parent, easing.
import { useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { project, rev, frame, selected, mode, tool, advanced, edit, begin, live, finish, writeProp, toggleKeys, toggleKeyProp, hasKeyAt, keyIndex, setEaseAt, easeAt, keyAt, setCurveLive, setParent, movePivotLive, renameLayer } from "../model/store";
import { valueAt, keyFrames, depthOf, bezier } from "../model/anim";
import { TURN_MAX, NOD_MAX } from "../model/warp";
import { pinChan, type Chan, type Ease, type Layer, type Prop } from "../model/types";
import { t, type Key as TKey } from "../i18n";
import { Icon } from "./icons";
import { toast } from "./shell";
import { getLoaded, importFiles, ACCEPT } from "../io/assets";
import { pickFile } from "./open";
import { SWAY_DEFAULT } from "../model/physics";
import { TextGroup } from "./TextGroup";

export function KeyDot({ l, pr }: { l: Layer; pr: Chan }) {
  const keys = l.tracks[pr];
  const state = !keys?.length ? "none" : keyIndex(keys, frame.value) >= 0 ? "on" : "";
  return <button class="kb" title={t("key_prop")} aria-label={t("key_prop")} onClick={() => toggleKeyProp(l.id, pr)}><i class={"dia " + state} /></button>;
}

/** Number box whose label can be dragged left/right to change the value. */
export function NumField({ label, value, step, digits, onLive, onCommit, suffix, keyDot }: {
  label: string; value: number; step: number; digits: number; suffix?: string;
  onLive: (v: number) => void; onCommit: (v: number) => void; keyDot?: ComponentChildren;
}) {
  const drag = useRef<{ x: number; v: number } | null>(null);
  const [text, setText] = useState<string | null>(null);
  const cancel = useRef(false), typed = useRef(false);
  const shown = text !== null && typed.current ? text : (+value.toFixed(digits)).toString(); // follow the frame until the user types
  return (
    <div class="nf">
      {keyDot ?? <span />}
      <label
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, v: value }; begin(); }}
        onPointerMove={(e) => { const d = drag.current; if (!d) return; onLive(+(d.v + (e.clientX - d.x) * step).toFixed(digits)); }}
        onPointerUp={() => { if (drag.current) { drag.current = null; finish(); } }}
        onPointerCancel={() => { if (drag.current) { drag.current = null; finish(); } }}
      >{label}</label>
      <input class="field" inputMode="decimal" aria-label={label} value={shown + (text === null && suffix ? suffix : "")}
        onFocus={(e) => { typed.current = false; setText((+value.toFixed(digits)).toString()); requestAnimationFrame(() => (e.target as HTMLInputElement).select()); }}
        onInput={(e) => { typed.current = true; setText((e.target as HTMLInputElement).value); }}
        onBlur={() => { const keep = typed.current && !cancel.current; cancel.current = typed.current = false; if (!keep) { setText(null); return; } const v = parseFloat((text ?? "").replace(",", ".")); setText(null); if (Number.isFinite(v) && v !== value) onCommit(v); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { cancel.current = true; (e.target as HTMLInputElement).blur(); }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const v = +(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1) * 10).toFixed(digits); onCommit(v); setText(v.toString()); }
        }} />
    </div>
  );
}

const EASE_LIST: Array<[Ease, string]> = [
  ["smooth", "M3 18C16 18 18 3 31 3"], ["linear", "M3 18 31 3"], ["out", "M3 18C8 5 16 3 31 3"],
  ["in", "M3 18C18 18 26 15 31 3"], ["back", "M3 18C12 18 13 -1 22 1.5 27 3 28 4 31 4"], ["hold", "M3 18H24V3H31"],
  ["curve", "M3 18C6 3 20 22 31 3"],
];
/** Curves the presets stand for, so the graph can start from the one in use. */
const AS_CURVE: Partial<Record<Ease, [number, number, number, number]>> = {
  smooth: [0.45, 0, 0.55, 1], linear: [0, 0, 1, 1], in: [0.55, 0, 1, 0.45], out: [0, 0.55, 0.45, 1], back: [0.34, 1.56, 0.64, 1],
};

export function PropsPanel() {
  rev.value;
  const p = project.value, l = p?.layers.find((x) => x.id === selected.value) ?? null;
  const [linked, setLinked] = useState(true);
  const f = frame.value;
  if (!p) return null;
  if (!l) return (
    <aside class="card pane pane-props" aria-label={t("props")}>
      <div class="pane-h"><h2>{t("props")}</h2><span class="muted num" style={{ fontSize: "11.5px" }}>{t("frame_n", { n: f })}</span></div>
      <div class="props"><p class="hint-s">{t("no_layer")}</p><p class="hint-s">{t("shortcuts")}</p></div>
    </aside>
  );
  const v = (pr: Prop) => valueAt(l, pr, f);
  const liveSet = (pr: Prop, val: number) => live((pp) => { const x = pp.layers.find((q) => q.id === l.id); if (x) writeProp(x, pr, val); });
  const commit = (pr: Prop, val: number) => edit((pp) => { const x = pp.layers.find((q) => q.id === l.id); if (x) writeProp(x, pr, val); });
  const scaleLive = (pr: "sx" | "sy", val: number) => live((pp) => {
    const x = pp.layers.find((q) => q.id === l.id); if (!x) return;
    if (linked) { const other = pr === "sx" ? "sy" : "sx", r = v(pr) ? val / v(pr) : 1; writeProp(x, other, +(v(other) * r).toFixed(3)); }
    writeProp(x, pr, val);
  });
  const scaleCommit = (pr: "sx" | "sy", val: number) => { begin(); scaleLive(pr, val); finish(); };
  const keyed = hasKeyAt(l, f), frames = keyFrames(l);
  const prev = [...frames].reverse().find((x) => x < f), next = frames.find((x) => x > f);
  const ease = easeAt(l, f);
  const others = p.layers.filter((x) => x.id !== l.id);
  const asset = p.assets.find((a) => a.id === l.asset);
  const kd = (pr: Chan) => (mode.value === "animate" ? <KeyDot l={l} pr={pr} /> : undefined);
  const adv = advanced.value;
  const head = l.parent ? p.layers.find((x) => x.id === l.parent) ?? null : null;
  const setOn = (fn: (x: Layer) => void, now = false) => (now ? edit : live)((pp) => { const x = pp.layers.find((q) => q.id === l.id); if (x) fn(x); });
  const chField = (label: string, ch: Chan, step: number, digits: number, suffix?: string) => (
    <NumField label={label} value={valueAt(l, ch, f)} step={step} digits={digits} suffix={suffix} keyDot={kd(ch)}
      onLive={(x) => setOn((q) => writeProp(q, ch, x))} onCommit={(x) => setOn((q) => writeProp(q, ch, x), true)} />
  );

  return (
    <aside class="card pane pane-props" aria-label={t("props")}>
      <div class="pane-h"><h2>{t("props")}</h2><span class="muted num" style={{ fontSize: "11.5px" }}>{t("frame_n", { n: f })}</span></div>
      <div class="scroll"><div class="props">
        <div class="who">
          <input class="field" value={l.name} aria-label={t("rename")} onChange={(e) => renameLayer(l.id, (e.target as HTMLInputElement).value)} />
          <label class="nf" style={{ gridTemplateColumns: "auto minmax(0,1fr)" }}>
            <span class="muted" style={{ fontSize: "12.5px" }}>{t("follows")}</span>
            <select class="select" value={l.parent ?? ""} onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value || null;
              if (!setParent(l.id, val)) { toast(t("cycle"), true); (e.target as HTMLSelectElement).value = l.parent ?? ""; }
            }}>
              <option value="">{t("follows_none")}</option>
              {others.map((o) => <option value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </div>

        {mode.value === "animate" && (
          <div class="knav">
            <button class="ibtn" title={t("key_prev")} aria-label={t("key_prev")} disabled={prev === undefined} onClick={() => prev !== undefined && (frame.value = prev)}><Icon n="left" /></button>
            <button class="kdia" onClick={() => toggleKeys(l.id)}><i class={"dia" + (keyed ? " on" : "")} />{keyed ? t("key_remove") : t("key_add")}</button>
            <button class="ibtn" title={t("key_next")} aria-label={t("key_next")} disabled={next === undefined} onClick={() => next !== undefined && (frame.value = next)}><Icon n="right" /></button>
          </div>
        )}

        {l.text && <TextGroup key={l.id} l={l} />}

        <div class="grp">
          <h3>{t("g_transform")}</h3>
          <NumField label={t("p_x")} value={v("x")} step={1} digits={1} keyDot={kd("x")} onLive={(x) => liveSet("x", x)} onCommit={(x) => commit("x", x)} />
          <NumField label={t("p_y")} value={v("y")} step={1} digits={1} keyDot={kd("y")} onLive={(x) => liveSet("y", x)} onCommit={(x) => commit("y", x)} />
          <NumField label={t("p_rot")} value={v("rot")} step={0.5} digits={1} suffix="°" keyDot={kd("rot")} onLive={(x) => liveSet("rot", x)} onCommit={(x) => commit("rot", x)} />
          <div style={{ position: "relative" }}>
            <NumField label={t("p_sx")} value={v("sx") * 100} step={0.5} digits={1} suffix="%" keyDot={kd("sx")} onLive={(x) => scaleLive("sx", x / 100)} onCommit={(x) => scaleCommit("sx", x / 100)} />
            <div style={{ height: "8px" }} />
            <NumField label={t("p_sy")} value={v("sy") * 100} step={0.5} digits={1} suffix="%" keyDot={kd("sy")} onLive={(x) => scaleLive("sy", x / 100)} onCommit={(x) => scaleCommit("sy", x / 100)} />
            <button class={"linkbtn" + (linked ? " on" : "")} style={{ position: "absolute", left: "64px", top: "25px" }} title={t("link_scale")} aria-label={t("link_scale")} aria-pressed={linked} onClick={() => setLinked(!linked)}><Icon n="link" size={16} /></button>
          </div>
          <NumField label={t("p_o")} value={v("o") * 100} step={0.5} digits={0} suffix="%" keyDot={kd("o")} onLive={(x) => liveSet("o", Math.max(0, Math.min(100, x)) / 100)} onCommit={(x) => commit("o", Math.max(0, Math.min(100, x)) / 100)} />
        </div>

        {mode.value === "animate" && (
          <div class="grp">
            <h3>{t("g_motion")}</h3>
            {ease === null ? <p class="hint-s">{t("ease_need_key")}</p> : <>
              <div class="eases">
                {EASE_LIST.map(([e, d]) => (
                  <button class="ease" aria-pressed={ease === e} onClick={() => setEaseAt(l.id, f, e, e === "curve" ? keyAt(l, f)?.c ?? AS_CURVE[ease] : undefined)}>
                    <svg viewBox="0 0 34 21"><path d={d} /></svg>{t(("e_" + e) as TKey)}
                  </button>
                ))}
              </div>
              {(ease === "curve" || (adv && ease !== "hold")) && next !== undefined && (
                <CurveEditor c={ease === "curve" ? keyAt(l, f)?.c ?? [0.42, 0, 0.58, 1] : AS_CURVE[ease] ?? [0.42, 0, 0.58, 1]}
                  onLive={(c) => setCurveLive(l.id, f, c)} />
              )}
              {(ease === "curve" || adv) && next === undefined && <p class="hint-s">{t("curve_need_next")}</p>}
            </>}
          </div>
        )}

        <div class="grp">
          <h3>{t("g_pivot")}{asset && <button onClick={() => { begin(); movePivotLive(l.id, asset.w / 2, asset.h / 2); finish(); }}>{t("center_pivot")}</button>}</h3>
          {adv && <NumField label={t("p_px")} value={l.px} step={1} digits={1} onLive={(x) => movePivotLive(l.id, x, l.py)} onCommit={(x) => { begin(); movePivotLive(l.id, x, l.py); finish(); }} />}
          {adv && <NumField label={t("p_py")} value={l.py} step={1} digits={1} onLive={(y) => movePivotLive(l.id, l.px, y)} onCommit={(y) => { begin(); movePivotLive(l.id, l.px, y); finish(); }} />}
        </div>
        {l.parent && (
          <div class="grp">
            <h3>{t("g_bend")}{!adv && <Toggle on={(l.bend ?? 0) > 0} label={t("g_bend")} onChange={(on) => setOn((q) => { if (on) q.bend = Math.round(Math.max(8, Math.min(asset?.w ?? 60, asset?.h ?? 60) * 0.35)); else delete q.bend; }, true)} />}</h3>
            {adv && <NumField label={t("p_bend")} value={l.bend ?? 0} step={1} digits={0} suffix=" px"
              onLive={(x) => setOn((q) => (q.bend = Math.max(0, Math.min(2000, Math.round(x)))))}
              onCommit={(x) => setOn((q) => (q.bend = Math.max(0, Math.min(2000, Math.round(x)))), true)} />}
            <p class="hint-s">{t("bend_hint")}</p>
          </div>
        )}
        {asset && !l.text && (
          <div class="grp">
            <h3>{t("g_swap")}{mode.value === "animate" && <KeyDot l={l} pr="swap" />}</h3>
            <div class="swaps">
              {[l.asset, ...(l.swaps ?? []), null].map((id, k) => {
                const idx = id === null ? -1 : k, now = Math.round(valueAt(l, "swap", f)) === idx || (idx === 0 && Math.round(valueAt(l, "swap", f)) > (l.swaps?.length ?? 0));
                const url = id ? getLoaded(id)?.url : undefined;
                return (
                  <div class={"sw" + (now ? " on" : "")}>
                    <button title={id === null ? t("swap_hide") : k === 0 ? t("swap_own") : t("swap_n", { n: k })} aria-pressed={now} onClick={() => setOn((q) => writeProp(q, "swap", idx), true)}>
                      {id === null ? <Icon n="eyeoff" /> : url ? <img src={url} alt="" /> : <span class="num">{k}</span>}
                    </button>
                    {adv && k > 0 && id !== null && <button class="x" title={t("swap_remove")} aria-label={t("swap_remove")} onClick={() => setOn((q) => {
                      q.swaps = (q.swaps ?? []).filter((_, i) => i !== k - 1);
                      const fix = (v: number) => (v === k ? 0 : v > k ? v - 1 : v);
                      if (q.base.swap !== undefined) q.base.swap = fix(q.base.swap);
                      q.tracks.swap?.forEach((key) => (key.v = fix(key.v)));
                      if (!q.swaps.length) delete q.swaps;
                    }, true)}>×</button>}
                  </div>
                );
              })}
              <button class="sw add" title={t("swap_add")} aria-label={t("swap_add")} onClick={async () => {
                const files = await pickFile(ACCEPT, true); const pp = project.value; if (!files.length || !pp) return;
                const r = await importFiles(files, pp);
                if (!r.assets.length) { toast(t("import_failed", { names: r.failed.join(", ") }), true); return; }
                edit((q) => { q.assets.push(...r.assets); const x = q.layers.find((z) => z.id === l.id); if (x) x.swaps = [...(x.swaps ?? []), ...r.assets.map((a) => a.id)]; });
              }}><Icon n="plus" /></button>
            </div>
            <p class="hint-s">{t("swap_hint")}</p>
          </div>
        )}
        {asset && !l.text && (
          <div class="grp">
            <h3><span><Icon n="face" size={13} /> {t("g_face")}</span><Toggle on={!!l.face} label={t("g_face")} onChange={(on) => setOn((q) => {
              if (on) { q.face = { cx: asset.w / 2, cy: asset.h / 2, rx: Math.round(asset.w * 0.45), ry: Math.round(asset.h * 0.45) }; return; }
              delete q.face; for (const ch of ["turn", "nod"]) { delete q.tracks[ch]; delete q.base[ch]; }
            }, true)} /></h3>
            {l.face ? <>
              <TurnPad turn={valueAt(l, "turn", f)} nod={valueAt(l, "nod", f)}
                onLive={(a, b) => setOn((q) => { writeProp(q, "turn", a); writeProp(q, "nod", b); })} />
              {mode.value === "animate" && <div class="nf-row"><KeyDot l={l} pr="turn" /><span class="hint-s">{t("face_turn")}</span><KeyDot l={l} pr="nod" /><span class="hint-s">{t("face_nod")}</span></div>}
              {adv && <>
                {chField(t("face_turn"), "turn", 0.01, 2)}
                {chField(t("face_nod"), "nod", 0.01, 2)}
                <NumField label={t("face_rx")} value={l.face.rx} step={1} digits={0} suffix=" px" onLive={(x) => setOn((q) => { if (q.face) q.face.rx = Math.max(4, x); })} onCommit={(x) => setOn((q) => { if (q.face) q.face.rx = Math.max(4, x); }, true)} />
                <NumField label={t("face_ry")} value={l.face.ry} step={1} digits={0} suffix=" px" onLive={(x) => setOn((q) => { if (q.face) q.face.ry = Math.max(4, x); })} onCommit={(x) => setOn((q) => { if (q.face) q.face.ry = Math.max(4, x); }, true)} />
                <NumField label={t("face_cx")} value={l.face.cx} step={1} digits={0} onLive={(x) => setOn((q) => { if (q.face) q.face.cx = x; })} onCommit={(x) => setOn((q) => { if (q.face) q.face.cx = x; }, true)} />
                <NumField label={t("face_cy")} value={l.face.cy} step={1} digits={0} onLive={(x) => setOn((q) => { if (q.face) q.face.cy = x; })} onCommit={(x) => setOn((q) => { if (q.face) q.face.cy = x; }, true)} />
              </>}
              <p class="hint-s">{t("face_hint")}</p>
            </> : <p class="hint-s">{t("face_off")}</p>}
          </div>
        )}
        {head?.face && (
          <div class="grp">
            <h3>{t("g_depth")}</h3>
            <div class="seg depthseg">
              {([["depth_back", -0.18], ["depth_on", 0.18], ["depth_out", 0.45]] as Array<[TKey, number]>).map(([k, v]) => {
                const d = depthOf(p, l, head), want = v * head.face!.rx;
                return <button aria-pressed={Math.abs(d - want) < 0.5} onClick={() => setOn((q) => (q.depth = Math.round(want)), true)}>{t(k)}</button>;
              })}
            </div>
            {adv && <NumField label={t("p_depth")} value={depthOf(p, l, head)} step={1} digits={0} suffix=" px" onLive={(x) => setOn((q) => (q.depth = Math.round(x)))} onCommit={(x) => setOn((q) => (q.depth = Math.round(x)), true)} />}
            <p class="hint-s">{t("depth_hint")}</p>
          </div>
        )}
        <div class="grp">
          <h3><span><Icon n="wind" size={13} /> {t("g_sway")}</span><Toggle on={!!l.sway} label={t("g_sway")} onChange={(on) => setOn((q) => {
            if (!on) { delete q.sway; return; }
            q.sway = { ...SWAY_DEFAULT };
            // a soft joint makes the swing curve like real hair or cloth
            if (q.parent && !q.bend && asset) q.bend = Math.round(Math.max(8, Math.max(asset.w, asset.h) * 0.45));
          }, true)} /></h3>
          {l.sway ? <>
            <Range label={t("sway_amt")} value={l.sway.amt} min={0} max={2} onLive={(x) => setOn((q) => { if (q.sway) q.sway.amt = x; })} onCommit={(x) => setOn((q) => { if (q.sway) q.sway.amt = x; }, true)} />
            {adv && <Range label={t("sway_stiff")} value={l.sway.stiff} min={0} max={1} onLive={(x) => setOn((q) => { if (q.sway) q.sway.stiff = x; })} onCommit={(x) => setOn((q) => { if (q.sway) q.sway.stiff = x; }, true)} />}
            {adv && <Range label={t("sway_damp")} value={l.sway.damp} min={0} max={1} onLive={(x) => setOn((q) => { if (q.sway) q.sway.damp = x; })} onCommit={(x) => setOn((q) => { if (q.sway) q.sway.damp = x; }, true)} />}
            <Range label={t("sway_wind")} value={l.sway.wind} min={0} max={1} onLive={(x) => setOn((q) => { if (q.sway) q.sway.wind = x; })} onCommit={(x) => setOn((q) => { if (q.sway) q.sway.wind = x; }, true)} />
            <p class="hint-s">{l.parent ? t("sway_hint") : t("sway_need_parent")}</p>
          </> : <p class="hint-s">{t("sway_off")}</p>}
        </div>
        {(l.pins?.length || tool.value === "pin") && (
          <div class="grp">
            <h3>{t("g_pins")}{l.pins?.length ? <button onClick={() => setOn((q) => { for (const pn of q.pins ?? []) for (const ax of ["x", "y"] as const) { delete q.tracks[pinChan(pn.id, ax)]; delete q.base[pinChan(pn.id, ax)]; } delete q.pins; }, true)}>{t("pins_clear")}</button> : null}</h3>
            {!l.pins?.length ? <p class="hint-s">{t("pins_none")}</p> : <>
              <p class="hint-s">{t("pins_n", { n: l.pins.length })}</p>
              <button class="btn" onClick={() => setOn((q) => { for (const pn of q.pins ?? []) for (const ax of ["x", "y"] as const) writeProp(q, pinChan(pn.id, ax), 0); }, true)}>{t("pins_reset")}</button>
              {adv && l.pins.map((pn, i) => <>
                {chField(`#${i + 1} ↔`, pinChan(pn.id, "x"), 0.5, 1, " px")}
                {chField(`#${i + 1} ↕`, pinChan(pn.id, "y"), 0.5, 1, " px")}
              </>)}
            </>}
            {tool.value !== "pin" && <button class="btn" onClick={() => (tool.value = "pin")}><Icon n="pin" />{t("pin_tool_btn")}</button>}
          </div>
        )}
        <p class="hint-s">{mode.value === "setup" ? t("mode_setup_hint") : t("mode_animate_hint")}</p>
      </div></div>
    </aside>
  );
}

/** A small on/off switch. */
export function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return <button class={"tgl" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label} title={label} onClick={() => onChange(!on)}><i /></button>;
}

/** A slider for 0..max settings, shown as a percentage. */
export function Range({ label, value, min, max, onLive, onCommit }: { label: string; value: number; min: number; max: number; onLive: (v: number) => void; onCommit: (v: number) => void }) {
  const started = useRef(false);
  return (
    <label class="rng">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={(max - min) / 100} value={value}
        onInput={(e) => { if (!started.current) { started.current = true; begin(); } onLive(+(e.target as HTMLInputElement).value); }}
        onChange={(e) => { if (started.current) { started.current = false; onLive(+(e.target as HTMLInputElement).value); finish(); } else onCommit(+(e.target as HTMLInputElement).value); }} />
      <span class="num">{Math.round(value * 100)}%</span>
    </label>
  );
}

/** Drag the dot to turn a 3D head: left/right turns, up/down nods. Double-click looks straight ahead. */
function TurnPad({ turn, nod, onLive }: { turn: number; nod: number; onLive: (turn: number, nod: number) => void }) {
  const box = useRef<HTMLDivElement>(null), held = useRef(false);
  const at = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect(), cl = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
    onLive(cl(((e.clientX - r.left) / r.width) * 2 - 1), cl(((e.clientY - r.top) / r.height) * 2 - 1));
  };
  return (
    <div class="turnpad" ref={box} title={t("face_pad_tip")}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); held.current = true; begin(); at(e as unknown as PointerEvent); }}
      onPointerMove={(e) => { if (held.current) at(e as unknown as PointerEvent); }}
      onPointerUp={() => { if (held.current) { held.current = false; finish(); } }} onPointerCancel={() => { if (held.current) { held.current = false; finish(); } }}
      onDblClick={() => { begin(); onLive(0, 0); finish(); }}>
      <i class="cross" />
      <b style={{ left: `${(turn + 1) * 50}%`, top: `${(nod + 1) * 50}%` }} />
      <span class="num">{Math.round(turn * TURN_MAX)}° · {Math.round(nod * NOD_MAX)}°</span>
    </div>
  );
}

/**
 * Speed graph for the move from this key to the next: the line shows how far along the value is over
 * the time (bottom-left = this key, top-right = the next one), the shaded hill shows the speed.
 * Drag the two round handles to shape it, like a CSS / After Effects ease.
 */
function CurveEditor({ c, onLive }: { c: [number, number, number, number]; onLive: (c: [number, number, number, number]) => void }) {
  const svg = useRef<SVGSVGElement>(null), held = useRef<0 | 1 | 2>(0);
  const W = 232, H = 150, P = 16, Y0 = -0.3, Y1 = 1.3;
  const X = (u: number) => P + u * (W - 2 * P), Y = (v: number) => H - P - ((v - Y0) / (Y1 - Y0)) * (H - 2 * P);
  const pts: string[] = [], sp: number[] = [];
  for (let i = 0; i <= 48; i++) { const u = i / 48; pts.push(`${X(u).toFixed(1)},${Y(bezier(c, u)).toFixed(1)}`); }
  for (let i = 0; i < 48; i++) sp.push(Math.abs(bezier(c, (i + 1) / 48) - bezier(c, i / 48)) * 48);
  const top = Math.max(1.5, ...sp);
  const speed = `M${X(0)},${H - P} ` + sp.map((v, i) => `L${X((i + 0.5) / 48).toFixed(1)},${(H - P - (v / top) * (H - 2 * P) * 0.6).toFixed(1)}`).join(" ") + ` L${X(1)},${H - P}Z`;
  const drag = (e: PointerEvent) => {
    if (!held.current) return;
    const r = svg.current!.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, ((e.clientX - r.left) * (W / r.width) - P) / (W - 2 * P)));
    const v = Math.max(Y0, Math.min(Y1, Y0 + ((H - P - (e.clientY - r.top) * (H / r.height)) / (H - 2 * P)) * (Y1 - Y0)));
    const n: [number, number, number, number] = [...c];
    if (held.current === 1) { n[0] = +u.toFixed(3); n[1] = +v.toFixed(3); } else { n[2] = +u.toFixed(3); n[3] = +v.toFixed(3); }
    onLive(n);
  };
  const handle = (k: 1 | 2) => {
    const hx = X(c[k === 1 ? 0 : 2]), hy = Y(c[k === 1 ? 1 : 3]), ax = k === 1 ? X(0) : X(1), ay = k === 1 ? Y(0) : Y(1);
    return <>
      <line x1={ax} y1={ay} x2={hx} y2={hy} class="cv-arm" />
      <circle cx={hx} cy={hy} r={7} class="cv-h" onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); held.current = k; begin(); }} />
    </>;
  };
  return (
    <div class="curve">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} onPointerMove={(e) => drag(e as unknown as PointerEvent)}
        onPointerUp={() => { if (held.current) { held.current = 0; finish(); } }} onPointerCancel={() => { if (held.current) { held.current = 0; finish(); } }}>
        <rect x={X(0)} y={Y(1)} width={X(1) - X(0)} height={Y(0) - Y(1)} class="cv-box" />
        <path d={speed} class="cv-speed" />
        <polyline points={pts.join(" ")} class="cv-line" />
        {handle(1)}{handle(2)}
      </svg>
      <p class="hint-s">{t("curve_hint")}</p>
    </div>
  );
}
