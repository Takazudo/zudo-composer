import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentEntryRef, ContentModelRecord, ContentEntryRecord, ContentCompletenessDiagnostic, ContentFieldDefinition } from "../content/model/types";

export type { JsonValue, ContentEntryRef, ContentModelRecord, ContentEntryRecord, ContentFieldDefinition };
export interface HostedIdentities { draftRevision: string; baseline: { gitSha: string; contentDigest: string }; definition: string }
export interface HostedProvider { providerId: string; models: ContentModelRecord[]; entries: ContentEntryRecord[] }
export interface HostedFieldPermission {
  fieldId: string;
  replace?: boolean;
  clear?: boolean;
  children?: HostedFieldPermission[];
  assetSelect?: boolean;
  assetDescription?: string[];
  listAdd?: boolean;
  listRemove?: boolean;
  listReorder?: boolean;
  maxLength?: number;
}
export interface HostedModelPermission { providerId: string; modelId: string; entryIds: string[]; fields: HostedFieldPermission[] }
export interface HostedCollectionPermission {
  id: string; owner: ContentEntryRef; fieldId: string; target: { providerId: string; modelId: string };
  create: boolean; add: boolean; reorder: boolean; maxItems: number;
  initialValues: Record<string, JsonValue>;
}
export interface HostedAsset { providerId: string; assetId: string; versionId: string; checksum: string; url: string; label: string }
export interface HostedPolicy { models: HostedModelPermission[]; collections: HostedCollectionPermission[]; assets: HostedAsset[] }
export interface HostedState extends HostedIdentities { providers: HostedProvider[]; integrationFence: number }
export interface HostedSnapshot extends HostedIdentities {
  id: string; digest: string; providers: HostedProvider[]; assets: HostedAsset[];
  diagnostics: ContentCompletenessDiagnostic[]; renderData: JsonValue;
}
export type HostedPublicationStage = "submitted" | "building" | "verified" | "integrated" | "deployed" | "failed" | "conflict" | "unavailable";
export interface HostedPublication {
  id: string; snapshotId: string; expectedBaseline: HostedIdentities["baseline"];
  status: HostedPublicationStage; statusVersion: number; message?: string; gitSha?: string;
  lastProvenStatus?: "submitted" | "building" | "verified" | "integrated" | "deployed";
  facts?: Record<string, string>; integratedFence?: number;
}
interface HostedCommandBase { operationKey: string; expected: HostedIdentities }
export type HostedCommand = HostedCommandBase & (
  | { kind: "set-fields"; entry: ContentEntryRef; values: Record<string, JsonValue>; clear: string[] }
  | { kind: "create-entry"; collectionId: string; values: Record<string, JsonValue>; before: ContentEntryRef | null }
  | { kind: "add-entry"; collectionId: string; entry: ContentEntryRef; before: ContentEntryRef | null }
  | { kind: "reorder"; collectionId: string; entries: ContentEntryRef[] }
  | { kind: "capture-snapshot" }
  | { kind: "begin-publication"; snapshotId: string }
  /** Writes the revision's values as a new working revision; lifecycle, baseline and history are kept. */
  | { kind: "restore-revision"; entry: ContentEntryRef; revisionId: string }
);
export interface HostedResult { state: HostedState; createdEntry?: ContentEntryRef; snapshot?: HostedSnapshot; publication?: HostedPublication }
/** One row per operation, sized like the scoped state. Keys never expire in this version, so none is ever recycled. */
export interface HostedReceipt { actorId: string; operationKey: string; fingerprint: string; result: HostedResult }
export type HostedRevisionOperation = "initial" | "set-fields" | "create-entry" | "add-entry" | "reorder" | "restore-revision" | "adopt-canonical-baseline";
/**
 * One immutable working revision of one Entry. It is written in the same atomic commit as the Entry change and
 * its receipt, and it is never updated or pruned: history is retained for the life of the storage.
 */
