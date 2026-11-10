// In-page dialogs (browsers' confirm() is unreliable inside installed apps).
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { t } from "../i18n";
import { Icon } from "./icons";
import { project, setProjectSettings } from "../model/store";
import { MAX_SECONDS, type Background } from "../model/types";

const ask = signal<{ text: string; yes: string; done: (v: boolean) => void } | null>(null);
export function confirmBox(text: string, yes: string): Promise<boolean> {
  return new Promise((done) => (ask.value = { text, yes, done }));
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input, button.primary, button")?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); prev?.focus?.(); };
  }, []);
  return (
    <div class="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="dlg" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div class="dlg-h"><h3>{title}</h3><button class="ibtn ghost" aria-label={t("close")} onClick={onClose}><Icon n="close" /></button></div>
        <div class="dlg-b">{children}</div>
        {footer && <div class="dlg-f">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const a = ask.value; if (!a) return null;
  const close = (v: boolean) => { ask.value = null; a.done(v); };
  return (
    <Modal title={a.yes} onClose={() => close(false)} footer={<>
      <button class="btn" onClick={() => close(false)}>{t("cancel")}</button>
      <button class="btn primary" onClick={() => close(true)}>{a.yes}</button>
    </>}>
      <p style={{ margin: 0, lineHeight: 1.6 }}>{a.text}</p>
    </Modal>
  );
}

export const settingsOpen = signal(false);
const SIZES: Array<[string, number, number]> = [["9:16", 1080, 1920], ["16:9", 1920, 1080], ["1:1", 1080, 1080], ["4:5", 1080, 1350]];

export function SettingsDialog() {
  const p = project.value;
  const [name, setName] = useState(p?.name ?? "");
  const [w, setW] = useState(p?.w ?? 1080), [h, setH] = useState(p?.h ?? 1920);
  const [fps, setFps] = useState(p?.fps ?? 30);
  const [sec, setSec] = useState(p ? +(p.frames / p.fps).toFixed(2) : 5);
  const [bg, setBg] = useState<Background>(p?.bg ?? "alpha");
  if (!p || !settingsOpen.value) return null;
  const close = () => (settingsOpen.value = false);
  const save = () => {
    const W = clampInt(w, 16, 4096), H = clampInt(h, 16, 4096);
    setProjectSettings({ name, w: W !== p.w || H !== p.h ? W : undefined, h: W !== p.w || H !== p.h ? H : undefined, fps, seconds: Math.min(MAX_SECONDS, Math.max(0.1, sec)), bg });
    close();
  };
  return (
    <Modal title={t("settings")} onClose={close} footer={<>
      <button class="btn" onClick={close}>{t("cancel")}</button>
      <button class="btn primary" onClick={save}>{t("save")}</button>
    </>}>
      <label class="l">{t("s_name")}<input class="field" value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <div class="l" style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12.5px" }}>
        <span class="muted">{t("s_size")}</span>
        <div class="chips">{SIZES.map(([lab, sw, sh]) => <button class="chip" aria-pressed={w === sw && h === sh} onClick={() => { setW(sw); setH(sh); }}>{lab}</button>)}</div>
        <div class="two">
          <label class="l">{t("width")}<input class="field num" type="number" min={16} max={4096} value={w} onInput={(e) => setW(+(e.target as HTMLInputElement).value)} /></label>
          <label class="l">{t("height")}<input class="field num" type="number" min={16} max={4096} value={h} onInput={(e) => setH(+(e.target as HTMLInputElement).value)} /></label>
        </div>
      </div>
      <div class="two">
        <label class="l">{t("s_fps")}<select class="select" value={fps} onChange={(e) => setFps(+(e.target as HTMLSelectElement).value)}>{[12, 24, 25, 30, 60].map((f) => <option value={f}>{f}</option>)}</select></label>
        <label class="l">{t("s_length", { max: MAX_SECONDS })}<input class="field num" type="number" min={0.1} max={MAX_SECONDS} step={0.1} value={sec} onInput={(e) => setSec(+(e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="l" style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12.5px" }}>
        <span class="muted">{t("s_bg")}</span>
        <div class="chips">{(["alpha", "green", "white", "black"] as Background[]).map((b) => <button class="chip" aria-pressed={bg === b} onClick={() => setBg(b)}>{t(("bg_" + b) as "bg_alpha")}</button>)}</div>
      </div>
    </Modal>
  );
}
const clampInt = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v || lo)));
