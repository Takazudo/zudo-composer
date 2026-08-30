import type { SiteCompiledRoute } from "../../site-project/compiler";
import type { SitemapDocument, SitemapNode } from "../../sitemapper/model/types";
import { toSiteHref } from "./routing";

export interface DeliveryChromeItem { id: string; title: string; href: string; active: boolean; current: boolean }

function readyPath(routes: readonly SiteCompiledRoute[], nodeId: string, activePathname?: string): string | undefined {
  return routes.find((route) => route.sitemapNode.id === nodeId && route.pathname === activePathname)?.pathname
    ?? routes.find((route) => route.sitemapNode.id === nodeId)?.pathname;
}

export function sitemapChain(document: SitemapDocument, nodeId: string): readonly SitemapNode[] {
  const visit = (nodes: readonly SitemapNode[], ancestors: readonly SitemapNode[]): readonly SitemapNode[] | undefined => {
    for (const node of nodes) {
      const chain = [...ancestors, node];
      if (node.id === nodeId) return chain;
      const nested = visit(node.children, chain);
      if (nested) return nested;
    }
    return undefined;
  };
  return visit(document.root, []) ?? [];
}

export function primaryNavigation(document: SitemapDocument, routes: readonly SiteCompiledRoute[], activeNodeId: string, activePathname?: string): readonly DeliveryChromeItem[] {
  const root = document.root[0];
  if (!root) return [];
  const activeIds = new Set(sitemapChain(document, activeNodeId).map(({ id }) => id));
  return [root, ...root.children].flatMap((node) => {
    const path = readyPath(routes, node.id, activePathname);
    return path === undefined ? [] : [{ id: node.id, title: node.title, href: toSiteHref(path), active: activeIds.has(node.id), current: node.id === activeNodeId && path === activePathname }];
  });
}

export function breadcrumbs(document: SitemapDocument, routes: readonly SiteCompiledRoute[], activeNodeId: string, activePathname?: string): readonly DeliveryChromeItem[] {
  return sitemapChain(document, activeNodeId).flatMap((node) => {
    const path = readyPath(routes, node.id, node.id === activeNodeId ? activePathname : undefined);
    return path === undefined ? [] : [{ id: node.id, title: node.title, href: toSiteHref(path), active: node.id === activeNodeId, current: node.id === activeNodeId }];
  });
}

export function footerNavigation(document: SitemapDocument, routes: readonly SiteCompiledRoute[], activeNodeId: string, activePathname?: string): readonly DeliveryChromeItem[] {
  const items: DeliveryChromeItem[] = [];
  const visit = (nodes: readonly SitemapNode[]): void => {
    for (const node of nodes) {
      const nodeRoutes = routes.filter((route) => route.sitemapNode.id === node.id);
      const path = nodeRoutes.length === 1 ? readyPath(routes, node.id, activePathname) : undefined;
      if (path !== undefined && !items.some(({ href }) => href === toSiteHref(path))) items.push({ id: node.id, title: node.title, href: toSiteHref(path), active: node.id === activeNodeId, current: node.id === activeNodeId && path === activePathname });
      visit(node.children);
    }
  };
  visit(document.root);
  return items;
}
