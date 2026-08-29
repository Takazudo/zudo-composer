import { render } from "preact";
import "./style.css";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app mount point");

if (window.location.pathname.replace(/\/+$/, "") === "/composer/preview") {
  void import("./features/composer/preview/preview-entry").then(({ mountComposerPreview }) => mountComposerPreview(root));
} else {
  const { RESTORE_SCRIPT, RESIZER_SCRIPT } = await import("./features/composer/chrome/resizer-scripts-source");
  Function(RESTORE_SCRIPT)();
  const { App } = await import("./App");
  render(<App />, root);
  Function(RESIZER_SCRIPT)();
}
