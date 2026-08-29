// Public Sitemapper model contract — the sole import surface for consumers.
//
// Keeping schema, validation, codec, recovery, and ephemeral indexing behind one
// barrel prevents storage, commands, catalog, and UI from forming reverse domain
// dependencies or importing Composer-owned model types.

export type {
  CompositionRef,
  MappingRef,
  MappingRoute,
  SitemapPageSource,
  SitemapDocument,
  SitemapNode,
  SitemapSchemaVersion,
} from "./types";
export { SITEMAP_SCHEMA_VERSION } from "./types";

export type { SitemapDocumentIndex, SitemapNodeLocation } from "./index-model";
export { findLocation, indexDocument, traversalOrder, traverse } from "./index-model";

export type {
  SitemapValidationFailureCode,
  SitemapValidationResult,
} from "./validate";
export { isStructurallyValidDocument } from "./validate";

export type { SitemapDocumentDecodeOutcome } from "./codec";
export { decodeSitemapDocument, encodeSitemapDocument } from "./codec";

export type {
  SitemapLoadOutcome,
  SitemapRecoveryReason,
} from "./recovery";
export { loadSitemapDocument } from "./recovery";
