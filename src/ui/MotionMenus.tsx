// Timeline menus: the pose tools (copy, paste, mirror, library, loop) and one-click motions.
import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { signal } from "@preact/signals";
import { project, frame, selected, edit, applyPose, makeLoop, writeKey, mode, uid } from "../model/store";
import { poseValues, mirrorPose, family, type PoseValues } from "../model/poses";
import { applyPreset, PRESETS, type PresetId } from "../model/presets";
import { t, type Key } from "../i18n";
import { Icon } from "./icons";
import { toast } from "./shell";

const clip = signal<PoseValues | null>(null);

function Pop({ icon, label, children }: { icon: string; label: string; children: (close: () => void) => ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <span class="pop-wrap">
      <button class={"btn sm" + (open ? " on" : "")} aria-expanded={open} title={label} onClick={() => setOpen(!open)}><Icon n={icon} /><span class="hide-sm">{label}</span></button>
      {open && <>
        <div style={{ position: "fixed", inset: "0", zIndex: 39 }} onClick={() => setOpen(false)} />
        <div class="menu pop" role="menu">{children(() => setOpen(false))}</div>
      </>}
    </span>
  );
}

export function PoseMenu() {
  const [part, setPart] = useState(false); // only the selected part and what follows it
  const [name, setName] = useState("");
  const p = project.value; if (!p) return null;
  const scope = () => (part && selected.value ? family(p, selected.value) : undefined);
  const keyed = () => toast(mode.value === "setup" ? t("pose_done_setup") : t("pose_done", { n: frame.value }));
  return (
    <Pop icon="bookmark" label={t("poses")}>{(close) => <>
      <label class="row chk" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={part} disabled={!selected.value} onChange={() => setPart(!part)} />{t("pose_part_only")}</label>
      <button onClick={() => { clip.value = poseValues(p, frame.value, scope()); toast(t("pose_copied")); close(); }}><Icon n="copy" />{t("pose_copy")}</button>
      <button disabled={!clip.value} onClick={() => { applyPose(clip.value!); keyed(); close(); }}><Icon n="import" />{t("pose_paste")}</button>
      <button disabled={!clip.value} onClick={() => { applyPose(mirrorPose(p, clip.value!)); keyed(); close(); }}><Icon n="flip" />{t("pose_paste_mirror")}</button>
      <button onClick={() => { applyPose(mirrorPose(p, poseValues(p, frame.value, scope()))); keyed(); close(); }}><Icon n="flip" />{t("pose_mirror")}</button>
      <button onClick={() => { makeLoop(); toast(t("loop_done")); close(); }}><Icon n="loop" />{t("pose_loop")}</button>
      <hr />
      <div class="row" onClick={(e) => e.stopPropagation()}>
        <input class="field" value={name} maxLength={40} placeholder={t("pose_name")} aria-label={t("pose_name")} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <button class="btn sm" onClick={() => {
          const v = poseValues(p, frame.value, scope());
          edit((pp) => { (pp.poses ??= []).push({ id: uid(), name: name.trim() || t("pose_n", { n: (pp.poses?.length ?? 0) + 1 }), values: v }); });
          setName(""); toast(t("pose_saved"));
        }}>{t("save")}</button>
      </div>
      {!p.poses?.length && <p class="hint-s" style={{ padding: "4px 10px" }}>{t("pose_lib_empty")}</p>}
      {p.poses?.map((ps) => (
        <div class="row lib">
          <button class="grow" title={t("pose_apply")} onClick={() => { applyPose(ps.values); keyed(); close(); }}><Icon n="bookmark" />{ps.name}</button>
          <button class="ibtn ghost" title={t("pose_apply_mirror")} aria-label={t("pose_apply_mirror")} onClick={() => { applyPose(mirrorPose(p, ps.values)); keyed(); close(); }}><Icon n="flip" /></button>
          <button class="ibtn ghost" title={t("delete")} aria-label={t("delete")} onClick={(e) => { e.stopPropagation(); edit((pp) => { pp.poses = pp.poses?.filter((x) => x.id !== ps.id); }); }}><Icon n="trash" /></button>
        </div>
      ))}
    </>}</Pop>
  );
}

export function PresetMenu() {
  const [whole, setWhole] = useState(false);
  const p = project.value; if (!p) return null;
  return (
    <Pop icon="star" label={t("presets")}>{(close) => <>
      <p class="hint-s" style={{ padding: "4px 10px", maxWidth: "260px" }}>{t("presets_hint")}</p>
      <label class="row chk" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={whole} onChange={() => setWhole(!whole)} />{t("presets_whole")}</label>
      {PRESETS.map((id: PresetId) => (
        <button onClick={() => {
          let moved: string[] = [];
          edit((pp) => { moved = applyPreset(pp, id, frame.value, whole, selected.value, (l, ch, v, f, e) => writeKey(l, ch, v, f, e)); });
          if (!moved.length) toast(t("preset_none"), true); else toast(t("preset_done", { name: t(("pr_" + id) as Key), parts: moved.slice(0, 4).join(", ") }));
          close();
        }}><Icon n="star" />{t(("pr_" + id) as Key)}</button>
      ))}
    </>}</Pop>
  );
}
