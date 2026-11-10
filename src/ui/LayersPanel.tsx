// List of parts, front to back.
import { useState } from "preact/hooks";
import { project, rev, selected, deleteLayer, duplicateLayer, moveLayer, renameLayer, toggleFlag } from "../model/store";
import { getLoaded, assetsVersion } from "../io/assets";
import { t } from "../i18n";
import { Icon } from "./icons";
import { confirmBox } from "./Dialogs";

export function LayersPanel() {
  const [editing, setEditing] = useState<string | null>(null);
  rev.value; assetsVersion();
  const p = project.value; if (!p) return null;
  const sel = selected.value, idx = p.layers.findIndex((l) => l.id === sel);
  const name = (id: string | null) => p.layers.find((l) => l.id === id)?.name ?? "";
  const list = [...p.layers].reverse();

  return (
    <aside class="card pane pane-layers" aria-label={t("layers")}>
      <div class="pane-h">
        <h2>{t("layers")} <span class="muted num" style={{ fontWeight: 400, fontSize: "12px" }}>{p.layers.length}</span></h2>
        <div class="acts">
          <button class="ibtn ghost" title={t("bring_front")} aria-label={t("bring_front")} disabled={idx < 0 || idx === p.layers.length - 1} onClick={() => sel && moveLayer(sel, 1)}><Icon n="up" /></button>
          <button class="ibtn ghost" title={t("send_back")} aria-label={t("send_back")} disabled={idx <= 0} onClick={() => sel && moveLayer(sel, -1)}><Icon n="down" /></button>
          <button class="ibtn ghost" title={t("duplicate")} aria-label={t("duplicate")} disabled={!sel} onClick={() => sel && duplicateLayer(sel)}><Icon n="copy" /></button>
          <button class="ibtn ghost" title={t("delete")} aria-label={t("delete")} disabled={!sel} onClick={async () => { if (sel && (await confirmBox(t("confirm_delete_layer", { name: name(sel) }), t("delete")))) deleteLayer(sel); }}><Icon n="trash" /></button>
        </div>
      </div>
      <div class="scroll">
        {list.length === 0 ? <p class="layers-empty">{t("empty_body")}</p> : (
          <div class="layers" role="listbox" aria-label={t("layers")}>
            {list.map((l) => {
              const url = l.asset ? getLoaded(l.asset)?.url : undefined;
              return (
                <div key={l.id} role="option" aria-selected={l.id === sel} class={"lyr" + (l.id === sel ? " sel" : "") + (l.visible ? "" : " off")} onClick={() => (selected.value = l.id)} onDblClick={() => setEditing(l.id)}>
                  <span class="th">{url && <img src={url} alt="" draggable={false} />}</span>
                  <span class="tx">
                    {editing === l.id ? (
                      <span class="nm"><input autoFocus defaultValue={l.name} aria-label={t("rename")}
                        onBlur={(e) => { renameLayer(l.id, (e.target as HTMLInputElement).value); setEditing(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} /></span>
                    ) : <span class="nm" title={l.name}>{l.name}</span>}
                    {l.parent && <span class="sub">↳ {name(l.parent)}</span>}
                  </span>
                  <button class="ibtn ghost" title={t("lock")} aria-label={t("lock")} aria-pressed={l.locked} onClick={(e) => { e.stopPropagation(); toggleFlag(l.id, "locked"); }} style={{ opacity: l.locked ? 1 : 0.55 }}><Icon n={l.locked ? "lock" : "unlock"} size={16} /></button>
                  <button class="ibtn ghost" title={t("show_hide")} aria-label={t("show_hide")} aria-pressed={!l.visible} onClick={(e) => { e.stopPropagation(); toggleFlag(l.id, "visible"); }}><Icon n={l.visible ? "eye" : "eyeoff"} size={16} /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
