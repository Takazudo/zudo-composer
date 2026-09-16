import { render, type JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { SiteCompiledRoute } from "../../site-project/compiler";
import { HOSTED_DEMO_NOTICE_COPY, HOSTED_DEMO_NOTICE_TITLE } from "./hosted-demo-notice-copy";
import { toDeliveryHref, type DeliveryBasePath } from "./routing";
import stripStyles from "./preview-strip.css?inline";

export interface PreviewStripProps {
  label: string;
  basePath: DeliveryBasePath;
  pathname: string;
  hostedDemo: boolean;
  /** Only a ready build has routes to pick from; every other state omits them. */
  routes?: readonly SiteCompiledRoute[];
}

function StripContent({ label, basePath, pathname, hostedDemo, routes }: PreviewStripProps): JSX.Element {
  const current = routes?.find((route) => toDeliveryHref(route.pathname, basePath) === pathname);
  return <>
    <span class="zc-preview-strip__label">{label}</span>
    {routes && <label class="zc-preview-strip__picker">
      Page
      <select
        class="zc-preview-strip__select"
        value={current ? toDeliveryHref(current.pathname, basePath) : ""}
        onChange={(event) => { const href = event.currentTarget.value; if (href) window.location.assign(href); }}
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
