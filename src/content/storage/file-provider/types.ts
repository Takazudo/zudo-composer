import type { FileProviderConfig } from "../../../shared/file-provider";
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

export type ContentWireOperation = (typeof CONTENT_FILE_PROVIDER_OPERATIONS)[number];

/** `start-fresh` is an initialization entry point, not a store operation. */
export function contentPersistenceOperationOf(operation: ContentWireOperation): ContentPersistenceOperation {
  return operation === "start-fresh" ? "clear" : operation;
}

export type ContentFileProviderConfig = FileProviderConfig;

export interface ContentFileProviderStore extends ContentStore {
  initialize(): Promise<ContentInitializationOutcome>;
  startFresh(): Promise<ContentInitializationOutcome>;
}

export interface ContentFileProvider extends ContentProvider {
  readonly store: ContentFileProviderStore;
}
