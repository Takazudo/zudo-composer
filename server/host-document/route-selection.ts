import { canonicalHostRoute } from "../../src/shared/host-route";
interface Selection { pathname?: string; pageId?: string; sitemapId?: string; sitemapProviderId?: string }
/** Validate the full handoff against the captured active Sitemap before rendering any route. */
export function selectHostDocumentRoute<T extends { pathname: string; sitemapNode: { id: string } }>(routes: readonly T[], active: { providerId: string; recordId: string }, input: Selection): T {
  const refuse = (message: string): never => { throw Object.assign(new Error(message), { code: "not-found" }); };
  if (input.sitemapProviderId && (!input.sitemapId || !input.pageId)) return refuse("A qualified Sitemap handoff requires a Sitemap and page.");
  if (input.sitemapId && !input.pageId) return refuse("A Sitemap handoff requires a page.");
  if ((input.sitemapProviderId && input.sitemapProviderId !== active.providerId) || (input.sitemapId && input.sitemapId !== active.recordId)) return refuse("The selected Sitemap is not the active captured Sitemap.");
  const pathname = input.pathname ? canonicalHostRoute(input.pathname, routes.map(route => route.pathname)) : undefined;
  const matching = routes.filter(route => (!input.pathname || route.pathname === pathname) && (!input.pageId || route.sitemapNode.id === input.pageId));
  if (!input.pathname && !input.pageId && !input.sitemapId && matching[0]) return matching[0];
  if (matching.length !== 1) return refuse("The selected page/route is unavailable or ambiguous. Choose one concrete route.");
  return matching[0]!;
}