export interface HostedRevision {
  id: string; entry: ContentEntryRef;
  /** 1-based and contiguous per Entry; the newest revision has the highest sequence. */
  sequence: number; parentId: string | null;
  values: Record<string, JsonValue>;
  /** The hosted definition the values were written under. */
  definition: string; createdAt: string;
  /** The authenticated actor, or null when the values came from canonical content rather than an edit here. */
  actor: HostedActor | null;
  /** Trusted host label for the entry point, from the service options; never a request value. */
  source: string;
  operation: { kind: HostedRevisionOperation; key: string | null };
  restoredFrom?: string;
}
/** Complete logical content of one site's storage, for seeding and fixture inspection only. The service never loads it whole. */
export interface HostedDatabase {
  state: HostedState; baselineProviders: HostedProvider[]; activePublicationId?: string | null; receipts: HostedReceipt[];
  snapshots: HostedSnapshot[]; publications: HostedPublication[]; revisions: HostedRevision[];
}
/** The one mutable row. Its size is bounded by the working and baseline content, never by history. */
export interface HostedHead {
  /** Opaque storage version compared by every commit; it changes on every successful commit. */
  version: string;
  state: HostedState; baselineProviders: HostedProvider[]; activePublicationId: string | null;
}
/** One conditional write. Receipts, snapshots and revisions are insert-only; a publication replaces the row with its id. */
export interface HostedCommit {
  expectedVersion: string; head: HostedHead;
  receipt?: HostedReceipt; snapshot?: HostedSnapshot; publication?: HostedPublication; revisions?: HostedRevision[];
}
/**
 * Narrow keyed reads plus one atomic conditional commit, e.g. a single D1 `batch()`.
 * The service prepares every commit from detached reads, so no transaction stays open across host code,
 * and retries a refused commit from fresh reads. Every read returns detached data.
 */
export interface HostedStorage {
  readHead(): Promise<HostedHead>;
  readReceipt(actorId: string, operationKey: string): Promise<HostedReceipt | null>;
  readSnapshot(snapshotId: string): Promise<HostedSnapshot | null>;
  readPublication(publicationId: string): Promise<HostedPublication | null>;
  readRevision(revisionId: string): Promise<HostedRevision | null>;
  /** One Entry's revisions, newest first, below `beforeSequence` when given; never more than `limit`. */
  listRevisions(entry: ContentEntryRef, page: { beforeSequence?: number; limit: number }): Promise<HostedRevision[]>;
  /**
   * Write everything or nothing. Resolve false, writing nothing, when the stored head version differs from
   * `expectedVersion` or the receipt (actorId, operationKey), snapshot id, revision id or revision (entry, sequence) already exists. Throw only when the
   * outcome is unknown or storage failed; a throw after a durable write is recovered through the receipt.
   */
  commit(change: HostedCommit): Promise<boolean>;
}
export interface HostedActor { id: string }
export interface HostedServiceOptions {
  siteId: string; definition: string; policy: HostedPolicy; storage: HostedStorage;
  authorize(actor: HostedActor): void | Promise<void>;
  digest(value: string): Promise<string>;
  createId(): string;
  now(): string;
  /** Host-owned pure projection includes the fixed templates, outlets, routes and mappings. No Node compilation per request. */
  project(providers: HostedProvider[], assets: HostedAsset[]): JsonValue | Promise<JsonValue>;
  validateSubmission(snapshot: HostedSnapshot): void | Promise<void>;
  validateMarkdown?(value: string): void;
  /** Trusted label recorded on every revision this service writes, e.g. "article-admin". Defaults to "hosted-content". */
  source?: string;
}
/** Privileged host evidence that canonical Git content changed outside a publication. */
export interface HostedCanonicalAdoption {
  /** The stored baseline and definition being replaced; a stale adoption is refused. */
  expected: { baseline: HostedIdentities["baseline"]; definition: string };
  baseline: HostedIdentities["baseline"];
  /** Complete canonical providers at that commit, valid under the service's current definition. */
  providers: HostedProvider[];
  /** `rebase` carries retained draft changes that still validate; `discard` resets the draft to canonical content. */
  draft: "rebase" | "discard";
  /** False reports what would be carried or dropped and writes nothing. */
  apply: boolean;
}
export type HostedRebaseDropReason = "entry-removed" | "model-removed" | "field-removed" | "canonical-changed" | "invalid-value" | "forbidden" | "discarded";
export interface HostedRebaseChange { entry: ContentEntryRef; fieldId: string }
export interface HostedAdoptionResult {
  applied: boolean;
  /** The adopted state, or the state it would produce when not applied. */
  state: HostedState;
  carried: HostedRebaseChange[];
  dropped: (HostedRebaseChange & { reason: HostedRebaseDropReason })[];
}
/** `working` is the retained draft; `published` is the active canonical baseline, never a lifecycle filter of the draft. */
export type HostedPerspective = "working" | "published";
/** `new`: absent from the active baseline. `published`: working values equal it. `changed`: working values differ from it. */
export type HostedEditorialStatus = "new" | "published" | "changed";
export interface HostedModelSummary { providerId: string; model: ContentModelRecord; workingEntries: number; publishedEntries: number }
export interface HostedEntryView {
  entry: ContentEntryRef; perspective: HostedPerspective; status: HostedEditorialStatus;
  lifecycle: ContentEntryRecord["lifecycle"]; generation: number; updatedAt: string; values: Record<string, JsonValue>;
  /** Head of the Entry's working history, the same in both perspectives; null before history begins. Guards history and restore. */
  workingRevisionId: string | null;
  /** What identifies the shown values: a working revision, or the activated baseline for published values (never a revision id). */
  valuesIdentity: HostedValuesIdentity;
  /** The identities this read was taken at; a command prepared from it quotes them as `expected`. */
  expected: HostedIdentities;
}
export type HostedValuesIdentity =
  | { perspective: "working"; draftRevision: string; revisionId: string | null }
  | { perspective: "published"; baseline: HostedState["baseline"]; integrationFence: number };
