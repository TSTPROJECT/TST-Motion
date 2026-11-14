// Timeline key commands (buttons and shortcuts share these).
import { project, frame, selected, edit } from "../model/store";
import { selKeys, setSel, clearSel, copyKeys, pasteKeys, deleteKeys, shiftKeys, hasClip } from "../model/keysel";
import { t } from "../i18n";
import { toast } from "./shell";

export function copySel(): number {
  const p = project.value; if (!p || !selKeys.value.size) return 0;
  const n = copyKeys(p, selKeys.value); if (n) toast(t("keys_copied", { n }));
  return n;
}
export function pasteSel() {
  if (!hasClip.value || !project.value) return;
  let out = new Set<string>();
  edit((pp) => { out = pasteKeys(pp, frame.value, selected.value); });
  if (out.size) { setSel(out); toast(t("keys_pasted", { n: out.size })); } else toast(t("keys_paste_none"), true);
}
export function deleteSel() {
  const sel = selKeys.value, n = sel.size; if (!n) return;
  edit((pp) => deleteKeys(pp, sel)); clearSel();
  toast(t("keys_deleted", { n }));
}
/** Move the picked keys by d frames; the playhead follows. */
export function nudgeSel(d: number) {
  const sel = selKeys.value; if (!sel.size || !d) return;
  let out = sel;
  edit((pp) => { out = shiftKeys(pp, sel, d); });
  setSel(out);
}
