// The editing screen: top bar, layers, canvas, properties, timeline.
import { useEffect, useState } from "preact/hooks";
import { effect } from "@preact/signals";
import { project, rev, frame, playing, loop, selected, mode, tool, tab, canUndo, canRedo, undo, redo, addLayers, edit, deleteLayer, duplicateLayer, toggleKeys, closeProject, type Mode, type Tab } from "../model/store";
import { importFiles, isProjectFile, ACCEPT } from "../io/assets";
import { exportProjectFile, safeFileName, saveBlobAs } from "../io/projectFile";
import { saving, saveNow } from "../io/autosave";
import { askPersistent } from "../io/db";
import { t } from "../i18n";
import { Icon } from "./icons";
import { Stage } from "./Stage";
import { LayersPanel } from "./LayersPanel";
import { PropsPanel } from "./PropsPanel";
import { Timeline } from "./Timeline";
import { SettingsDialog, settingsOpen, confirmBox } from "./Dialogs";
import { ExportDialog } from "./ExportDialog";
import { CutDialog, cutLayer } from "./CutDialog";
import { TopToggles } from "./Home";
import { toast, installPrompt, installed, install, isIos } from "./shell";
import { openFile, pickFile } from "./open";

async function importNow(files: File[]) {
  const p = project.value; if (!p || files.length === 0) return;
  const proj = files.find(isProjectFile);
  if (proj) { await saveNow(); await openFile(proj); return; }
  toast(t("importing"));
  const r = await importFiles(files, p);
  if (r.layers.length) {
    edit((pp) => { pp.assets.push(...r.assets); });
    addLayers(r.layers);
    toast(t("imported", { n: r.layers.length }));
  }
  if (r.failed.length) toast(t("import_failed", { names: r.failed.slice(0, 3).join(", ") }), true);
}
export const pickImages = async () => importNow(await pickFile(ACCEPT, true));

function openCut() {
  const l = project.value?.layers.find((x) => x.id === selected.value);
  if (!l?.asset) { toast(t("cut_need_image"), true); return; }
  playing.value = false; cutLayer.value = l.id;
}

async function saveFile() {
  const p = project.value; if (!p) return;
  const blob = await exportProjectFile(p);
  if (await saveBlobAs(blob, `${safeFileName(p.name)}.tstm`, "TST Motion project", ".tstm")) toast(t("file_saved"));
}

