/**
 * Stable SiteProject provider ids and their current browser-provider ids.
 *
 * The two identities intentionally happen to match today. Keeping the mapping
 * explicit prevents adapters from accepting arbitrary provider strings and
 * leaves the portable contract independent of browser provider construction.
 */
export const SITE_PROJECT_PROVIDER_REGISTRY = Object.freeze({
  compositions: Object.freeze({
    indexeddb: Object.freeze({ logicalId: "indexeddb", browserProviderId: "indexeddb" }),
    files: Object.freeze({ logicalId: "files", browserProviderId: "files" }),
  }),
  content: Object.freeze({
    "content-indexeddb": Object.freeze({ logicalId: "content-indexeddb", browserProviderId: "content-indexeddb" }),
  }),
  mappings: Object.freeze({
    "mapping-indexeddb": Object.freeze({ logicalId: "mapping-indexeddb", browserProviderId: "mapping-indexeddb" }),
  }),
  sitemaps: Object.freeze({
    "sitemap-indexeddb": Object.freeze({ logicalId: "sitemap-indexeddb", browserProviderId: "sitemap-indexeddb" }),
  }),
} as const);

export type SiteProjectDomain = keyof typeof SITE_PROJECT_PROVIDER_REGISTRY;

export type SiteProjectProviderId<TDomain extends SiteProjectDomain> =
  keyof (typeof SITE_PROJECT_PROVIDER_REGISTRY)[TDomain] & string;

export function isSiteProjectProviderId<TDomain extends SiteProjectDomain>(
  domain: TDomain,
  value: unknown,
): value is SiteProjectProviderId<TDomain> {
  return typeof value === "string" && Object.hasOwn(SITE_PROJECT_PROVIDER_REGISTRY[domain], value);
}

export function browserProviderIdFor<TDomain extends SiteProjectDomain>(
  domain: TDomain,
  logicalId: SiteProjectProviderId<TDomain>,
): string {
  const entry = SITE_PROJECT_PROVIDER_REGISTRY[domain][logicalId] as { browserProviderId: string };
  return entry.browserProviderId;
}
