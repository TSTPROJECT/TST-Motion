import { render } from "preact";
import "@fontsource/anuphan/400.css";
import "@fontsource/anuphan/500.css";
import "@fontsource/anuphan/600.css";
import "@fontsource/anuphan/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "./styles.css";
import "./io/autosave";
import { App } from "./ui/App";

render(<App />, document.getElementById("root")!);

// Offline support: only in the built app, never while developing.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => { /* offline mode unavailable */ }); });
}
