import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentEntryRef, ContentModelRecord, ContentEntryRecord, ContentCompletenessDiagnostic } from "../content/model/types";

export type { JsonValue, ContentEntryRef, ContentModelRecord, ContentEntryRecord };
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
);
export interface HostedResult { state: HostedState; createdEntry?: ContentEntryRef; snapshot?: HostedSnapshot; publication?: HostedPublication }
/** One row per operation, sized like the scoped state. Keys never expire in this version, so none is ever recycled. */
export interface HostedReceipt { actorId: string; operationKey: string; fingerprint: string; result: HostedResult }
/** Complete logical content of one site's storage, for seeding and fixture inspection only. The service never loads it whole. */
export interface HostedDatabase {
  state: HostedState; baselineProviders: HostedProvider[]; activePublicationId?: string | null; receipts: HostedReceipt[];
  snapshots: HostedSnapshot[]; publications: HostedPublication[];
}
/** The one mutable row. Its size is bounded by the working and baseline content, never by history. */
export interface HostedHead {
  /** Opaque storage version compared by every commit; it changes on every successful commit. */
  version: string;
  state: HostedState; baselineProviders: HostedProvider[]; activePublicationId: string | null;
}
/** One conditional write. Receipts and snapshots are insert-only; a publication replaces the row with its id. */
export interface HostedCommit {
  expectedVersion: string; head: HostedHead;
  receipt?: HostedReceipt; snapshot?: HostedSnapshot; publication?: HostedPublication;
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
  /**
   * Write everything or nothing. Resolve false, writing nothing, when the stored head version differs from
   * `expectedVersion` or the receipt (actorId, operationKey) or snapshot id already exists. Throw only when the
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
export interface HostedService {
  readState(actor: HostedActor): Promise<HostedState>;
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
export type HostedErrorCode = "invalid-request" | "invalid-value" | "forbidden" | "not-found" | "revision-conflict" | "baseline-conflict" | "definition-conflict" | "operation-key-reuse" | "publication-busy" | "incomplete" | "configuration-required" | "unavailable";
export class HostedContentError extends Error {
  constructor(readonly code: HostedErrorCode, message: string, readonly diagnostics?: ContentCompletenessDiagnostic[]) { super(message); this.name = "HostedContentError"; }
}
export interface HostedTransport {
  readState(): Promise<HostedState>;
  execute(request: HostedCommand): Promise<HostedResult>;
  readReceipt(operationKey: string): Promise<HostedReceipt | null>;
  getPublication(publicationId: string): Promise<HostedPublication>;
}
