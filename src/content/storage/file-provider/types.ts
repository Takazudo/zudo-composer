import type { FileProviderConfig, FileProviderTransportOperation } from "../../../shared/file-provider";
import type { ContentInitializationOutcome, ContentPersistenceOperation, ContentProvider, ContentStore } from "../../library";

/** One endpoint per domain; the spelling is pinned by the shared protocol. */
export const CONTENT_FILE_PROVIDER_DOMAIN = "content";

/**
 * Every wire operation is a `ContentStore` method, plus the two initialization
 * entry points that are not part of the store surface.
 *
 * Content's own `transact` is already an atomic multi-operation request with
 * its own optimistic-concurrency token, so it travels as a single operation
 * rather than through the shared `{expectedMutationToken, steps}` envelope. A
 * domain without a batch operation of its own should use that envelope instead.
 */
export const CONTENT_FILE_PROVIDER_OPERATIONS = [
  "read-all", "transact", "reconcile-publication",
  "list-models", "get-model", "put-model", "delete-model",
  "count-entries", "get-entry", "page-entries", "scan-entries",
  "put-entry", "delete-entry", "remove-field", "seed", "clear",
  "initialize", "start-fresh",
] as const;

/**
 * History, compare and restore for the Content editor. They are answered by
 * the shared editorial boundary over the same store, not by store methods.
 */
export const CONTENT_EDITORIAL_WIRE_OPERATIONS = [
  "editorial-read", "editorial-revisions", "editorial-revision", "editorial-compare",
  "editorial-validate", "editorial-save", "editorial-restore", "editorial-publication",
] as const;
export type ContentEditorialWireOperation = (typeof CONTENT_EDITORIAL_WIRE_OPERATIONS)[number];

export type ContentWireOperation = FileProviderTransportOperation<(typeof CONTENT_FILE_PROVIDER_OPERATIONS)[number] | ContentEditorialWireOperation | ContentPersistenceOperation>;

/** `start-fresh` is an initialization entry point, not a store operation. */
export function contentPersistenceOperationOf(operation: ContentWireOperation): ContentPersistenceOperation {
  if (operation === "transaction") return "transact";
  if (operation === "editorial-save" || operation === "editorial-restore") return "edit-entry";
  if (operation.startsWith("editorial-")) return "read-revision";
  return operation === "start-fresh" ? "clear" : operation as ContentPersistenceOperation;
}

export type ContentFileProviderConfig = FileProviderConfig;

export interface ContentFileProviderStore extends ContentStore {
  initialize(): Promise<ContentInitializationOutcome>;
  startFresh(): Promise<ContentInitializationOutcome>;
}

export interface ContentFileProvider extends ContentProvider {
  readonly store: ContentFileProviderStore;
}
