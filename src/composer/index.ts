// Public surface of the standalone Composer document model, storage, reuse,
// and source generator. Browser-facing application code should prefer
// `composer/browser`; this root also exposes the Node filesystem implementation.

// ── Document model ───────────────────────────────────────────────────────────
export type {
  JsonObject,
  CompositionSchemaVersion,
  CompositionNode,
  GlobalTemplateOutletTarget,
  GlobalTemplateOutlet,
  GlobalTemplatePublication,
  PatternPublication,
  CompositionPublication,
  CompositionBinding,
  RootPolicy,
  ResolvedGlobalTemplateOutletContract,
  PublicationDependencyGuard,
  CompositionDocument,
  InsertionTarget,
  ComponentDefinition,
  ComponentCatalog,
} from "./model/types";
export {
  COMPOSITION_SCHEMA_VERSION,
  VIRTUAL_ROOT_SLOT_ID,
  createComponentCatalog,
} from "./model/types";

export type { CompositionDocumentDecodeOutcome } from "./model/codec";
export { decodeCompositionDocument } from "./model/codec";

export type { IdFactory } from "../shared/id-factory";
export { createSequentialIdFactory, createUuidIdFactory } from "../shared/id-factory";
export { isJsonSafe, isPlainObject, cloneJson } from "../shared/json";

export type { NodeLocation, DocumentIndex } from "./model/index-model";
export {
  orderedSlotIds,
  traverse,
  indexDocument,
  traversalOrder,
  findLocation,
} from "./model/index-model";

// ── Validation + diagnostics ─────────────────────────────────────────────────
export type {
  DiagnosticCode,
  DiagnosticReason,
  ReuseDiagnosticCode,
  ReuseDiagnosticReason,
  DiagnoseDocumentOptions,
  NodeDiagnostic,
  DocumentDiagnostics,
  TargetValidation,
} from "./model/validate";
export type { NodePropIssueCode, NodePropIssue, NodePropValidation } from "./model/node-props";
export { validateNodeProps } from "./model/node-props";
export {
  isStructurallyValidDocument,
  classifyNode,
  diagnoseDocument,
  isNodeOpaque,
  UNRESTRICTED_ROOT_POLICY,
  UNRESOLVED_ROOT_POLICY,
  effectiveRootPolicy,
  validateRootForest,
  validateRootInsertion,
  isPublishedOutletTarget,
  validateInsertionTarget,
} from "./model/validate";

// ── Commands ─────────────────────────────────────────────────────────────────
export type { CommandResult, CommandErrorCode, ClonedForestWithNewIds } from "./model/commands";
export {
  addNode,
  updateProps,
  reorderNode,
  removeNode,
  repairSelection,
  cloneSubtreeWithNewIds,
  cloneForestWithNewIds,
  insertSubtree,
  insertForest,
  moveSubtree,
  publishPattern,
  publishGlobalTemplate,
  setGlobalTemplateOutlet,
  renameGlobalTemplateOutlet,
  reassignGlobalTemplateOutlet,
  clearPublication,
  bindConsumer,
  removeBinding,
} from "./model/commands";

// ── Recovery ─────────────────────────────────────────────────────────────────
export type { LoadOutcome } from "./model/recovery";
export { loadCompositionDocument, resetToSample } from "./model/recovery";

// ── Composition library records + provider boundary ─────────────────────────
export * from "./library";

// ── Reuse catalog + live Global-template resolution ─────────────────────────
export * from "./reuse";

// ── Source generation ────────────────────────────────────────────────────────
export type {
  ImportPlan,
  GenerateJsxOptions,
  JsxGenerationResult,
} from "./source/generate-jsx";
export { generateJsx } from "./source/generate-jsx";

export type {
  CompositionModuleSpecifier,
  LinkedJsxModuleKind,
  LinkedJsxLocalComponentDiagnostic,
  LinkedJsxDependencyDiagnosticCode,
  LinkedJsxDependencyDiagnostic,
  LinkedJsxModuleDiagnostic,
  GeneratedLinkedJsxModulePlan,
  BlockedLinkedJsxModulePlan,
  LinkedJsxModulePlan,
  LinkedJsxModuleBatchPlan,
  PlanLinkedJsxModulesOptions,
  BrowserJsxExportKind,
  BrowserJsxExportReady,
  BrowserJsxExportBlocked,
  BrowserJsxExportOutcome,
  GenerateBrowserJsxExportOptions,
} from "./source/plan-linked-jsx";
export { planLinkedJsxModules, generateBrowserJsxExport } from "./source/plan-linked-jsx";

// ── Persistence providers ────────────────────────────────────────────────────
export * from "./storage";

// ── Shared persistence coordination ─────────────────────────────────────────
export * from "../shared/persistence";
