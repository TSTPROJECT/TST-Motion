import { render } from "preact";
import "@fontsource/anuphan/400.css";
import "@fontsource/anuphan/500.css";
import "@fontsource/anuphan/600.css";
import "@fontsource/anuphan/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "./styles.css";
import "./fonts.css";
import "./io/autosave";
import { App } from "./ui/App";
import { openStartupFile } from "./ui/open";

render(<App />, document.getElementById("root")!);
// Opened by double-clicking a .tstm file in Explorer
void openStartupFile();
