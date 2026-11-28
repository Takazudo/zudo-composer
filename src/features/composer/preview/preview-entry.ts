/// <reference path="../pack-config.d.ts" />
import { mountOwned } from "../../../runtime";
import ComposerPreviewApp from "./preview-app";
import { activeComponentProvider } from "../active-pack";
import "virtual:zudo-composer-host-styles";
import "./preview.css";

export function mountComposerPreview(root: Element): void {
  document.documentElement.setAttribute("data-composer-preview-doc", "");
  mountOwned(ComposerPreviewApp, { provider: activeComponentProvider }, { parent: root, name: "ComposerPreviewApp" });
}
