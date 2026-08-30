import type { SiteCompiledRoute } from "../../site-project/compiler";

export function isSitePath(pathname: string): boolean {
  return pathname === "/site" || pathname === "/site/" || pathname.startsWith("/site/");
}

/** Strip one exact delivery boundary without decoding or normalizing URL bytes. */
export function siteRoutePathname(pathname: string): string | null {
  if (pathname === "/site" || pathname === "/site/") return "/";
  return pathname.startsWith("/site/") ? pathname.slice(5) : null;
}

export function toSiteHref(pathname: string): string {
  if (pathname === "/") return "/site";
  if (pathname === "/site" || pathname.startsWith("/site/")) return pathname;
  return pathname.startsWith("/") ? `/site${pathname}` : pathname;
}

export function safeDeliveryHref(value: string): string | undefined {
  if (value !== value.trim() || value.startsWith("//")) return undefined;
  if (value.startsWith("#") || value.startsWith("mailto:") || value.startsWith("tel:")) return value;
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(value)) return value;
  if (value.startsWith("/")) return toSiteHref(value);
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return undefined;
  return value;
}

export function matchSiteRoute(routes: readonly SiteCompiledRoute[], pathname: string): SiteCompiledRoute | undefined {
  const routePath = siteRoutePathname(pathname);
  return routePath === null ? undefined : routes.find((route) => route.pathname === routePath);
}
