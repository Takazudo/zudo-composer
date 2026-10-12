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
export interface HostedReceipt { actorId: string; operationKey: string; fingerprint: string; result: HostedResult }
export interface HostedDatabase {
  state: HostedState; baselineProviders: HostedProvider[]; receipts: HostedReceipt[];
  snapshots: HostedSnapshot[]; publications: HostedPublication[];
}
/** The adapter holds a database transaction across the callback and persists its detached aggregate atomically. */
export interface HostedStorage {
  read(): Promise<HostedDatabase>;
  transaction<T>(work: (database: HostedDatabase) => Promise<T>): Promise<T>;
}
export interface HostedActor { id: string }
export interface HostedServiceOptions {
  siteId: string; definition: string; policy: HostedPolicy; storage: HostedStorage;
  authorize(actor: HostedActor): void | Promise<void>;
  digest(value: string): Promise<string>;
  createId(): string;
  now(): string;
  /** Host-owned pure projection includes the fixed templates, outlets, routes and mappings. No Node compilation per request. */
  project(providers: HostedProvider[], assets: HostedAsset[]): JsonValue;
  validateSubmission(snapshot: HostedSnapshot): void | Promise<void>;
  validateMarkdown?(value: string): void;
}
export interface HostedService {
  readState(actor: HostedActor): Promise<HostedState>;
  execute(actor: HostedActor, request: unknown): Promise<HostedResult>;
  readReceipt(actor: HostedActor, operationKey: string): Promise<HostedReceipt | null>;
  readSnapshot(actor: HostedActor, snapshotId: string): Promise<HostedSnapshot>;
  getPublication(actor: HostedActor, publicationId: string): Promise<HostedPublication>;
  recordStatus(evidence: { publicationId: string; snapshotId: string; statusVersion: number; status: HostedPublicationStage; message?: string; facts?: Record<string, string> }): Promise<HostedPublication>;
  recordConfirmedIntegration(evidence: { publicationId: string; snapshotId: string; expectedBaseline: HostedIdentities["baseline"]; gitSha: string; contentDigest: string }): Promise<HostedState>;
}
export type HostedErrorCode = "invalid-request" | "invalid-value" | "forbidden" | "not-found" | "revision-conflict" | "baseline-conflict" | "definition-conflict" | "operation-key-reuse" | "publication-busy" | "incomplete" | "configuration-required";
export class HostedContentError extends Error {
  constructor(readonly code: HostedErrorCode, message: string, readonly diagnostics?: ContentCompletenessDiagnostic[]) { super(message); this.name = "HostedContentError"; }
}
export interface HostedTransport {
  readState(): Promise<HostedState>;
  execute(request: HostedCommand): Promise<HostedResult>;
  readReceipt(operationKey: string): Promise<HostedReceipt | null>;
  getPublication(publicationId: string): Promise<HostedPublication>;
}
