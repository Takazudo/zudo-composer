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
  return pathname.startsWith("/") ? `/site${pathname}` : pathname;
}

export function safeDeliveryHref(value: string): string | undefined {
  const unsafeCharacter = Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f || character === "\\";
  });
  if (value !== value.trim() || unsafeCharacter || value.startsWith("//")) return undefined;
  if (value.startsWith("#")) return value;
  if (value.startsWith("/")) return toSiteHref(value);
  let parsed: URL;
  try { parsed = new URL(value, "https://site-project.invalid/site/"); } catch { return undefined; }
  if (["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) return value;
  return undefined;
}

const normalizedHrefs = new WeakMap<HTMLAnchorElement, string>();

export function normalizeDeliveryLink(anchor: HTMLAnchorElement): string | undefined {
  const href = anchor.getAttribute("href");
  if (href === null) return undefined;
  if (normalizedHrefs.get(anchor) === href) return href;
  const safe = safeDeliveryHref(href);
  if (safe === undefined) { anchor.removeAttribute("href"); normalizedHrefs.delete(anchor); }
  else { if (safe !== href) anchor.setAttribute("href", safe); normalizedHrefs.set(anchor, safe); }
  return safe;
}

export function normalizeDeliveryLinks(root: ParentNode): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(".zc-prose-md a[href]")) normalizeDeliveryLink(anchor);
}

export function matchSiteRoute(routes: readonly SiteCompiledRoute[], pathname: string): SiteCompiledRoute | undefined {
  const routePath = siteRoutePathname(pathname);
  return routePath === null ? undefined : routes.find((route) => route.pathname === routePath);
}
