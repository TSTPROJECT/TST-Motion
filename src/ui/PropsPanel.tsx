// Numbers for the selected part: position, rotation, size, opacity, pivot, parent, easing.
import { useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { project, rev, frame, selected, mode, edit, begin, live, finish, writeProp, toggleKeys, toggleKeyProp, hasKeyAt, keyIndex, setEaseAt, easeAt, setParent, movePivotLive, renameLayer } from "../model/store";
import { valueAt, keyFrames } from "../model/anim";
import type { Ease, Layer, Prop } from "../model/types";
import { t, type Key as TKey } from "../i18n";
import { Icon } from "./icons";
import { toast } from "./shell";

function KeyDot({ l, pr }: { l: Layer; pr: Prop }) {
  const keys = l.tracks[pr];
  const state = !keys?.length ? "none" : keyIndex(keys, frame.value) >= 0 ? "on" : "";
  return <button class="kb" title={t("key_prop")} aria-label={t("key_prop")} onClick={() => toggleKeyProp(l.id, pr)}><i class={"dia " + state} /></button>;
}

/** Number box whose label can be dragged left/right to change the value. */
function NumField({ label, value, step, digits, onLive, onCommit, suffix, keyDot }: {
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
];

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
  const kd = (pr: Prop) => (mode.value === "animate" ? <KeyDot l={l} pr={pr} /> : undefined);

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
            {ease === null ? <p class="hint-s">{t("ease_need_key")}</p> : (
              <div class="eases">
                {EASE_LIST.map(([e, d]) => (
                  <button class="ease" aria-pressed={ease === e} onClick={() => setEaseAt(l.id, f, e)}>
                    <svg viewBox="0 0 34 21"><path d={d} /></svg>{t(("e_" + e) as TKey)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div class="grp">
          <h3>{t("g_pivot")}{asset && <button onClick={() => { begin(); movePivotLive(l.id, asset.w / 2, asset.h / 2); finish(); }}>{t("center_pivot")}</button>}</h3>
          <NumField label={t("p_px")} value={l.px} step={1} digits={1} onLive={(x) => movePivotLive(l.id, x, l.py)} onCommit={(x) => { begin(); movePivotLive(l.id, x, l.py); finish(); }} />
          <NumField label={t("p_py")} value={l.py} step={1} digits={1} onLive={(y) => movePivotLive(l.id, l.px, y)} onCommit={(y) => { begin(); movePivotLive(l.id, l.px, y); finish(); }} />
        </div>
        {l.parent && (
          <div class="grp">
            <h3>{t("g_bend")}</h3>
            <NumField label={t("p_bend")} value={l.bend ?? 0} step={1} digits={0} suffix=" px"
              onLive={(x) => live((pp) => { const q = pp.layers.find((z) => z.id === l.id); if (q) q.bend = Math.max(0, Math.min(2000, Math.round(x))); })}
              onCommit={(x) => edit((pp) => { const q = pp.layers.find((z) => z.id === l.id); if (q) q.bend = Math.max(0, Math.min(2000, Math.round(x))); })} />
            <p class="hint-s">{t("bend_hint")}</p>
          </div>
        )}
        <p class="hint-s">{mode.value === "setup" ? t("mode_setup_hint") : t("mode_animate_hint")}</p>
      </div></div>
    </aside>
  );
}
