import { formatIntent } from "../../../../app/route-intents";
import { hostDocumentPreviewConfigured } from "../../../delivery/host-preview-policy";
import type { SitemapNodeRouteInfo } from "../../../../sitemapper/routes";
export function HostPageAuthoringLink({ sitemap, pageId, routeInfo, flush }: { sitemap?: { providerId: string; recordId: string; active: boolean }; pageId: string; routeInfo?: SitemapNodeRouteInfo; flush?: () => void }) {
  if (!hostDocumentPreviewConfigured) return null;
  const reason = !sitemap?.active ? "Page authoring requires the active Sitemap." : !routeInfo || routeInfo.status !== "ready" ? "Resolve the selected page's route before opening page authoring." : routeInfo.derivedRouteCount !== 1 || !routeInfo.samplePath ? "This page has zero or multiple concrete routes. Choose a concrete route in Page authoring; this action does not guess a Mapping entry." : null;
  return <section aria-label="Host page authoring">{reason ? <p>{reason}</p> : <a class="cms-btn" href={formatIntent({ route: "composer", mode: "page", sitemapProviderId: sitemap!.providerId, sitemapId: sitemap!.recordId, pageId, visitorUrl: routeInfo!.samplePath! })} onClick={() => flush?.()}>Open page authoring</a>}</section>;
}
