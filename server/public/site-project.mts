// The portable records used to author a SiteProject and the JSON API types
// used to release one. Keep every export explicit: this is a permanent API.
//
// Store/provider implementations, API service dependencies, compiler adapters,
// editor state, persistence/recovery outcomes and provider registry tables stay
// internal: hosts author records and call the API, not construct tool services.
// Nested supporting types remain in the generated declaration graph and can be
// addressed through these records; being reachable does not make them named
// public exports. DSL inputs/handles belong to the authoring entry when its
// implementation moves out of demo-tools, not to this record-only entry.
export type {
  SiteProject,
  SiteProjectCollectionAttachment,
  SiteProjectDiagnostic,
} from "../../src/site-project/model/types.js";
export type {
  ReleasePlan,
  SiteProjectActiveSelection,
  SiteProjectApiRequest,
  SiteProjectApiResponse,
  SiteProjectListEntry,
} from "../../src/site-project/api/types.js";

// These are the domain records/nodes consumed by the authoring DSL. JsonValue
// and component-pack types stay owned by @zudo-composer/component-contract.
export type { CompositionRecord } from "../../src/composer/library/types.js";
export type {
  CompositionNode,
  GlobalTemplateOutlet,
  JsonObject,
} from "../../src/composer/model/types.js";
export type {
  ContentEntryRecord,
  ContentFieldDefinition,
  ContentModelRecord,
  ContentValueSchema,
} from "../../src/content/model/types.js";
export type {
  MappingBinding,
  MappingCollectionQuery,
  MappingRecord,
  MappingSourceProjection,
  MappingTransform,
} from "../../src/mapping/model/types.js";
export type { SitemapRecord } from "../../src/sitemapper/library/types.js";
export type {
  SitemapNavigationItem,
  SitemapNode,
} from "../../src/sitemapper/model/types.js";
