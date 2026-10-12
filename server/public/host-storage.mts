// Durable draft storage contract for a hosted content editor, the in-memory
// reference adapter and the conformance suite a host runs against its own
// adapter. Portable: no Node, Vite, Preact or DOM globals.
export {
  contentDraftRequestDigest,
  contentSnapshotId,
  createMemoryContentDraftStorage,
  projectWithContentSnapshot,
  sha256Hex,
  type ContentBaseline,
  type ContentBaselineAdvanceInput,
  type ContentDraftApplied,
  type ContentDraftApplyInput,
  type ContentDraftConflictReason,
  type ContentDraftMutationResult,
  type ContentDraftReadResult,
  type ContentDraftState,
  type ContentDraftStorageAdapter,
  type ContentOperationReceipt,
  type ContentSnapshotRecord,
  type MemoryContentDraftStorageOptions,
} from "../../src/hosted-content/storage.js";
export {
  CONTENT_STORAGE_CONFORMANCE_CASES,
  CONTENT_STORAGE_CONFORMANCE_POLICY,
  createContentStorageConformanceBaseline,
  runContentStorageConformance,
  type ContentStorageConformanceCase,
  type ContentStorageConformanceFactory,
  type ContentStorageConformanceHarness,
} from "../../src/hosted-content/conformance.js";
export {
  applyHostContentRequest,
  createContentEditorStorage,
  hostContentRequestDigest,
  isHostContentOperationId,
  readHostContentReceipt,
  type ContentEditorApplyInput,
  type ContentEditorStorage,
  type HostContentApplyInput,
  type HostContentApplyResult,
  type HostContentServiceOptions,
} from "../../src/hosted-content/editor-service.js";
