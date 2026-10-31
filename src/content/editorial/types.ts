// The one editorial contract both Content backends answer: native project
// files and Hosted Content. Each adapter forwards to its backend's own
// authoritative owner; nothing here keeps a second editable copy.
import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentEntryRecord, ContentEntryRef } from "../model";

export type EditorialPerspective = "working" | "published";
/** `new`: absent from the activated publication. `published`: working values equal it. `changed`: they differ. */
export type EditorialStatus = "new" | "published" | "changed";
/** What identifies the shown values: a working revision, or the activated publication (never a revision id). */
export type EditorialValuesIdentity =
  | { perspective: "working"; token: string; revisionId: string | null }
  | { perspective: "published"; release: string; fence: number };

export interface EditorialEntryView {
  entry: ContentEntryRef;
  perspective: EditorialPerspective;
  status: EditorialStatus;
  /** Publication intent recorded on the working Entry. */
  lifecycle: ContentEntryRecord["lifecycle"];
  updatedAt: string;
  values: Record<string, JsonValue>;
  /** Head of the Entry's working history, the same in both perspectives; null before history begins. */
  workingRevisionId: string | null;
  valuesIdentity: EditorialValuesIdentity;
  /** Opaque precondition a save or restore quotes back; any newer write makes it stale. */
  expected: string;
}

export interface EditorialRevision {
  id: string;
  entry: ContentEntryRef;
  sequence: number;
  parentId: string | null;
  values: Record<string, JsonValue>;
  createdAt: string;
  actor: { id: string } | null;
  source: string;
  operation: { kind: string; key: string | null };
  restoredFrom?: string;
}
export interface EditorialRevisionPage { revisions: EditorialRevision[]; nextCursor: string | null }
export type EditorialRevisionTarget = { revisionId: string } | { perspective: EditorialPerspective };

export interface EditorialFieldDifference {
  fieldId: string;
  key: string;
  label: string;
  change: "added" | "removed" | "changed";
  before?: JsonValue;
  after?: JsonValue;
  /** True when the current definition no longer has this field. */
  removedFromDefinition: boolean;
}
export interface EditorialComparison {
  entry: ContentEntryRef;
  from: EditorialRevisionTarget;
  to: EditorialRevisionTarget;
  differences: EditorialFieldDifference[];
}

export interface EditorialFieldsRequest {
  entry: ContentEntryRef;
  /** The `expected` of the view the change was prepared against. */
  expected: string;
  values: Record<string, JsonValue>;
  clear: string[];
}
/** A candidate validated against the pinned precondition; nothing was written. */
export interface EditorialValidation {
  entry: ContentEntryRef;
  expected: string;
  values: Record<string, JsonValue>;
  differences: EditorialFieldDifference[];
}
export interface EditorialReceipt {
  operationKey: string;
  entry: ContentEntryRef;
  /** The revision the operation appended, or the unchanged head when nothing changed. */
  revisionId: string | null;
  /** The precondition after this operation, for a follow-up such as an undo. */
  expected: string;
}

export interface EditorialPublicationStatus {
  /** The activated publication that `published` reads return. */
  activated: { release: string | null; fence: number };
  /** The newest submission still on its way, when the backend tracks one. */
  submission: { id: string; status: string } | null;
  artifact: string | null;
  deployed: boolean;
}

export type EditorialFieldDiagnosticCode = "field-removed" | "invalid-value" | "forbidden" | "collection-owned";
export interface EditorialFieldDiagnostic { fieldId: string; code: EditorialFieldDiagnosticCode; message: string }

export type EditorialErrorCode =
  | "invalid-request" | "not-found" | "forbidden" | "invalid-value" | "revision-conflict"
  | "operation-key-reuse" | "restore-incompatible" | "configuration-required" | "unavailable";
export class EditorialError extends Error {
  readonly name = "EditorialError";
  constructor(readonly code: EditorialErrorCode, message: string, readonly diagnostics: EditorialFieldDiagnostic[] = []) { super(message); }
}

/**
 * Bound by trusted server code to one actor and one source label, so
 * provenance never comes from a request body.
 */
export interface ContentEditorialBoundary {
  readonly backend: "native" | "hosted";
  readEntry(query: { entry: ContentEntryRef; perspective: EditorialPerspective }): Promise<EditorialEntryView>;
  /** The Entry model's current field definitions. */
  readFields(query: { entry: ContentEntryRef }): Promise<EditorialField[]>;
  listRevisions(query: { entry: ContentEntryRef; cursor?: string; limit?: number }): Promise<EditorialRevisionPage>;
  readRevision(query: { entry: ContentEntryRef; revisionId: string }): Promise<EditorialRevision>;
  compare(query: { entry: ContentEntryRef; from: EditorialRevisionTarget; to: EditorialRevisionTarget }): Promise<EditorialComparison>;
  validateFields(request: EditorialFieldsRequest): Promise<EditorialValidation>;
  saveFields(request: EditorialFieldsRequest & { operationKey: string }): Promise<EditorialReceipt>;
  /** Writes the revision's values as a new working revision; publication intent, the activated publication and history are kept. */
  restoreRevision(request: { entry: ContentEntryRef; revisionId: string; expected: string; operationKey: string }): Promise<EditorialReceipt>;
  publicationStatus(): Promise<EditorialPublicationStatus>;
  /**
   * The committed receipt of this actor's operation key, or null when none was
   * committed. Never writes, so a caller can tell recovery from a fresh request.
   */
  readOperation(query: { entry: ContentEntryRef; operationKey: string }): Promise<EditorialReceipt | null>;
}

/** One field of the Entry's current definition. */
export interface EditorialField { id: string; key: string; label: string; kind: string; required: boolean }

export interface EditorialProvenance { actor: { id: string } | null; source: string }
