import { render } from "preact";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app mount point");

let storedTheme: string | null = null;
try {
  storedTheme = globalThis.localStorage?.getItem("zudo-composer-theme") ?? null;
} catch {
  // Storage can be disabled; the OS preference remains authoritative.
}
const theme = storedTheme === "light" || storedTheme === "dark"
  ? storedTheme
  : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
document.documentElement.dataset.theme = theme;

if (window.location.pathname === "/composer/preview") {
  void import("./features/composer/preview/preview-entry").then(({ mountComposerPreview }) => mountComposerPreview(root));
} else {
  await import("./style.css");
  const { restoreComposerWidths, installComposerResizers } = await import("./features/composer/chrome/resizer-dom");
  restoreComposerWidths();
  const { App } = await import("./App");
  render(<App />, root);
  installComposerResizers();
}
