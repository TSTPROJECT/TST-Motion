import { project } from "../model/store";
import { lang } from "../i18n";
import { Home } from "./Home";
import { Editor } from "./Editor";
import { ConfirmHost } from "./Dialogs";
import { toastMsg } from "./shell";

export function App() {
  lang.value; // re-render every word when the language changes
  const tm = toastMsg.value;
  return (
    <>
      {project.value ? <Editor key={project.value.id} /> : <Home />}
      <ConfirmHost />
      {tm && <div class={"toast" + (tm.err ? " err" : "")} role="status" key={tm.id}>{tm.text}</div>}
    </>
  );
}
