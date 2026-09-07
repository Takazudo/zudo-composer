import type { SafeRootFilesystemOperations } from "../../../shared/node-fs";
import { SITEMAP_SCHEMA_VERSION } from "../../model";

/** Pointer/generation protocol version owned by the transactional record store. */
export const SITEMAP_RECORD_SCHEMA_VERSION = 1;

/** Reserved record id for the domain metadata document; no Sitemap id may use it. */
export const SITEMAP_META_RECORD_ID = "meta";

/**
 * The provider's exact-physical-shape check.
 *
 * A directory of JSON documents cannot be interrogated for its keys and
 * uniqueness, so the layout it was written with is recorded once, in the domain
 * metadata document, and compared on every open. A store whose marker differs is refused
 * with `unsupported-version`: the records are preserved exactly as found and
 * nothing is re-shaped to fit the current expectation.
 */
export const SITEMAP_FILESYSTEM_LAYOUT = Object.freeze({
  layoutVersion: 1,
  sitemapRecordSchemaVersion: SITEMAP_SCHEMA_VERSION,
});

export type SitemapFilesystemLayout = typeof SITEMAP_FILESYSTEM_LAYOUT;

export interface FilesystemSitemapStoreOptions {
  /** The fixed directory below which every Sitemap record file lives. */
  sitemapsRoot: string;
  /** Test/fault-injection seam. Omitted methods use Node's real filesystem. */
  operations?: Partial<SafeRootFilesystemOperations>;
  /** Test-only random source seam; values must contain only URL-safe characters. */
  randomToken?: () => string;
}
