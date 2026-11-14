// Timelapse: the red "recording" badge, and the window that turns the recording into a video.
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { tlAvailable, tlRec, tlCount, tlSeconds, tlError, startTimelapse, stopTimelapse, discardTimelapse, timelapseVideo, timelapseStarted, TL_EVERY } from "../io/timelapse";
import { saveBlobAs } from "../io/projectFile";
import { t } from "../i18n";
import { Icon } from "./icons";
import { Modal, confirmBox } from "./Dialogs";
import { toast } from "./shell";

export const tlOpen = signal(false);
const SPEEDS = [10, 15, 30, 60];

const dur = (s: number) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };

/** Menu entry: start recording, or open the timelapse window. */
export function TimelapseMenuItem() {
  if (!tlAvailable) return null;
  if (tlRec.value) return <button onClick={() => { stopTimelapse(); tlOpen.value = true; }}><Icon n="rec" />{t("tl_stop")}</button>;
  return tlCount.value
    ? <button onClick={() => (tlOpen.value = true)}><Icon n="rec" />{t("tl_menu_n", { n: dur(tlSeconds.value) })}</button>
    : <button onClick={() => { startTimelapse(); toast(t("tl_started")); }}><Icon n="rec" />{t("tl_start")}</button>;
}

/** Shown everywhere while recording. */
export function TimelapseBadge() {
  useEffect(() => { if (tlError.value) toast(t("tl_failed", { msg: tlError.value }), true); }, [tlError.value]);
  if (!tlRec.value) return tlOpen.value ? <TimelapseDialog /> : null;
  return (
    <>
      <button class="recpill" title={t("tl_stop")} onClick={() => { stopTimelapse(); tlOpen.value = true; }}>
        <i /> REC <span class="num">{dur(tlSeconds.value)}</span><Icon n="stop" size={12} />
      </button>
      {tlOpen.value && <TimelapseDialog />}
    </>
  );
}

function TimelapseDialog() {
  const [fps, setFps] = useState(30);
  const [prog, setProg] = useState<number | null>(null);
  const ac = useRef<AbortController | null>(null);
  const n = tlCount.value, close = () => { if (prog != null) ac.current?.abort(); else tlOpen.value = false; };
  const started = timelapseStarted();

  async function save() {
    const a = new AbortController(); ac.current = a; setProg(0);
    try {
      const blob = await timelapseVideo(fps, (d, tot) => setProg(d / tot), a.signal);
      const day = new Date(started || Date.now()).toISOString().slice(0, 10);
      if (await saveBlobAs(blob, `TST Motion timelapse ${day}.mp4`, "MP4", ".mp4")) toast(t("tl_saved"));
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") toast(t("x_cancelled"));
      else toast(t("x_failed", { msg: (e as Error)?.message ?? String(e) }), true);
    } finally { setProg(null); ac.current = null; }
  }

  if (prog != null) {
    return (
      <Modal title={t("tl_making")} onClose={close} footer={<button class="btn" onClick={close}>{t("cancel")}</button>}>
        <div class="xbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prog * 100)}><i style={{ width: `${prog * 100}%` }} /></div>
        <p class="num" style={{ margin: "10px 0 0" }}>{Math.round(prog * 100)}%</p>
      </Modal>
    );
  }
  return (
    <Modal title={t("tl_title")} onClose={close} footer={<>
      <button class="btn danger" disabled={!n} onClick={async () => { if (await confirmBox(t("tl_discard_q"), t("delete"))) { await discardTimelapse(); tlOpen.value = false; toast(t("tl_discarded")); } }}><Icon n="trash" />{t("tl_discard")}</button>
      <button class="btn" onClick={() => { startTimelapse(); tlOpen.value = false; }}><Icon n="rec" />{n ? t("tl_continue") : t("tl_start")}</button>
      <button class="btn primary" disabled={!n} onClick={() => void save()}><Icon n="export" />{t("tl_save")}</button>
    </>}>
      <p class="muted" style={{ margin: "0 0 12px" }}>{t("tl_about", { s: TL_EVERY })}</p>
      {n ? <>
        <p style={{ margin: "0 0 12px" }}>{t("tl_have", { n, t: dur(tlSeconds.value) })}</p>
        <label class="l">{t("tl_speed")}
          <select class="select" value={fps} onChange={(e) => setFps(+(e.target as HTMLSelectElement).value)}>
            {SPEEDS.map((f) => <option value={f}>{t("tl_speed_o", { f, x: Math.round(f * TL_EVERY), len: n / f < 60 ? `${(n / f).toFixed(1)} s` : dur(n / f) })}</option>)}
          </select>
        </label>
      </> : <p>{t("tl_none")}</p>}
      <p class="hint-s">{t("tl_privacy")}</p>
    </Modal>
  );
}
