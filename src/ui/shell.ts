// Small app-wide helpers: toasts, theme, install prompt.
import { signal } from "@preact/signals";

export const toastMsg = signal<{ text: string; err?: boolean; id: number } | null>(null);
let tm = 0;
export function toast(text: string, err = false) {
  toastMsg.value = { text, err, id: Date.now() };
  clearTimeout(tm); tm = window.setTimeout(() => (toastMsg.value = null), err ? 5000 : 2800);
}

type Theme = "light" | "dark" | null;
const read = (): Theme => { try { const v = localStorage.getItem("tstm-theme"); return v === "light" || v === "dark" ? v : null; } catch { return null; } };
export const theme = signal<Theme>(read());
function applyTheme() {
  const v = theme.value;
  if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
  const dark = isDark();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0c0e13" : "#eceef3");
}
export function isDark() { return theme.value ? theme.value === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
export function toggleTheme() {
  theme.value = isDark() ? "light" : "dark";
  try { localStorage.setItem("tstm-theme", theme.value); } catch { /* ignore */ }
  applyTheme();
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { theme.value = theme.value; applyTheme(); });

// "Install app" button: Chrome/Edge/Android give us a prompt; iPhone needs instructions.
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
export const installPrompt = signal<BIP | null>(null);
export const installed = signal(matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt.value = e as BIP; });
window.addEventListener("appinstalled", () => { installed.value = true; installPrompt.value = null; });
export const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export async function install() {
  const p = installPrompt.value; if (!p) return false;
  await p.prompt(); const r = await p.userChoice; installPrompt.value = null;
  return r.outcome === "accepted";
}