export function Editor() {
  rev.value;
  const p = project.value!;
  const [dropping, setDropping] = useState(false);
  const [menu, setMenu] = useState(false);
  const [exportInfo, setExportInfo] = useState(false);

  // playback
  useEffect(() => effect(() => {
    if (!playing.value) return;
    const pp = project.value!; let start = performance.now(), f0 = frame.value, raf = 0;
    if (f0 >= pp.frames - 1) f0 = 0;
    const tick = (now: number) => {
      const f = f0 + Math.floor(((now - start) / 1000) * pp.fps);
      if (f >= pp.frames) {
        if (!loop.value) { frame.value = pp.frames - 1; playing.value = false; return; }
        start = now; f0 = 0; frame.value = 0;
      } else if (f !== frame.value) frame.value = f;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }), []);

  // files: drop anywhere, paste images
  useEffect(() => {
    void askPersistent();
    let depth = 0;
    const has = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const enter = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth++; setDropping(true); };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!has(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDropping(false); };
    const drop = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth = 0; setDropping(false); void importNow([...(e.dataTransfer?.files ?? [])]); };
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea")) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); void importNow(files); }
    };
    window.addEventListener("dragenter", enter); window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave); window.addEventListener("drop", drop); window.addEventListener("paste", paste);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); window.removeEventListener("paste", paste); };
  }, []);

  // keyboard
  useEffect(() => {
    const k = async (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (tg?.closest?.("input, textarea, select") || document.querySelector(".overlay")) return;
      const ctrl = e.ctrlKey || e.metaKey, pp = project.value; if (!pp) return;
      const key = e.key.toLowerCase();
      if (ctrl && key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (ctrl && key === "y") { e.preventDefault(); redo(); return; }
      if (ctrl && key === "s") { e.preventDefault(); void saveFile(); return; }
      if (ctrl && key === "o") { e.preventDefault(); void pickImages(); return; }
      if (ctrl && key === "e") { e.preventDefault(); setExportInfo(true); return; }
      if (ctrl && key === "d") { e.preventDefault(); if (selected.value) duplicateLayer(selected.value); return; }
      if (ctrl) return;
      if (e.code === "Space") { e.preventDefault(); if (!e.repeat) playing.value = !playing.value; return; }
      if (key === "arrowleft") { e.preventDefault(); playing.value = false; frame.value = Math.max(0, frame.value - (e.shiftKey ? 10 : 1)); }
      else if (key === "arrowright") { e.preventDefault(); playing.value = false; frame.value = Math.min(pp.frames - 1, frame.value + (e.shiftKey ? 10 : 1)); }
      else if (key === "home") frame.value = 0;
      else if (key === "end") frame.value = pp.frames - 1;
      else if (key === "k" && selected.value) { mode.value = "animate"; toggleKeys(selected.value); }
      else if (key === "v") tool.value = "move";
      else if (key === "r") tool.value = "rotate";
      else if (key === "p") tool.value = "pivot";
      else if (key === "h") tool.value = "hand";
      else if (key === "c") openCut();
      else if (key === "escape") selected.value = null;
      else if ((key === "delete" || key === "backspace") && selected.value) {
        const l = pp.layers.find((x) => x.id === selected.value);
        if (l && (await confirmBox(t("confirm_delete_layer", { name: l.name }), t("delete")))) deleteLayer(l.id);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const setMode = (m: Mode) => { mode.value = m; toast(m === "setup" ? t("mode_setup_hint") : t("mode_animate_hint")); };
  const goHome = async () => { await saveNow(); closeProject(); };
  const setTab = (x: Tab) => (tab.value = x);

  return (
    <div class="app" data-tab={tab.value}>
      <header class="top">
        <div class="logo">
          <button class="homebtn" title={t("home")} aria-label={t("home")} onClick={goHome}><img src="icons/icon.svg" alt="" /></button>
          <div class="proj">
            <button title={t("settings")} onClick={() => (settingsOpen.value = true)}>{p.name}</button>
            <small class={saving.value ? "busy" : ""}>{saving.value ? t("saving") : t("saved_local")} · <span class="num">{p.w}×{p.h}</span></small>
          </div>
        </div>
        <div class="seg modeseg" role="group" aria-label="Mode">
          <button aria-pressed={mode.value === "setup"} title={t("mode_setup_hint")} onClick={() => setMode("setup")}>{t("mode_setup")}</button>
          <button class="anim" aria-pressed={mode.value === "animate"} title={t("mode_animate_hint")} onClick={() => setMode("animate")}>{t("mode_animate")}</button>
        </div>
        <button class="ibtn ghost" title={t("undo")} aria-label={t("undo")} disabled={!canUndo.value} onClick={undo}><Icon n="undo" /></button>
        <button class="ibtn ghost hide-sm" title={t("redo")} aria-label={t("redo")} disabled={!canRedo.value} onClick={redo}><Icon n="redo" /></button>
        <button class="btn hide-sm" onClick={pickImages}><Icon n="import" />{t("import")}</button>
        <button class="btn primary hide-sm" onClick={() => setExportInfo(true)}><Icon n="export" />{t("export")}</button>
        <div class="menu-wrap">
          <button class="ibtn" title={t("more")} aria-label={t("more")} aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon n="more" /></button>
          {menu && (
            <>
              <div style={{ position: "fixed", inset: "0", zIndex: 39 }} onClick={() => setMenu(false)} />
              <div class="menu" role="menu" onClick={() => setMenu(false)}>
                <button onClick={pickImages}><Icon n="import" />{t("import")}</button>
                <button onClick={() => setExportInfo(true)}><Icon n="export" />{t("export")}</button>
                <button onClick={openCut}><Icon n="scissors" />{t("cut_open")}</button>
                <button onClick={redo} disabled={!canRedo.value}><Icon n="redo" />{t("redo")}</button>
                <hr />
                <button onClick={saveFile}><Icon n="save" />{t("save_file")}</button>
                <button onClick={async () => { const [f] = await pickFile(".tstm,application/zip", false); if (f) { await saveNow(); await openFile(f); } }}><Icon n="folder" />{t("open_file")}</button>
                <button onClick={() => (settingsOpen.value = true)}><Icon n="settings" />{t("settings")}</button>
                {!installed.value && (installPrompt.value || isIos) && <button onClick={async () => { if (installPrompt.value) await install(); else toast(t("install_ios")); }}><Icon n="install" />{t("install")}</button>}
                <hr />
                <div class="row" onClick={(e) => e.stopPropagation()}><TopToggles /></div>
                <button onClick={goHome}><Icon n="home" />{t("home")}</button>
              </div>
            </>
          )}
        </div>
      </header>

      <div class="work">
        <LayersPanel />
        <Stage onImport={pickImages} dropping={dropping} />
        <div class="seg tabs" role="tablist">
          {(["tl", "layers", "props"] as Tab[]).map((x) => (
            <button role="tab" aria-pressed={tab.value === x} aria-selected={tab.value === x} onClick={() => setTab(x)}>{t(x === "tl" ? "timeline" : x === "layers" ? "layers" : "props")}</button>
          ))}
        </div>
        <PropsPanel />
      </div>
      <Timeline />

      {settingsOpen.value && <SettingsDialog />}
      {exportInfo && <ExportDialog onClose={() => setExportInfo(false)} />}
      {cutLayer.value && <CutDialog key={cutLayer.value} />}
    </div>
  );
}
