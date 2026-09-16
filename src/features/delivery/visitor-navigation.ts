import { toDeliveryHref, type DeliveryBasePath } from "./routing";

export interface VisitorNavigationOptions {
  /** Compiled route pathnames, as the build records them before any base path. */
  routes: readonly string[];
  basePath: DeliveryBasePath;
  mount: () => void;
}

/**
 * In-place navigation for a visitor document, shared by the static site client
 * and the tool's preview entry. Only a plain left click on a compiled route
 * under this base path is taken over; a query string, a hash, a trailing
 * slash, an uploaded asset, another origin and every unknown address stay
 * ordinary browser navigations, so the preview cannot claim a page the
 * published site would have served from the server.
 */
export function installVisitorNavigation({ routes, basePath, mount }: VisitorNavigationOptions): () => void {
  const hrefs = new Set(routes.map((pathname) => toDeliveryHref(pathname, basePath)));
  const click = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || url.search || url.hash || !hrefs.has(url.pathname)) return;
    event.preventDefault();
    if (url.pathname !== window.location.pathname) {
      window.history.pushState(null, "", url);
      mount();
    }
    window.scrollTo(0, 0);
  };
  document.addEventListener("click", click);
  window.addEventListener("popstate", mount);
  return () => {
    document.removeEventListener("click", click);
    window.removeEventListener("popstate", mount);
  };
}
