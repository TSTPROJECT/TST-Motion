// Properties: motion path, mask (clip to another part's shape) and effects (blend, blur, shadow, glow, colours).
import { project, frame, mode, advanced, edit, live, writeProp, showPath, sketchArm, tool } from "../model/store";
import { valueAt, pathFrames } from "../model/anim";
import type { Blend, Chan, Fx, Layer } from "../model/types";
import { t, type Key as TKey } from "../i18n";
import { Icon } from "./icons";
import { KeyDot, NumField, Toggle } from "./PropsPanel";

const setOn = (id: string, fn: (x: Layer) => void, now = false) => (now ? edit : live)((pp) => { const x = pp.layers.find((q) => q.id === id); if (x) fn(x); });

/** A keyable value shown as a number (times `k`, e.g. 100 for percent), clamped to lo..hi (shown units). */
function Ch({ l, label, ch, k = 1, digits = 0, suffix, lo = -Infinity, hi = Infinity, step = 0.5 }: { l: Layer; label: string; ch: Chan; k?: number; digits?: number; suffix?: string; lo?: number; hi?: number; step?: number }) {
  const put = (v: number, now: boolean) => setOn(l.id, (q) => writeProp(q, ch, Math.max(lo, Math.min(hi, v)) / k), now);
  return <NumField label={label} value={valueAt(l, ch, frame.value) * k} step={step} digits={digits} suffix={suffix}
    keyDot={mode.value === "animate" ? <KeyDot l={l} pr={ch} /> : undefined} onLive={(v) => put(v, false)} onCommit={(v) => put(v, true)} />;
}
function Swatch({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  return <label class="swatch" title={label}><input type="color" value={value} aria-label={label} onChange={(e) => onChange((e.target as HTMLInputElement).value)} /><span style={{ background: value }} /></label>;
}
/** Change the effect settings; an empty one is removed. */
function fxEdit(l: Layer, fn: (fx: Fx, x: Layer) => void) {
  setOn(l.id, (x) => { const fx = (x.fx ??= {}); fn(fx, x); if (!Object.keys(fx).length) delete x.fx; }, true);
}
const dropCh = (x: Layer, ch: Chan) => { delete x.tracks[ch]; delete x.base[ch]; };

export function MaskGroup({ l }: { l: Layer }) {
  const p = project.value!;
  const shapes = p.layers.filter((x) => x.id !== l.id && x.asset && !x.camera);
  return (
    <div class="grp">
      <h3><span><Icon n="mask" size={13} /> {t("g_mask")}</span></h3>
      <select class="select" value={l.mask?.by ?? ""} aria-label={t("g_mask")} onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        setOn(l.id, (x) => { if (v) x.mask = { by: v, invert: x.mask?.invert }; else delete x.mask; }, true);
      }}>
        <option value="">{t("mask_none")}</option>
        {shapes.map((x) => <option value={x.id}>{x.name}</option>)}
      </select>
      {l.mask && <div class="txtrow" title={t("mask_invert")}>
        <Toggle on={!!l.mask.invert} label={t("mask_invert")} onChange={(on) => setOn(l.id, (x) => { if (x.mask) x.mask.invert = on || undefined; }, true)} />
        <span class="muted lbl">{t("mask_invert_short")}</span>
      </div>}
      <p class="hint-s">{l.mask ? (l.mask.invert ? t("mask_hint_out") : t("mask_hint_in")) : t("mask_hint")}</p>
    </div>
  );
}

