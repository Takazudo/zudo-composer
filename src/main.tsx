import { render } from "preact";
import { bootstrapTheme, createThemeController } from "./theme/theme";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app mount point");

// This is deliberately synchronous and precedes every CSS import, including
// direct route refreshes. The isolated preview later accepts only its host's
// resolved light/dark session value and does not install host-side listeners.
const initialTheme = bootstrapTheme();

if (window.location.pathname === "/composer/preview") {
  void import("./features/composer/preview/preview-entry").then(({ mountComposerPreview }) => mountComposerPreview(root));
} else {
  const themeController = createThemeController(initialTheme);
  import.meta.hot?.dispose(() => themeController.dispose());
  await import("./style.css");
  const { App } = await import("./App");
  render(<App themeController={themeController} />, root);
}
