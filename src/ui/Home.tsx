// Start screen: new project by frame size, open a file, recent projects.
import { useEffect, useState } from "preact/hooks";
import { listProjects, deleteProject, type ProjectMeta } from "../io/db";
import { lang, setLang, t } from "../i18n";
import { Icon } from "./icons";
import { toggleTheme, isDark, theme, installPrompt, installed, isIos, install, toast } from "./shell";
import { confirmBox } from "./Dialogs";
import { createProject, openSaved, openFile, pickFile } from "./open";

const PRESETS: Array<{ k: string; w: number; h: number; label: () => string }> = [
  { k: "9:16", w: 1080, h: 1920, label: () => t("preset_916") },
  { k: "16:9", w: 1920, h: 1080, label: () => t("preset_169") },
  { k: "1:1", w: 1080, h: 1080, label: () => t("preset_11") },
  { k: "4:5", w: 1080, h: 1350, label: () => "Instagram" },
];

export function TopToggles() {
  theme.value;
  return (
    <>
      <div class="seg" role="group" aria-label="Language">
        <button aria-pressed={lang.value === "th"} onClick={() => setLang("th")}>ไทย</button>
        <button aria-pressed={lang.value === "en"} onClick={() => setLang("en")}>EN</button>
      </div>
      <button class="ibtn" title={t("theme")} aria-label={t("theme")} onClick={toggleTheme}><Icon n={isDark() ? "sun" : "moon"} /></button>
    </>
  );
}

export function Home() {
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => listProjects().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);
  const run = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const canInstall = !installed.value && (installPrompt.value || isIos);

  return (
    <main class="home">
      <div class="home-in">
        <header class="home-top">
          <div class="brand">
            <img src="icons/icon.svg" alt="" />
            <div><h1>TST Motion</h1><p>{t("app_tag")}</p></div>
          </div>
          {canInstall && <button class="btn" onClick={async () => { if (installPrompt.value) await install(); else toast(t("install_ios")); }}><Icon n="install" />{t("install")}</button>}
          <TopToggles />
        </header>

        <section>
          <h2>{t("new_project")}</h2>
          <div class="presets">
            {PRESETS.map((p) => {
              const k = 58 / Math.max(p.w, p.h);
              return (
                <button class="preset" disabled={busy} onClick={() => run(() => createProject(p.w, p.h))}>
                  <span class="shape"><i style={{ width: `${p.w * k}px`, height: `${p.h * k}px` }} /></span>
                  <span><b>{p.k}</b> <span>· {p.label()}</span></span>
                  <span class="num">{p.w} × {p.h}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>{t("recent")}</h2>
            <button class="btn" disabled={busy} onClick={async () => { const [f] = await pickFile(".tstm,application/zip", false); if (f) run(() => openFile(f)); }}><Icon n="folder" />{t("open_file")}</button>
          </div>
          {list && list.length === 0 && <p class="empty-list">{t("no_recent")}</p>}
          <div class="recent">
            {list?.map((m) => (
              <div class="rcard" key={m.id}>
                <button class="open" disabled={busy} onClick={() => run(() => openSaved(m.id))}>
                  <span class="th">{m.thumb && <img src={m.thumb} alt="" />}</span>
                  <span class="meta"><b>{m.name}</b><span class="num">{m.w}×{m.h} · {t("layers_n", { n: m.layers })}</span><span>{new Date(m.modified).toLocaleString(lang.value === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></span>
                </button>
                <div class="acts">
                  <button class="ibtn ghost" title={t("delete")} aria-label={`${t("delete")} ${m.name}`} onClick={async () => { if (await confirmBox(t("confirm_delete_project", { name: m.name }), t("delete"))) { await deleteProject(m.id); refresh(); } }}><Icon n="trash" size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section class="note">
          <p>{t("storage_note")}</p>
          <p>{t("phase_note")} · MIT</p>
        </section>
      </div>
    </main>
  );
}
