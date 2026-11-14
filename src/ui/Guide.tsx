// First-run guide: a few short steps that point at the buttons that matter. Opens once by itself,
// and again from the menu.
import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { t, type Key } from "../i18n";
import { Icon } from "./icons";

const DONE = "tstm-guide-done";
interface Step { k: string; target?: string }
const STEPS: Step[] = [
  { k: "welcome" },
  { k: "import", target: "import" },
  { k: "cut", target: "cut" },
  { k: "mode", target: "mode" },
  { k: "animate", target: "timeline" },
  { k: "export", target: "export" },
  { k: "more", target: "more" },
];
export const guideStep = signal<number | null>(null);
export function startGuide() { guideStep.value = 0; }
/** Open by itself the first time the editor is shown. */
export function guideFirstRun() {
  try { if (localStorage.getItem(DONE)) return; } catch { return; }
  setTimeout(() => { if (guideStep.value === null) guideStep.value = 0; }, 700);
}
function end() { guideStep.value = null; try { localStorage.setItem(DONE, "1"); } catch { /* ignore */ } }

export function Guide() {
  const i = guideStep.value;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = i === null ? null : STEPS[i];
  useEffect(() => {
    if (!step?.target) { setRect(null); return; }
    const find = () => {
      const el = [...document.querySelectorAll<HTMLElement>(`[data-guide="${step.target}"]`)].find((e) => e.offsetParent !== null);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    find();
    const id = setInterval(find, 400); window.addEventListener("resize", find);
    return () => { clearInterval(id); window.removeEventListener("resize", find); };
  }, [step?.target]);
  useEffect(() => {
    if (i === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); end(); } };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, [i === null]);
  if (i === null || !step) return null;

  // the card sits below the button, or above it when there is no room
  const W = Math.min(340, innerWidth - 24);
  let style: Record<string, string> = { left: `${(innerWidth - W) / 2}px`, top: `${Math.max(24, innerHeight / 2 - 120)}px`, width: `${W}px` };
  if (rect) {
    const left = Math.max(12, Math.min(innerWidth - W - 12, rect.left + rect.width / 2 - W / 2));
    const below = rect.bottom + 14, roomBelow = innerHeight - below;
    style = roomBelow > 230 ? { left: `${left}px`, top: `${below}px`, width: `${W}px` } : { left: `${left}px`, bottom: `${innerHeight - rect.top + 14}px`, width: `${W}px` };
  }
  const last = i === STEPS.length - 1;
  return (
    <>
      {rect && <div class="guide-ring" style={{ left: `${rect.left - 6}px`, top: `${rect.top - 6}px`, width: `${rect.width + 12}px`, height: `${rect.height + 12}px` }} />}
      <div class="guide-card" role="dialog" aria-label={t("guide_title")} style={style}>
        <div class="guide-h"><b>{t(`guide_${step.k}_t` as Key)}</b><span class="num muted">{i + 1}/{STEPS.length}</span></div>
        <p>{t(`guide_${step.k}` as Key)}</p>
        <div class="guide-dots" aria-hidden="true">{STEPS.map((_, j) => <i class={j === i ? "on" : ""} />)}</div>
        <div class="guide-btns">
          <button class="btn sm ghost" onClick={end}>{t("guide_skip")}</button>
          <span style={{ flex: "1" }} />
          {i > 0 && <button class="btn sm" onClick={() => (guideStep.value = i - 1)}><Icon n="left" />{t("guide_back")}</button>}
          <button class="btn sm primary" onClick={() => (last ? end() : (guideStep.value = i + 1))}>{last ? t("guide_done") : t("guide_next")}{!last && <Icon n="right" />}</button>
        </div>
      </div>
    </>
  );
}
