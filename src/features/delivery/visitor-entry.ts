/// <reference path="../composer/pack-config.d.ts" />
import { attachNativeAuthoringState } from "../native-editing/session";
import { signal } from "@takazudo/zfb/zudo-react";
import { mountOwned } from "../../runtime";
import type { SiteBuildPlan } from "../../site-project/compiler";
import { SiteDelivery } from "./site-delivery";
import { deliveryBasePath, type DeliverySourceContract } from "./source";
import { installVisitorNavigation } from "./visitor-navigation";
import "virtual:zudo-composer-host-styles";
import "./visitor.css";

export interface SitePreviewOptions {
  hostedDemo?: boolean;
}

/**
 * Mounts `/site*` and `/website-preview*` as their own visitor document: the
 * host's stylesheet and the tool's visitor sheet, and nothing of the editor's
 * chrome. The editor's stored theme preference is deliberately not applied —
 * like the published site this document follows the OS through the pack's own
 * `light-dark()`.
 */
export function mountSitePreview(container: Element, source: DeliverySourceContract, { hostedDemo = false }: SitePreviewOptions = {}): void {
  if (source.kind === "working-preview") attachNativeAuthoringState(() => source.providers.sessions.hasPending, async () => (await source.providers.sessions.flush()).status === "ready");
  document.documentElement.setAttribute("data-site-preview-doc", "");
  const basePath = deliveryBasePath(source);
  let uninstall: (() => void) | undefined;
  // One root for the document's life: in-place navigation moves the address
  // signal, so the delivery snapshot is never reloaded for a page change.
  const pathname = signal(window.location.pathname);
  const mount = (): void => { pathname.value = window.location.pathname; };
  const onReady = (build: SiteBuildPlan): void => {
    uninstall?.();
    uninstall = installVisitorNavigation({ routes: build.routes.map(({ pathname: route }) => route), basePath, mount });
  };
  const root = mountOwned(SiteDelivery, { source, pathname, hostedDemo, onReady }, { parent: container, name: "SiteDelivery" });
  if (!root.handle) throw new Error(`Site delivery could not mount (${root.diagnostics.map(({ code }) => code).join(", ") || "no diagnostic"}).`);
}
