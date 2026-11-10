// Export window: pick file types and size, choose a folder, watch the progress.
import { useEffect, useRef, useState } from "preact/hooks";
import { project, playing } from "../model/store";
import { safeFileName } from "../io/projectFile";
import { runExport, exportSizes, supportedFormats, FORMATS, type Format, type OutFile, type Progress } from "../export/exporter";
import { t } from "../i18n";
import { Icon } from "./icons";
import { Modal } from "./Dialogs";
import { toast } from "./shell";

const KEY = "tstm-export";
interface Prefs { formats: Format[]; mp4Bg: string; gifLong: number; gifTransparent: boolean; short?: number }
const DEFAULTS: Prefs = { formats: ["mp4"], mp4Bg: "#00b140", gifLong: 540, gifTransparent: true };
const loadPrefs = (): Prefs => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; } };
const savePrefs = (p: Prefs) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } };

const SWATCHES = ["#00b140", "#0047bb", "#ffffff", "#000000"];
const GIF_SIZES = [360, 540, 720, 1080];
const LABEL: Record<Format, string> = { mp4: "MP4", webm: "WebM", mov: "MOV", gif: "GIF" };
let lastDir: FileSystemDirectoryHandle | null = null; // remembered while the program is open

function timeText(sec: number) {
  sec = Math.max(1, Math.round(sec));
  return sec < 60 ? t("x_sec", { n: sec }) : t("x_min", { m: Math.floor(sec / 60), s: sec % 60 });
}
function sizeText(b: number) {
  return b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const p = project.value!;
  const sizes = exportSizes(p);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const pick = sizes.find((s) => Math.min(s.w, s.h) === prefs.short) ?? sizes.find((s) => s.label === "Full HD") ?? sizes[0];
  const [size, setSize] = useState(pick);
  const [can, setCan] = useState<Record<Format, boolean> | null>(null);
  const [run, setRun] = useState<null | { prog: Progress; started: number }>(null);
  const [done, setDone] = useState<OutFile[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const upd = (x: Partial<Prefs>) => setPrefs((o) => { const n = { ...o, ...x }; savePrefs(n); return n; });

  useEffect(() => { let live = true; setCan(null); supportedFormats(size.w, size.h).then((c) => live && setCan(c)); return () => { live = false; }; }, [size.w, size.h]);

  const chosen = prefs.formats.filter((f) => can?.[f] !== false);
  const toggle = (f: Format) => upd({ formats: prefs.formats.includes(f) ? prefs.formats.filter((x) => x !== f) : FORMATS.filter((x) => x === f || prefs.formats.includes(x)) });

  async function start() {
    if (!chosen.length) { toast(t("x_none"), true); return; }
    const w = window as Window & { showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> };
    if (!w.showDirectoryPicker) { toast(t("x_no_folder"), true); return; }
    let dir: FileSystemDirectoryHandle;
    try { dir = await w.showDirectoryPicker({ id: "tstm-export", mode: "readwrite", startIn: lastDir ?? "videos" }); } catch { return; }
    lastDir = dir;
    playing.value = false;
    const ac = new AbortController(); abort.current = ac;
    setRun({ prog: { frame: 0, total: p.frames }, started: performance.now() });
    try {
      const files = await runExport(p, dir, safeFileName(p.name), { formats: chosen, width: size.w, height: size.h, mp4Bg: prefs.mp4Bg, gifLong: prefs.gifLong, gifTransparent: prefs.gifTransparent },
        (prog) => setRun((r) => (r ? { ...r, prog } : r)), ac.signal);
      setDone(files);
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") toast(t("x_cancelled"));
      else { console.error(e); toast(t("x_failed", { msg: (e as Error)?.message ?? String(e) }), true); }
    } finally { setRun(null); abort.current = null; }
  }

  const close = () => { if (run) abort.current?.abort(); else onClose(); };

  if (done) {
    return (
      <Modal title={t("x_done")} onClose={onClose} footer={<button class="btn primary" onClick={onClose}>{t("close")}</button>}>
        <p class="muted" style={{ margin: "0 0 10px" }}>{t("x_saved_in")}</p>
        <ul class="xfiles">{done.map((f) => <li><b>{f.name}</b><span class="num muted">{sizeText(f.size)}</span></li>)}</ul>
      </Modal>
    );
  }

  if (run) {
    const { frame, total } = run.prog, pct = total ? frame / total : 0;
    const spent = (performance.now() - run.started) / 1000, left = frame > 2 ? (spent / frame) * (total - frame) : 0;
    return (
      <Modal title={t("x_rendering")} onClose={close} footer={<button class="btn" onClick={close}>{t("cancel")}</button>}>
        <div class="xbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}><i style={{ width: `${pct * 100}%` }} /></div>
        <p class="num" style={{ margin: "10px 0 4px" }}>{Math.round(pct * 100)}% · {t("x_progress", { n: frame, total })}{left ? ` · ${t("x_left", { t: timeText(left) })}` : ""}</p>
        <p class="muted" style={{ margin: 0 }}>{chosen.map((f) => LABEL[f]).join(" + ")} · {size.w}×{size.h} · {t("x_keep_open")}</p>
      </Modal>
    );
  }

  return (
    <Modal title={t("x_title")} onClose={onClose} footer={<>
      <button class="btn" onClick={onClose}>{t("cancel")}</button>
      <button class="btn primary" disabled={!chosen.length || !can} onClick={start}><Icon n="export" />{t("x_start")}</button>
    </>}>
      <span class="muted xl">{t("x_formats")}</span>
      <div class="xfmts">
        {FORMATS.map((f) => {
          const off = can?.[f] === false;
          return (
            <label class={"xfmt" + (off ? " off" : "")}>
              <input type="checkbox" checked={!off && prefs.formats.includes(f)} disabled={off} onChange={() => toggle(f)} />
              <span><b>{LABEL[f]}</b><small>{off ? t("x_unsupported") : t(`x_${f}_d` as "x_mp4_d")}</small></span>
            </label>
          );
        })}
      </div>

      <label class="l">{t("x_size")}
        <select class="select" value={`${size.w}x${size.h}`} onChange={(e) => { const s = sizes.find((x) => `${x.w}x${x.h}` === (e.target as HTMLSelectElement).value)!; setSize(s); upd({ short: Math.min(s.w, s.h) }); }}>
          {sizes.map((s) => <option value={`${s.w}x${s.h}`}>{s.w} × {s.h} · {s.label}</option>)}
        </select>
      </label>

      {prefs.formats.includes("mp4") && (
        <div class="l"><span class="muted">{t("x_mp4bg")}</span>
          <div class="chips">
            {SWATCHES.map((c) => <button class="swatch" style={{ background: c }} aria-label={c} aria-pressed={prefs.mp4Bg === c} onClick={() => upd({ mp4Bg: c })} />)}
            <label class="swatch pick" title={t("x_pick")} style={{ background: SWATCHES.includes(prefs.mp4Bg) ? undefined : prefs.mp4Bg }}>
              <input type="color" value={prefs.mp4Bg} aria-label={t("x_pick")} onInput={(e) => upd({ mp4Bg: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
        </div>
      )}

      {prefs.formats.includes("gif") && (
        <div class="two">
          <label class="l">{t("x_gif_size")}
            <select class="select" value={prefs.gifLong} onChange={(e) => upd({ gifLong: +(e.target as HTMLSelectElement).value })}>
              {GIF_SIZES.map((g) => <option value={g}>{g} px</option>)}
            </select>
          </label>
          <label class="l xcheck"><input type="checkbox" checked={prefs.gifTransparent} onChange={() => upd({ gifTransparent: !prefs.gifTransparent })} />{t("x_gif_alpha")}</label>
        </div>
      )}

      <p class="muted num" style={{ margin: "4px 0 0", fontSize: "12.5px" }}>{t("x_info", { fps: p.fps, sec: +(p.frames / p.fps).toFixed(2), frames: p.frames })}</p>
    </Modal>
  );
}
