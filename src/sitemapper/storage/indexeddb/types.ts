export const SITEMAPPER_DATABASE_NAME = "zudo-composer-sitemapper";
export const SITEMAPPER_DATABASE_VERSION = 1;
export const SITEMAPS_STORE_NAME = "sitemaps";
export const META_STORE_NAME = "meta";
export const UPDATED_AT_INDEX_NAME = "updatedAt";

export const SITEMAPPER_META_KEYS = {
  schema: "schema",
} as const;

export interface SitemapSchemaMeta {
  key: typeof SITEMAPPER_META_KEYS.schema;
  databaseVersion: typeof SITEMAPPER_DATABASE_VERSION;
  recordSchemaVersion: number;
}

export type SitemapMetaRecord = SitemapSchemaMeta;

export interface IndexedDbSitemapProviderOptions {
  /** `null` explicitly represents an unavailable browser implementation. */
  idbFactory?: IDBFactory | null;
}
