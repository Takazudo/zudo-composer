/**
 * Stable SiteProject provider ids and their current browser-provider ids.
 *
 * Authoring persists to the host project's files, so every domain names its
 * filesystem provider. Keeping the mapping explicit prevents adapters from
 * accepting arbitrary provider strings and leaves the portable contract
 * independent of browser provider construction; the two identities happen to
 * match again today.
 */
export const SITE_PROJECT_PROVIDER_REGISTRY = Object.freeze({
  compositions: Object.freeze({
    files: Object.freeze({ logicalId: "files", browserProviderId: "files" }),
  }),
  content: Object.freeze({
    "content-filesystem": Object.freeze({ logicalId: "content-filesystem", browserProviderId: "content-filesystem" }),
  }),
  mappings: Object.freeze({
    "mapping-filesystem": Object.freeze({ logicalId: "mapping-filesystem", browserProviderId: "mapping-filesystem" }),
  }),
  sitemaps: Object.freeze({
    "sitemap-filesystem": Object.freeze({ logicalId: "sitemap-filesystem", browserProviderId: "sitemap-filesystem" }),
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
