// Properties of a sound (start, volume, mute, trim) and lip sync for a mouth part.
import { useState } from "preact/hooks";
import { project, frame, edit, mode } from "../model/store";
import type { Layer } from "../model/types";
import { selectedSound, lipSync, clipSeconds } from "../audio/sound";
import { getLoaded } from "../io/assets";
import { t } from "../i18n";
import { Icon } from "./icons";
import { NumField, Toggle } from "./PropsPanel";
import { toast } from "./shell";
import { pickSound } from "./soundOps";

const editSound = (id: string, fn: (s: NonNullable<ReturnType<typeof findSound>>) => void) =>
  edit((pp) => { const s = pp.sounds?.find((x) => x.id === id); if (s) fn(s); });
const findSound = (id: string) => project.value?.sounds?.find((x) => x.id === id);

/** Shown in the properties panel when a sound is picked on the timeline. */
export function SoundPanel({ id, adv }: { id: string; adv: boolean }) {
  const p = project.value!, s = findSound(id); if (!s) return null;
  const secs = clipSeconds(p, s);
  return (
    <div class="props">
      <div class="who">
        <input class="field" value={s.name} aria-label={t("rename")} onChange={(e) => editSound(id, (x) => (x.name = (e.target as HTMLInputElement).value.slice(0, 60) || x.name))} />
      </div>
      <div class="grp">
        <h3><span><Icon n="music" size={13} /> {t("g_sound")}</span><span class="muted num" style={{ fontSize: "11.5px" }}>{secs.toFixed(1)} s</span></h3>
        <NumField label={t("sound_start")} value={s.start} step={0.2} digits={0} suffix={` f · ${(s.start / p.fps).toFixed(2)} s`} onLive={() => {}}
          onCommit={(v) => editSound(id, (x) => (x.start = Math.max(0, Math.min(p.frames - 1, Math.round(v)))))} />
        <button class="btn sm" onClick={() => editSound(id, (x) => (x.start = frame.value))}><Icon n="right" />{t("sound_to_here")}</button>
        <NumField label={t("sound_vol")} value={s.vol * 100} step={0.5} digits={0} suffix="%" onLive={() => {}}
          onCommit={(v) => editSound(id, (x) => (x.vol = Math.max(0, Math.min(200, v)) / 100))} />
        <div class="txtrow">
          <span class="muted lbl">{t("sound_mute")}</span>
          <Toggle on={!!s.mute} label={t("sound_mute")} onChange={(on) => editSound(id, (x) => { if (on) x.mute = true; else delete x.mute; })} />
        </div>
        {adv && <NumField label={t("sound_trim")} value={s.trim} step={0.01} digits={2} suffix=" s" onLive={() => {}}
          onCommit={(v) => editSound(id, (x) => (x.trim = Math.max(0, Math.min(x.dur - 0.05, v))))} />}
        <p class="hint-s">{t("sound_hint")}</p>
        <button class="btn sm danger" onClick={() => { edit((pp) => { pp.sounds = (pp.sounds ?? []).filter((x) => x.id !== id); if (!pp.sounds.length) delete pp.sounds; }); selectedSound.value = null; }}>
          <Icon n="trash" />{t("sound_delete")}
        </button>
      </div>
      <p class="hint-s">{t("lip_from_sound")}</p>
    </div>
  );
}

/** Lip sync: the mouth part switches between closed, half-open and open pictures with the sound's loudness. */
export function LipSyncGroup({ l }: { l: Layer }) {
  const p = project.value!, sounds = p.sounds ?? [];
  const pics = [l.asset, ...(l.swaps ?? [])];
  const n = pics.length;
  const [snd, setSnd] = useState<string>("");
  const [map, setMap] = useState<[number, number, number]>([0, Math.min(1, n - 1), Math.min(2, n - 1)]);
  const [sens, setSens] = useState(50);
  const soundId = sounds.some((x) => x.id === snd) ? snd : sounds[0]?.id ?? "";
  if (n < 2 || mode.value !== "animate") return null;
  const row = (k: 0 | 1 | 2, label: string) => (
    <div class="liprow">
      <span class="muted lbl">{label}</span>
      <div class="lipthumbs">
        {pics.map((id, i) => {
          const url = id ? getLoaded(id)?.url : undefined;
          return <button aria-pressed={map[k] === i} title={t("swap_n", { n: i })} onClick={() => { const m = [...map] as [number, number, number]; m[k] = i; setMap(m); }}>
            {url ? <img src={url} alt="" /> : <span class="num">{i + 1}</span>}
          </button>;
        })}
      </div>
    </div>
  );
  return (
    <div class="grp">
      <h3><span><Icon n="mic" size={13} /> {t("g_lip")}</span></h3>
      {!sounds.length ? <>
        <p class="hint-s">{t("lip_need_sound")}</p>
        <button class="btn sm" onClick={() => void pickSound()}><Icon n="music" />{t("sound_add")}</button>
      </> : <>
        <label class="nf" style={{ gridTemplateColumns: "auto minmax(0,1fr)" }}>
          <span class="muted" style={{ fontSize: "12.5px" }}>{t("lip_sound")}</span>
          <select class="select" value={soundId} onChange={(e) => setSnd((e.target as HTMLSelectElement).value)}>
            {sounds.map((x) => <option value={x.id}>{x.name}</option>)}
          </select>
        </label>
        {row(0, t("lip_closed"))}
        {row(1, t("lip_half"))}
        {row(2, t("lip_open"))}
        <NumField label={t("lip_sens")} value={sens} step={0.5} digits={0} suffix="%" onLive={() => {}} onCommit={(v) => setSens(Math.max(0, Math.min(100, v)))} />
        <button class="btn sm primary" onClick={() => {
          const k = lipSync(l.id, soundId, map, sens / 100);
          toast(k ? t("lip_done", { n: k }) : t("lip_silent"), !k);
        }}><Icon n="mic" />{t("lip_make")}</button>
        <p class="hint-s">{t("lip_hint")}</p>
      </>}
    </div>
  );
}
