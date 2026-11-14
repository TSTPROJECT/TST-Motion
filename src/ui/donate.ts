// The donate link: opens in the user's own browser (the program never handles money).
import { isTauri } from "@tauri-apps/api/core";

export const DONATE_URL = "https://buymeacoffee.com/xxxzas12p";
export async function openDonate() {
  if (isTauri()) {
    try { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(DONATE_URL); return; } catch { /* fall through */ }
  }
  window.open(DONATE_URL, "_blank", "noopener");
}
