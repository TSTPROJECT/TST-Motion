// Getting work back: older versions of the open project, backup files on disk,
// and a note on the home screen when the program closed while a project was open.
import { useEffect, useState } from "preact/hooks";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { project } from "../model/store";
import { listVersions, type Version, type ProjectMeta } from "../io/db";
import { crashed } from "../io/autosave";
import { lang, t } from "../i18n";
import { Icon } from "./icons";
import { Modal, confirmBox } from "./Dialogs";
import { restoreVersion, openBackup, openSaved } from "./open";
import { toast } from "./shell";

const when = (ms: number) => new Date(ms).toLocaleString(lang.value === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const p = project.value;
  const [list, setList] = useState<Version[] | null>(null);
  useEffect(() => { if (p) listVersions(p.id).then(setList).catch(() => setList([])); }, []);
  if (!p) return null;
  return (
    <Modal title={t("versions")} onClose={onClose}>
      <p class="hint-s" style={{ margin: "0 0 10px" }}>{t("versions_hint")}</p>
      {list && !list.length && <p class="empty-list">{t("versions_empty")}</p>}
      <div class="vlist">
        {list?.map((v) => (
          <div class="vrow">
            <span class="th">{v.thumb && <img src={v.thumb} alt="" />}</span>
            <span class="meta"><b>{when(v.at)}</b><span>{t(("why_" + v.why) as "why_auto")} · {t("layers_n", { n: v.layers })}</span></span>
            <button class="btn sm" onClick={async () => {
              if (!(await confirmBox(t("ver_confirm", { time: when(v.at) }), t("ver_restore")))) return;
              if (await restoreVersion(v.key)) { toast(t("ver_done")); onClose(); } else toast(t("open_failed"), true);
            }}><Icon n="history" />{t("ver_restore")}</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

interface Backup { path: string; file: string; size: number }
export function BackupsDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Backup[] | null>(null);
  useEffect(() => { if (isTauri()) invoke<Backup[]>("backup_list").then(setList).catch(() => setList([])); else setList([]); }, []);
  return (
    <Modal title={t("backups")} onClose={onClose}>
      <p class="hint-s" style={{ margin: "0 0 10px" }}>{isTauri() ? t("backups_hint") : t("backups_web")}</p>
      {list && !list.length && <p class="empty-list">{t("backups_empty")}</p>}
      <div class="vlist">
        {list?.map((b) => {
          // file name: "2026-11-14 09-05-30 Project name"
          const m = /^(\d{4}-\d\d-\d\d) (\d\d)-(\d\d)-\d\d (.*)$/.exec(b.file);
          return (
            <div class="vrow">
              <span class="meta"><b>{m ? m[4] : b.file}</b><span class="num">{m ? `${m[1]} ${m[2]}:${m[3]}` : ""} · {(b.size / 1048576).toFixed(1)} MB</span></span>
              <button class="btn sm" onClick={async () => { onClose(); await openBackup(b.path, b.file); }}><Icon n="folder" />{t("open")}</button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** Shown on the home screen after the program stopped while a project was open. */
export function CrashNote({ list }: { list: ProjectMeta[] | null }) {
  const id = crashed.value;
  const m = id ? list?.find((x) => x.id === id) : undefined;
  if (!m) return null;
  return (
    <div class="crash" role="status">
      <Icon n="lifebuoy" />
      <span>{t("crash_note", { name: m.name })}</span>
      <button class="btn primary sm" onClick={() => { crashed.value = null; void openSaved(m.id); }}>{t("crash_open")}</button>
      <button class="ibtn ghost" aria-label={t("close")} onClick={() => (crashed.value = null)}><Icon n="close" /></button>
    </div>
  );
}
