import type { SiteCompiledRoute } from "../../site-project/compiler";

export function isSitePath(pathname: string): boolean {
  return pathname === "/site" || pathname === "/site/" || pathname.startsWith("/site/");
}
export function isWorkingPreviewPath(pathname: string): boolean { return pathname === "/website-preview" || pathname === "/website-preview/" || pathname.startsWith("/website-preview/"); }

/** Strip one exact delivery boundary without decoding or normalizing URL bytes. */
export function siteRoutePathname(pathname: string): string | null {
  if (pathname === "/site" || pathname === "/site/") return "/";
  return pathname.startsWith("/site/") ? pathname.slice(5) : null;
}

export function toSiteHref(pathname: string): string {
  return toDeliveryHref(pathname, "/site");
}
export function toDeliveryHref(pathname: string, basePath: "/site" | "/website-preview"): string { if (pathname === "/") return basePath; return pathname.startsWith("/") ? `${basePath}${pathname}` : pathname; }
export function deliveryRoutePathname(pathname: string, basePath: "/site" | "/website-preview"): string | null { if (pathname === basePath || pathname === `${basePath}/`) return "/"; return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : null; }

const DELIVERY_BASE_URL = "https://site-project.invalid/site/";

function isCanonicalUploadedMediaHref(value: string): boolean {
  if (!value.startsWith("/uploaded-media/")) return false;
  try {
    const parsed = new URL(value, DELIVERY_BASE_URL);
    return parsed.origin === "https://site-project.invalid" && parsed.pathname.startsWith("/uploaded-media/");
  } catch {
    return false;
  }
}

export function safeDeliveryHref(value: string, basePath: "/site" | "/website-preview" = "/site"): string | undefined {
  const unsafeCharacter = Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f || character === "\\";
  });
  if (value !== value.trim() || unsafeCharacter || value.startsWith("//")) return undefined;
  if (value.startsWith("#")) return value;
  if (isCanonicalUploadedMediaHref(value)) return value;
  if (value.startsWith("/")) return toDeliveryHref(value, basePath);
  let parsed: URL;
  try { parsed = new URL(value, DELIVERY_BASE_URL); } catch { return undefined; }
  if (["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) return value;
  return undefined;
}

const normalizedHrefs = new WeakMap<HTMLAnchorElement, string>();

export function normalizeDeliveryLink(anchor: HTMLAnchorElement, basePath: "/site" | "/website-preview" = "/site"): string | undefined {
  const href = anchor.getAttribute("href");
  if (href === null) return undefined;
  if (normalizedHrefs.get(anchor) === href) return href;
  const safe = safeDeliveryHref(href, basePath);
  if (safe === undefined) { anchor.removeAttribute("href"); normalizedHrefs.delete(anchor); }
  else { if (safe !== href) anchor.setAttribute("href", safe); normalizedHrefs.set(anchor, safe); }
  return safe;
}

export function normalizeDeliveryLinks(root: ParentNode, basePath: "/site" | "/website-preview" = "/site"): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(".zc-prose-md a[href]")) normalizeDeliveryLink(anchor, basePath);
}

export function matchSiteRoute(routes: readonly SiteCompiledRoute[], pathname: string): SiteCompiledRoute | undefined {
  const routePath = deliveryRoutePathname(pathname, "/site");
  return routePath === null ? undefined : routes.find((route) => route.pathname === routePath);
}
export function matchDeliveryRoute(routes: readonly SiteCompiledRoute[], pathname: string, basePath: "/site" | "/website-preview"): SiteCompiledRoute | undefined { const routePath = deliveryRoutePathname(pathname, basePath); return routePath === null ? undefined : routes.find((route) => route.pathname === routePath); }