const BLENDS: Blend[] = ["normal", "multiply", "screen", "add"];
export function FxGroup({ l }: { l: Layer }) {
  const adv = advanced.value, fx = l.fx ?? {};
  const any = !!l.fx || Object.keys(l.tracks).some((k) => k.startsWith("fx:")) || Object.keys(l.base).some((k) => k.startsWith("fx:"));
  return (
    <div class="grp">
      <h3><span><Icon n="fx" size={13} /> {t("g_fx")}</span>{any && <button onClick={() => setOn(l.id, (x) => { delete x.fx; for (const k of Object.keys(x.tracks)) if (k.startsWith("fx:")) delete x.tracks[k]; for (const k of Object.keys(x.base)) if (k.startsWith("fx:")) delete x.base[k]; }, true)}>{t("fx_clear")}</button>}</h3>
      <label class="nf" style={{ gridTemplateColumns: "auto minmax(0,1fr)" }}>
        <span class="muted" style={{ fontSize: "12.5px" }}>{t("fx_blend")}</span>
        <select class="select" value={fx.blend ?? "normal"} onChange={(e) => fxEdit(l, (f) => { const v = (e.target as HTMLSelectElement).value as Blend; if (v === "normal") delete f.blend; else f.blend = v; })}>
          {BLENDS.map((b) => <option value={b}>{t(("blend_" + b) as TKey)}</option>)}
        </select>
      </label>
      <Ch l={l} label={t("fx_blur")} ch="fx:blur" suffix=" px" lo={0} hi={400} step={0.2} digits={1} />
      <Ch l={l} label={t("fx_bright")} ch="fx:bright" k={100} suffix="%" lo={-100} hi={100} />
      <Ch l={l} label={t("fx_sat")} ch="fx:sat" k={100} suffix="%" lo={-100} hi={200} />
      {adv && <Ch l={l} label={t("fx_contrast")} ch="fx:contrast" k={100} suffix="%" lo={-100} hi={200} />}
      {adv && <Ch l={l} label={t("fx_hue")} ch="fx:hue" suffix="°" lo={-180} hi={180} />}

      <div class="txtrow">
        <span class="muted lbl">{t("fx_shadow")}</span>
        <Toggle on={!!fx.shadow} label={t("fx_shadow")} onChange={(on) => fxEdit(l, (f, x) => {
          if (on) { f.shadow = { dx: 12, dy: 16, blur: 18, color: "#000000" }; x.base["fx:shadow"] = 0.55; } else { delete f.shadow; dropCh(x, "fx:shadow"); }
        })} />
        {fx.shadow && <Swatch value={fx.shadow.color} label={t("fx_color")} onChange={(v) => fxEdit(l, (f) => { if (f.shadow) f.shadow.color = v; })} />}
        <span class="muted lbl">{t("fx_glow")}</span>
        <Toggle on={!!fx.glow} label={t("fx_glow")} onChange={(on) => fxEdit(l, (f, x) => {
          if (on) { f.glow = { size: 24, color: "#ffe066" }; x.base["fx:glow"] = 0.8; } else { delete f.glow; dropCh(x, "fx:glow"); }
        })} />
        {fx.glow && <Swatch value={fx.glow.color} label={t("fx_color")} onChange={(v) => fxEdit(l, (f) => { if (f.glow) f.glow.color = v; })} />}
      </div>
      {fx.shadow && <>
        <Ch l={l} label={t("fx_shadow")} ch="fx:shadow" k={100} suffix="%" lo={0} hi={100} />
        {adv && <NumField label={t("fx_shadow_x")} value={fx.shadow.dx} step={0.5} digits={0} suffix=" px" onLive={() => {}} onCommit={(v) => fxEdit(l, (f) => { if (f.shadow) f.shadow.dx = v; })} />}
        {adv && <NumField label={t("fx_shadow_y")} value={fx.shadow.dy} step={0.5} digits={0} suffix=" px" onLive={() => {}} onCommit={(v) => fxEdit(l, (f) => { if (f.shadow) f.shadow.dy = v; })} />}
        {adv && <NumField label={t("fx_shadow_blur")} value={fx.shadow.blur} step={0.5} digits={0} suffix=" px" onLive={() => {}} onCommit={(v) => fxEdit(l, (f) => { if (f.shadow) f.shadow.blur = Math.max(0, v); })} />}
      </>}
      {fx.glow && <>
        <Ch l={l} label={t("fx_glow")} ch="fx:glow" k={100} suffix="%" lo={0} hi={100} />
        {adv && <NumField label={t("fx_glow_size")} value={fx.glow.size} step={0.5} digits={0} suffix=" px" onLive={() => {}} onCommit={(v) => fxEdit(l, (f) => { if (f.glow) f.glow.size = Math.max(1, v); })} />}
      </>}
      {adv && <div class="txtrow">
        <span class="muted lbl">{t("fx_tint")}</span>
        <Toggle on={!!fx.tint} label={t("fx_tint")} onChange={(on) => fxEdit(l, (f, x) => { if (on) { f.tint = "#ff5a3c"; x.base["fx:tint"] = 0.5; } else { delete f.tint; dropCh(x, "fx:tint"); } })} />
        {fx.tint && <Swatch value={fx.tint} label={t("fx_tint")} onChange={(v) => fxEdit(l, (f) => { f.tint = v; })} />}
      </div>}
      {adv && fx.tint && <Ch l={l} label={t("fx_tint_amt")} ch="fx:tint" k={100} suffix="%" lo={0} hi={100} />}
      <p class="hint-s">{t("fx_hint")}</p>
    </div>
  );
}

/** Motion path: smooth curve through the keys, face the way it goes, draw the path by hand. */
export function PathGroup({ l }: { l: Layer }) {
  if (mode.value !== "animate") return null;
  const n = pathFrames(l).length, pa = l.path ?? {};
  const setPath = (k: "curve" | "orient", on: boolean) => setOn(l.id, (x) => { const q = { ...x.path, [k]: on || undefined }; if (!q.curve && !q.orient) delete x.path; else x.path = q; }, true);
  return (
    <div class="grp">
      <h3><span><Icon n="path" size={13} /> {t("g_path")}</span><Toggle on={showPath.value} label={t("path_show")} onChange={(on) => (showPath.value = on)} /></h3>
      <div class="txtrow">
        <span class="muted lbl">{t("path_curve")}</span>
        <Toggle on={!!pa.curve} label={t("path_curve")} onChange={(on) => setPath("curve", on)} />
        {!l.camera && <><span class="muted lbl">{t("path_orient")}</span>
        <Toggle on={!!pa.orient} label={t("path_orient")} onChange={(on) => setPath("orient", on)} /></>}
      </div>
      <button class={"btn sm" + (sketchArm.value ? " on" : "")} aria-pressed={sketchArm.value} onClick={() => { sketchArm.value = !sketchArm.value; if (sketchArm.value && tool.value !== "move") tool.value = "move"; }}>
        <Icon n="path" />{sketchArm.value ? t("path_sketch_cancel") : t("path_sketch")}
      </button>
      <p class="hint-s">{sketchArm.value ? t("tip_sketch") : n >= 2 ? t("path_hint") : t("path_none")}</p>
    </div>
  );
}
