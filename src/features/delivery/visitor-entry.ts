/// <reference path="../composer/pack-config.d.ts" />
import { h, render } from "preact";
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
export function mountSitePreview(root: Element, source: DeliverySourceContract, { hostedDemo = false }: SitePreviewOptions = {}): void {
  document.documentElement.setAttribute("data-site-preview-doc", "");
  const basePath = deliveryBasePath(source);
  let uninstall: (() => void) | undefined;
  const mount = (): void => { render(h(SiteDelivery, { source, pathname: window.location.pathname, hostedDemo, onReady }), root); };
  const onReady = (build: SiteBuildPlan): void => {
    uninstall?.();
    uninstall = installVisitorNavigation({ routes: build.routes.map(({ pathname }) => pathname), basePath, mount });
  };
  mount();
}
