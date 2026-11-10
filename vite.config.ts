import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { createHash } from "node:crypto";

// Writes sw.js after the build with the list of every built file, so the app
// works offline once it has been opened. No Workbox, no extra dependencies.
function offlineWorker(): Plugin {
  return {
    name: "tst-offline-worker",
    apply: "build",
    generateBundle(_opts, bundle) {
      // every browser that can install the app reads woff2, so the older .woff copies are skipped
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map") && !f.endsWith(".woff"));
      const extra = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/icon.svg"];
      const list = [...new Set([...extra, ...files])];
      const version = createHash("sha1").update(list.join("|")).digest("hex").slice(0, 10);
      const source = `const CACHE = "tst-motion-${version}";
const FILES = ${JSON.stringify(list)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => caches.match("index.html")))
  );
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [preact(), offlineWorker()],
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: "127.0.0.1", port: 5180 },
});
