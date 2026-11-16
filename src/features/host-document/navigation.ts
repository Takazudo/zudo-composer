/** Only an exact captured path or its single directory trailing-slash alias. */
export function canonicalHostRoute(pathname: string, pathnames: readonly string[]): string | null {
  if (pathnames.includes(pathname)) return pathname;
  if (pathname === "/" || !pathname.startsWith("/") || pathname.endsWith("//")) return null;
  const stem = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  // File outputs (notably /404.html) do not have directory aliases.
  if (/\.[^/]+$/.test(stem)) return null;
  const alias = pathname.endsWith("/") ? stem : `${pathname}/`;
  return pathnames.includes(alias) ? alias : null;
}
