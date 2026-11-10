import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The editor UI. It runs inside the desktop program (Tauri, see src-tauri/),
// which shows it in the system WebView (WebView2 on Windows).
export default defineConfig({
  base: "./",
  plugins: [preact()],
  clearScreen: false,
  build: { target: "chrome105", sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: "127.0.0.1", port: 5180, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
});
