// The Sitemapper's half of the shared route-intent contract.
//
// `parseIntent`/`formatIntent` own the `/sitemapper?sitemap=&page=` grammar
// (`src/app/route-intents.ts`); this module only narrows their result to the
// Sitemapper and gives the route one place to build its own links.

import { formatIntent, parseIntent, type RouteIntentLocation } from "../../../app/route-intents";

export const SITEMAPPER_ROUTE = "/sitemapper";

export interface SitemapperIntent {
  readonly providerId: string;
  readonly sitemapId: string;
  readonly pageId?: string;
}

export type SitemapperIntentOutcome =
  | { readonly status: "library" }
  | { readonly status: "sitemap"; readonly intent: SitemapperIntent }
  | { readonly status: "invalid"; readonly message: string };

/** Build a deep link to a Sitemap, and optionally to one page inside it. */
export function sitemapperHref(providerId: string, sitemapId: string, pageId?: string): string {
  return formatIntent(pageId !== undefined
    ? { route: "sitemapper", providerId, sitemapId, pageId }
    : { route: "sitemapper", providerId, sitemapId });
}

/** Read the current location as a Sitemapper intent. */
export function readSitemapperIntent(location?: RouteIntentLocation | URL | string): SitemapperIntentOutcome {
  const outcome = parseIntent(location);
  if (outcome.status === "invalid") return { status: "invalid", message: outcome.message };
  if (outcome.status === "none" || outcome.intent.route !== "sitemapper") return { status: "library" };
  const { providerId, sitemapId, pageId } = outcome.intent;
  return { status: "sitemap", intent: pageId === undefined ? { providerId, sitemapId } : { providerId, sitemapId, pageId } };
}
