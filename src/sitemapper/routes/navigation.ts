import type { SitemapEntryRef, SitemapNavigation, SitemapNavigationDestination } from "../model";
import { safeNavigationUrl } from "../model/validate";
import type { DerivedSitemapRoute } from "./types";
export interface ResolvedSitemapNavigationItem { id: string; label: string; href: string; external: boolean; nodeId?: string }
export interface SitemapNavigationDiagnostic { code: "navigation-stale" | "navigation-ambiguous" | "navigation-unsafe"; menu: "primary" | "footer"; itemId: string; message: string }
export interface ResolvedSitemapNavigation { primary: ResolvedSitemapNavigationItem[]; footer: ResolvedSitemapNavigationItem[]; diagnostics: SitemapNavigationDiagnostic[] }
function indexRoutes(routes: readonly DerivedSitemapRoute[]) {
  const byNode = new Map<string, DerivedSitemapRoute[]>(), paths = new Map<string, number>();
  for (const route of routes) {
    const siblings = byNode.get(route.nodeId) ?? []; siblings.push(route); byNode.set(route.nodeId, siblings);
    paths.set(route.pathname, (paths.get(route.pathname) ?? 0) + 1);
  }
  return { byNode, paths };
}
export function sameSitemapEntry(a: SitemapEntryRef | undefined, b: SitemapEntryRef | undefined): boolean {
  return a === undefined ? b === undefined : b !== undefined && a.providerId === b.providerId && a.modelId === b.modelId && a.recordId === b.recordId;
}
function resolveDestination(destination: SitemapNavigationDestination, index: ReturnType<typeof indexRoutes>):
  | { status: "resolved"; href: string; external: boolean; nodeId?: string }
  | { status: "stale" | "ambiguous" | "unsafe" } {
  if (destination.kind === "external") return safeNavigationUrl(destination.url) ? { status: "resolved", href: destination.url, external: true } : { status: "unsafe" };
  const matches = (index.byNode.get(destination.nodeId) ?? []).filter((route) => (destination.entry === undefined || sameSitemapEntry(route.selectedEntry, destination.entry))
    && (destination.ancestors === undefined || (() => {
      const ancestors = route.ancestors.filter((ancestor) => ancestor.selectedEntry);
      return ancestors.length === destination.ancestors.length && ancestors.every((ancestor, index) => ancestor.nodeId === destination.ancestors![index]!.nodeId && sameSitemapEntry(ancestor.selectedEntry, destination.ancestors![index]!.entry));
    })()));
  if (!matches.length) return { status: "stale" };
  if (matches.length !== 1 || index.paths.get(matches[0]!.pathname) !== 1) return { status: "ambiguous" };
  return { status: "resolved", href: matches[0]!.pathname, external: false, nodeId: matches[0]!.nodeId };
}
export function resolveSitemapDestination(destination: SitemapNavigationDestination, routes: readonly DerivedSitemapRoute[]) {
  return resolveDestination(destination, indexRoutes(routes));
}
export function resolveSitemapNavigation(navigation: SitemapNavigation, routes: readonly DerivedSitemapRoute[]): ResolvedSitemapNavigation {
  const output: ResolvedSitemapNavigation = { primary: [], footer: [], diagnostics: [] };
  const index = indexRoutes(routes);
  for (const menu of ["primary", "footer"] as const) for (const item of navigation[menu]) {
    if (!item.visible) continue;
    const target = resolveDestination(item.destination, index);
    if (target.status !== "resolved") output.diagnostics.push({ code: `navigation-${target.status}`, menu, itemId: item.id, message: `Navigation item "${item.label}" has a ${target.status} destination.` });
    else output[menu].push({ id: item.id, label: item.label, href: target.href, external: target.external, ...(target.nodeId ? { nodeId: target.nodeId } : {}) });
  }
  return output;
}
