import { h, render } from "preact";
import ComposerPreviewApp from "./preview-app";
import { COMPOSER_PREVIEW_CSS, COMPOSER_PREVIEW_DOC_ATTR } from "./preview-styles";
import { activeComponentProvider } from "../active-pack";

export function mountComposerPreview(root: Element): void {
  document.documentElement.setAttribute(COMPOSER_PREVIEW_DOC_ATTR, "");
  const style = document.createElement("style");
  style.dataset.composerPreviewStyles = "";
  style.textContent = COMPOSER_PREVIEW_CSS;
  document.head.append(style);
  render(h(ComposerPreviewApp, { provider: activeComponentProvider }), root);
}
