import type { FileProviderConfig } from "../../../shared/file-provider";
import type { SitemapInitializationOutcome, SitemapPersistenceOperation, SitemapCollectionStore, SitemapProvider, SitemapProviderDescriptor } from "../../library";

/** One endpoint per domain; the spelling is pinned by the shared protocol. */
export const SITEMAP_FILE_PROVIDER_DOMAIN = "sitemapper";

/**
 * Every wire operation is a `SitemapCollectionStore` method, plus the two
 * initialization entry points that are not part of the store surface.
 *
 * Sitemapper has no atomic batch of its own, so a whole-batch mutation travels
 * through the shared `transaction` wire operation instead of a bespoke
 * operation here — see `plugins/sitemapper-domain-provider.mjs`'s
 * `applyTransaction`.
 */
export const SITEMAP_FILE_PROVIDER_OPERATIONS = [
  "list", "read-all", "get", "put", "delete", "seed", "clear", "initialize", "start-fresh",
] as const;

export type SitemapWireOperation = (typeof SITEMAP_FILE_PROVIDER_OPERATIONS)[number];

/**
 * `start-fresh` is an initialization entry point, not a store operation;
 * `read-all` and `seed` are Node-store methods that report under `list` and
 * `put` respectively, matching the IndexedDB store's own choice of operation
 * tag for the same calls.
 */
export function sitemapPersistenceOperationOf(operation: SitemapWireOperation): SitemapPersistenceOperation {
  if (operation === "start-fresh") return "clear";
  if (operation === "seed") return "put";
  if (operation === "read-all") return "list";
  return operation;
}

export type SitemapFileProviderConfig = FileProviderConfig;

export interface SitemapFileProviderStore extends SitemapCollectionStore {
  /** Not part of the base `SitemapStore` surface; the browser and Node stores both carry it for provider-identity display. */
  readonly provider: SitemapProviderDescriptor;
  initialize(): Promise<SitemapInitializationOutcome>;
  startFresh(): Promise<SitemapInitializationOutcome>;
}

export interface SitemapFileProvider extends SitemapProvider {
  readonly store: SitemapFileProviderStore;
}
