import { h, render } from "preact";
import ComposerPreviewApp from "./preview-app";
import { activeComponentProvider } from "../active-pack";
import "../../../base.css";
import "./preview.css";

export function mountComposerPreview(root: Element): void {
  document.documentElement.setAttribute("data-composer-preview-doc", "");
  render(h(ComposerPreviewApp, { provider: activeComponentProvider }), root);
}
