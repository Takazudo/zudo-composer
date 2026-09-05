export const SITEMAPPER_DATABASE_NAME = "zudo-composer-sitemapper";
export const SITEMAPPER_DATABASE_VERSION = 3;
export const SITEMAPS_STORE_NAME = "sitemaps";
export const META_STORE_NAME = "meta";
export const UPDATED_AT_INDEX_NAME = "updatedAt";

export const SITEMAPPER_META_KEYS = {
  schema: "schema",
} as const;

export interface SitemapSchemaMeta {
  key: typeof SITEMAPPER_META_KEYS.schema;
  databaseVersion: typeof SITEMAPPER_DATABASE_VERSION;
  recordSchemaVersion: typeof import("../../model").SITEMAP_SCHEMA_VERSION;
}

export type SitemapMetaRecord = SitemapSchemaMeta;

export interface IndexedDbSitemapProviderOptions {
  /** `null` explicitly represents an unavailable browser implementation. */
  idbFactory?: IDBFactory | null;
  seed?: readonly import("../../library").SitemapRecord[];
}
