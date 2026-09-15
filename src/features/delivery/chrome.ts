import type { SiteCompiledRoute } from "../../site-project/compiler";
import type { SitemapDocument, SitemapNode } from "../../sitemapper/model/types";
import { resolveSitemapNavigation } from "../../sitemapper/routes/navigation";
import { toDeliveryHref, type DeliveryBasePath } from "./routing";

export interface DeliveryChromeItem { id: string; title: string; href: string; active: boolean; current: boolean; external?: boolean }
export function sitemapChain(document: SitemapDocument, nodeId: string): readonly SitemapNode[] {
  const visit = (nodes: readonly SitemapNode[], ancestors: readonly SitemapNode[]): readonly SitemapNode[] | undefined => {
    for (const node of nodes) { const chain = [...ancestors, node]; if (node.id === nodeId) return chain; const nested = visit(node.children, chain); if (nested) return nested; }
    return undefined;
  };
  return visit(document.root, []) ?? [];
}
function menuItems(document: SitemapDocument, routes: readonly SiteCompiledRoute[], menu: "primary" | "footer", activeNodeId: string, activePathname?: string, basePath: DeliveryBasePath = "/site"): readonly DeliveryChromeItem[] {
  const derived = routes.map((route) => ({ pathname: route.pathname, nodeId: route.sitemapNode.id, sourceKind: route.source.kind, displayTitle: route.displayTitle, selectedEntry: route.selectedEntry, ancestors: route.ancestors }));
  const result = resolveSitemapNavigation(document.navigation, derived);
  const current = routes.find((route) => route.sitemapNode.id === activeNodeId && route.pathname === activePathname);
  const activePaths = new Set([activePathname, ...(current?.ancestors.map(({ pathname }) => pathname) ?? [])]);
  return result[menu].map((item) => ({ id: item.id, title: item.label, href: item.external ? item.href : toDeliveryHref(item.href, basePath), external: item.external, active: !item.external && activePaths.has(item.href), current: !item.external && item.href === activePathname }));
}
export function primaryNavigation(document: SitemapDocument, routes: readonly SiteCompiledRoute[], activeNodeId: string, activePathname?: string, basePath: DeliveryBasePath = "/site"): readonly DeliveryChromeItem[] {
  return menuItems(document, routes, "primary", activeNodeId, activePathname, basePath);
}
export function footerNavigation(document: SitemapDocument, routes: readonly SiteCompiledRoute[], activeNodeId: string, activePathname?: string, basePath: DeliveryBasePath = "/site"): readonly DeliveryChromeItem[] {
  return menuItems(document, routes, "footer", activeNodeId, activePathname, basePath);
}
export function breadcrumbs(_document: SitemapDocument, routes: readonly SiteCompiledRoute[], activeNodeId: string, activePathname?: string, basePath: DeliveryBasePath = "/site"): readonly DeliveryChromeItem[] {
  const matches = routes.filter((route) => route.sitemapNode.id === activeNodeId && (activePathname === undefined || route.pathname === activePathname));
  if (matches.length !== 1) return [];
  const active = matches[0]!;
  return [...active.ancestors, { nodeId: activeNodeId, pathname: active.pathname, displayTitle: active.displayTitle }].flatMap((part) => {
    const concrete = routes.filter((route) => route.sitemapNode.id === part.nodeId && route.pathname === part.pathname);
    return concrete.length !== 1 ? [] : [{ id: part.nodeId, title: concrete[0]!.displayTitle, href: toDeliveryHref(part.pathname, basePath), active: part.pathname === active.pathname, current: part.pathname === active.pathname }];
  });
}
