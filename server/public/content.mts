// Portable content entry: browser- and Worker-safe validation, canonical
// serialization, route projection and the restricted mutation boundary. It
// never imports Node, Vite, Preact or DOM globals; the emitted graph is
// scanned by `pnpm portable:scan`.
export {
  isValueValidForField,
  validateContentEntryRecord,
  validateContentModelRecord,
  CONTENT_FIELD_KINDS,
  traverseContentSchema,
  traverseContentValues,
  type ContentValidation,
  type ContentValidationIssue,
  type ContentValidationCode,
  type ContentValueLocation,
} from "../../src/content/model/index.js";
export {
  assertContentEntryMatchesModel,
  contentEntrySemanticIssue,
  contentEntryDigest,
  createContentEntryRecord,
  diagnoseContentEntryCompleteness,
  ContentPersistenceError,
  type ContentMutation,
  type ContentMutationOperation,
  type ContentPersistenceErrorCode,
  type ContentSnapshot,
} from "../../src/content/library/index.js";
export type { ContentCompletenessDiagnostic } from "../../src/content/model/types.js";
export { canonicalStringifyJson, canonicalizeSiteProject, serializeSiteProject } from "../../src/site-project/model/canonical.js";
export { validateSiteProject } from "../../src/site-project/model/validation.js";
export type { SiteProjectValidation, SiteProjectValidationContext } from "../../src/site-project/model/types.js";
export type { AssetReferenceLock } from "../../src/assets/references/resolver.js";
export type { SiteCompiledRoute, SiteCompilerDiagnostic } from "../../src/site-project/compiler/types.js";
export {
  compileSiteProjectPlan,
  stripSiteBuildModules,
  type CompileSiteProjectPlanOptions,
  type SiteProjectPlan,
  type SiteProjectPlanCompilation,
  type SiteProjectPlanRoute,
} from "../../src/hosted-content/compile.js";
export {
  HOST_CONTENT_OPERATIONS,
  authorizeContentMutation,
  type AuthorizeContentMutationOptions,
  type AuthorizedContentMutation,
  type ContentMutationAuthorization,
  type ContentMutationRefusal,
  type ContentMutationRefusalCode,
  type ContentMutationRequest,
  type HostContentActor,
  type HostContentAssetPolicy,
  type HostContentModelPolicy,
  type HostContentOperation,
  type HostContentPolicy,
} from "../../src/hosted-content/policy.js";
export {
  DEFAULT_MARKDOWN_CONTENT_POLICY,
  diagnoseMarkdownValue,
  type MarkdownContentDiagnostic,
  type MarkdownContentDiagnosticCode,
  type MarkdownContentPolicy,
} from "../../src/hosted-content/markdown-policy.js";
