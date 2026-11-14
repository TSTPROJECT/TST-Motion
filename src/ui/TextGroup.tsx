// Properties of a text part: the words, font, size, colours, outline, box and typewriter.
import { useEffect, useRef, useState } from "preact/hooks";
import { project, mode, advanced, panelFrame } from "../model/store";
import { valueAt } from "../model/anim";
import type { Layer, TextStyle } from "../model/types";
import { BUNDLED_FONTS, systemFonts } from "../render/text";
import { t } from "../i18n";
import { Icon } from "./icons";
import { KeyDot, NumField, Toggle } from "./PropsPanel";
import { setText, typewriter, addFontFile } from "./textOps";
import { pickFile } from "./open";

const ADD_FONT = "\u0000add";

export function TextGroup({ l }: { l: Layer }) {
  const st = l.text!, p = project.value!;
  const [draft, setDraft] = useState(st.s);
  const timer = useRef(0), mine = useRef(st.s);
  // follow undo / other changes unless the user is typing
  useEffect(() => { if (st.s !== mine.current) { mine.current = st.s; setDraft(st.s); } }, [st.s]);
  const set = (patch: Partial<TextStyle>) => void setText(l.id, patch);
  const adv = advanced.value;
  const fonts = systemFonts();
  const typed = valueAt(l, "type", panelFrame.value);

  return (
    <div class="grp">
      <h3><span><Icon n="text" size={13} /> {t("g_text")}</span></h3>
      <textarea class="field txt" rows={3} value={draft} aria-label={t("g_text")} placeholder={t("text_default")}
        onInput={(e) => {
          const v = (e.target as HTMLTextAreaElement).value; setDraft(v); mine.current = v;
          clearTimeout(timer.current); timer.current = window.setTimeout(() => set({ s: v }), 350);
        }} />
      <label class="nf" style={{ gridTemplateColumns: "auto minmax(0,1fr)" }}>
        <span class="muted" style={{ fontSize: "12.5px" }}>{t("text_font")}</span>
        <select class="select" value={st.font} style={{ fontFamily: `"${st.font}"` }} onChange={async (e) => {
          const sel = e.target as HTMLSelectElement, v = sel.value;
          if (v !== ADD_FONT) { set({ font: v }); return; }
          sel.value = st.font;
          const [file] = await pickFile(".ttf,.otf,.woff,.woff2,font/*", false); if (!file) return;
          const fam = await addFontFile(file); if (fam) set({ font: fam });
        }}>
          <optgroup label={t("font_bundled")}>{BUNDLED_FONTS.map((f) => <option value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}</optgroup>
          {!!p.fonts?.length && <optgroup label={t("font_project")}>{p.fonts.map((f) => <option value={f.family} style={{ fontFamily: `"${f.family}"` }}>{f.family}</option>)}</optgroup>}
          {!!fonts.length && <optgroup label={t("font_system")}>{fonts.map((f) => <option value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}</optgroup>}
          {![...BUNDLED_FONTS, ...fonts, ...(p.fonts ?? []).map((f) => f.family)].includes(st.font) && <option value={st.font}>{st.font}</option>}
          <option value={ADD_FONT}>{t("font_add")}</option>
        </select>
      </label>
      <NumField label={t("text_size")} value={st.size} step={0.5} digits={0} suffix=" px" onLive={() => {}} onCommit={(v) => set({ size: Math.max(4, Math.min(1200, Math.round(v))) })} />
      <div class="txtrow">
        <button class={"btn sm" + (st.bold ? " on" : "")} aria-pressed={st.bold} title={t("text_bold")} onClick={() => set({ bold: !st.bold })}><b>B</b></button>
        <button class={"btn sm" + (st.italic ? " on" : "")} aria-pressed={st.italic} title={t("text_italic")} onClick={() => set({ italic: !st.italic })}><i style={{ fontFamily: "serif" }}>I</i></button>
        <div class="seg">
          {(["left", "center", "right"] as const).map((a) => <button aria-pressed={st.align === a} title={t(("align_" + a) as "align_left")} onClick={() => set({ align: a })}><AlignIcon a={a} /></button>)}
        </div>
        <label class="swatch" title={t("text_color")}><input type="color" value={st.color} onChange={(e) => set({ color: (e.target as HTMLInputElement).value })} /><span style={{ background: st.color }} /></label>
      </div>
      <div class="txtrow">
        <span class="muted lbl">{t("text_outline")}</span>
        <Toggle on={st.stroke > 0} label={t("text_outline")} onChange={(on) => set({ stroke: on ? Math.max(2, Math.round(st.size * 0.08)) : 0 })} />
        {st.stroke > 0 && <label class="swatch" title={t("text_outline_color")}><input type="color" value={st.strokeColor} onChange={(e) => set({ strokeColor: (e.target as HTMLInputElement).value })} /><span style={{ background: st.strokeColor }} /></label>}
        <span class="muted lbl">{t("text_box")}</span>
        <Toggle on={st.box > 0} label={t("text_box")} onChange={(on) => set({ box: on ? Math.max(4, Math.round(st.size * 0.3)) : 0 })} />
        {st.box > 0 && <label class="swatch" title={t("text_box_color")}><input type="color" value={st.boxColor} onChange={(e) => set({ boxColor: (e.target as HTMLInputElement).value })} /><span style={{ background: st.boxColor }} /></label>}
      </div>
      {adv && <>
        {st.stroke > 0 && <NumField label={t("text_outline_w")} value={st.stroke} step={0.2} digits={0} suffix=" px" onLive={() => {}} onCommit={(v) => set({ stroke: Math.max(0, Math.min(200, Math.round(v))) })} />}
        {st.box > 0 && <NumField label={t("text_box_pad")} value={st.box} step={0.2} digits={0} suffix=" px" onLive={() => {}} onCommit={(v) => set({ box: Math.max(0, Math.min(400, Math.round(v))) })} />}
        {st.box > 0 && <NumField label={t("text_box_round")} value={st.boxRound * 100} step={0.5} digits={0} suffix="%" onLive={() => {}} onCommit={(v) => set({ boxRound: Math.max(0, Math.min(100, v)) / 100 })} />}
        <NumField label={t("text_line")} value={st.line * 100} step={0.5} digits={0} suffix="%" onLive={() => {}} onCommit={(v) => set({ line: Math.max(50, Math.min(400, v)) / 100 })} />
        <NumField label={t("text_spacing")} value={st.spacing * 100} step={0.2} digits={0} suffix="%" onLive={() => {}} onCommit={(v) => set({ spacing: Math.max(-50, Math.min(200, v)) / 100 })} />
      </>}
      <div class="txtrow">
        <button class="btn sm" onClick={() => typewriter(l.id)}><Icon n="text" />{t("text_typewriter")}</button>
        {mode.value === "animate" && <><KeyDot l={l} pr="type" /><span class="hint-s num">{Math.round(typed * 100)}%</span></>}
      </div>
      <p class="hint-s">{t("text_hint")}</p>
    </div>
  );
}

function AlignIcon({ a }: { a: "left" | "center" | "right" }) {
  const lines = a === "left" ? "M4 6h16M4 10h10M4 14h16M4 18h10" : a === "right" ? "M4 6h16M10 10h10M4 14h16M10 18h10" : "M4 6h16M7 10h10M4 14h16M7 18h10";
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d={lines} /></svg>;
}
