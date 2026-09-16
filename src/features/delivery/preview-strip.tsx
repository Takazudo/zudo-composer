import { render, type JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { SiteCompiledRoute } from "../../site-project/compiler";
import { HOSTED_DEMO_NOTICE_COPY, HOSTED_DEMO_NOTICE_TITLE } from "./hosted-demo-notice-copy";
import { deliveryRoutePathname, toDeliveryHref, type DeliveryBasePath } from "./routing";
import stripStyles from "./preview-strip.css?inline";

export interface PreviewStripProps {
  label: string;
  basePath: DeliveryBasePath;
  pathname: string;
  hostedDemo: boolean;
  /** Only a ready build has routes to pick from; every other state omits them. */
  routes?: readonly SiteCompiledRoute[];
}

/**
 * A picked page is an in-place navigation, never a reload: the hosted demo's
 * preview document receives its project through a one-use `#demoPreview` token
 * that is consumed and stripped on arrival, so reloading this document would
 * silently drop the authored snapshot and fall back to the bundled public
 * sample. `installVisitorNavigation` owns the `popstate` re-mount for exactly
 * the routes this picker offers.
 */
function pickRoute(href: string): void {
  if (!href || href === window.location.pathname) return;
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

function StripContent({ label, basePath, pathname, hostedDemo, routes }: PreviewStripProps): JSX.Element {
  // Match through the compiler's own pathname so an equivalent address such as
  // `/site/` still selects the route it resolves to.
  const routePath = deliveryRoutePathname(pathname, basePath);
  const current = routes?.find((route) => route.pathname === routePath);
  return <>
    <span class="zc-preview-strip__label">{label}</span>
    {routes && <label class="zc-preview-strip__picker">
      Page
      <select
        class="zc-preview-strip__select"
        value={current ? toDeliveryHref(current.pathname, basePath) : ""}
        onChange={(event) => pickRoute(event.currentTarget.value)}
      >
        {routes.map((route) => <option key={route.pathname} value={toDeliveryHref(route.pathname, basePath)}>{route.displayTitle}</option>)}
      </select>
    </label>}
    {hostedDemo && <p class="zc-preview-strip__notice"><strong>{HOSTED_DEMO_NOTICE_TITLE}</strong> {HOSTED_DEMO_NOTICE_COPY}</p>}
  </>;
}

/**
 * The only tool-owned UI inside a preview document. Both the host stylesheet
 * and the component pack are untrusted and declare the same token names the
 * editor does, so the strip renders into an open shadow root that carries its
 * own reset and sheet rather than into the site's document tree.
 */
export function PreviewStrip(props: PreviewStripProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    if (!mount.current) {
      const shadow = node.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = stripStyles;
      const inner = document.createElement("div");
      inner.className = "zc-preview-strip__inner";
      shadow.append(style, inner);
      mount.current = inner;
    }
    render(<StripContent {...props} />, mount.current);
  });
  useLayoutEffect(() => () => { if (mount.current) render(null, mount.current); }, []);
  return <div class="zc-preview-strip" ref={host} />;
}