export interface HostedPage { cursor?: string; limit?: number }
export interface HostedEntryPage { entries: HostedEntryView[]; nextCursor: string | null }
export interface HostedRevisionPage { revisions: HostedRevision[]; nextCursor: string | null }
export type HostedRevisionTarget = { revisionId: string } | { perspective: HostedPerspective };
export interface HostedFieldDifference {
  fieldId: string; key: string; label: string;
  change: "added" | "removed" | "changed";
  before?: JsonValue; after?: JsonValue;
  /** True when the current definition no longer has this field. */
  removedFromDefinition: boolean;
}
/** A validated set-fields candidate that was not written. */
export interface HostedFieldPreview { entry: ContentEntryRef; expected: HostedIdentities; values: Record<string, JsonValue>; differences: HostedFieldDifference[] }
export interface HostedComparison { entry: ContentEntryRef; from: HostedRevisionTarget; to: HostedRevisionTarget; differences: HostedFieldDifference[] }
export type HostedRestoreDiagnosticCode = "field-removed" | "invalid-value" | "forbidden" | "collection-owned";
export interface HostedRestoreDiagnostic { entry: ContentEntryRef; fieldId: string; code: HostedRestoreDiagnosticCode; message: string }
/** Each stage is reported separately; none implies the next. */
export interface HostedPublicationOverview {
  /** The active canonical baseline that `published` reads return. */
  activated: { baseline: HostedIdentities["baseline"]; definition: string; integrationFence: number };
  /** The newest accepted submission, if any. */
  submission: { publicationId: string; snapshotId: string; status: HostedPublicationStage; statusVersion: number; message?: string } | null;
  /** Host-recorded `artifact` fact of that submission, e.g. a local artifact id; null until the host records one. */
  artifact: string | null;
  deployed: boolean;
}
export interface HostedService {
  readState(actor: HostedActor): Promise<HostedState>;
  listModels(actor: HostedActor): Promise<HostedModelSummary[]>;
  listEntries(actor: HostedActor, query: { perspective: HostedPerspective; providerId: string; modelId: string } & HostedPage): Promise<HostedEntryPage>;
  readEntry(actor: HostedActor, query: { perspective: HostedPerspective; entry: ContentEntryRef }): Promise<HostedEntryView>;
  listRevisions(actor: HostedActor, query: { entry: ContentEntryRef } & HostedPage): Promise<HostedRevisionPage>;
  readRevision(actor: HostedActor, revisionId: string): Promise<HostedRevision>;
  compareRevisions(actor: HostedActor, query: { entry: ContentEntryRef; from: HostedRevisionTarget; to: HostedRevisionTarget }): Promise<HostedComparison>;
  /** Run set-fields validation against the pinned identities and return the candidate without writing anything. */
  previewFields(actor: HostedActor, query: { entry: ContentEntryRef; values: Record<string, JsonValue>; clear: string[]; expected: HostedIdentities }): Promise<HostedFieldPreview>;
  readPublicationStatus(actor: HostedActor): Promise<HostedPublicationOverview>;
  execute(actor: HostedActor, request: unknown): Promise<HostedResult>;
  readReceipt(actor: HostedActor, operationKey: string): Promise<HostedReceipt | null>;
  readSnapshot(actor: HostedActor, snapshotId: string): Promise<HostedSnapshot>;
  getPublication(actor: HostedActor, publicationId: string): Promise<HostedPublication>;
  recordStatus(evidence: { publicationId: string; snapshotId: string; statusVersion: number; status: HostedPublicationStage; message?: string; facts?: Record<string, string> }): Promise<HostedPublication>;
  recordConfirmedIntegration(evidence: { publicationId: string; snapshotId: string; expectedBaseline: HostedIdentities["baseline"]; gitSha: string; contentDigest: string }): Promise<HostedState>;
  /** Adopt an external canonical baseline and/or definition, rebasing or discarding the retained draft explicitly. */
  adoptCanonicalBaseline(evidence: HostedCanonicalAdoption): Promise<HostedAdoptionResult>;
}
/** `unavailable` means storage kept refusing a commit; nothing was written and the exact request may be retried. */
export type HostedErrorCode = "invalid-request" | "invalid-value" | "forbidden" | "not-found" | "revision-conflict" | "baseline-conflict" | "definition-conflict" | "operation-key-reuse" | "publication-busy" | "incomplete" | "restore-incompatible" | "configuration-required" | "unavailable";
export class HostedContentError extends Error {
  constructor(readonly code: HostedErrorCode, message: string, readonly diagnostics?: ContentCompletenessDiagnostic[], readonly restoreDiagnostics?: HostedRestoreDiagnostic[]) { super(message); this.name = "HostedContentError"; }
}
export interface HostedTransport {
  readState(): Promise<HostedState>;
  execute(request: HostedCommand): Promise<HostedResult>;
  readReceipt(operationKey: string): Promise<HostedReceipt | null>;
  getPublication(publicationId: string): Promise<HostedPublication>;
  /** Editorial reads; a transport without them supports only the single-entry editor. */
  listModels?(): Promise<HostedModelSummary[]>;
  listEntries?(query: { perspective: HostedPerspective; providerId: string; modelId: string } & HostedPage): Promise<HostedEntryPage>;
  readEntry?(query: { perspective: HostedPerspective; entry: ContentEntryRef }): Promise<HostedEntryView>;
  listRevisions?(query: { entry: ContentEntryRef } & HostedPage): Promise<HostedRevisionPage>;
  readRevision?(revisionId: string): Promise<HostedRevision>;
  compareRevisions?(query: { entry: ContentEntryRef; from: HostedRevisionTarget; to: HostedRevisionTarget }): Promise<HostedComparison>;
  readPublicationStatus?(): Promise<HostedPublicationOverview>;
}
