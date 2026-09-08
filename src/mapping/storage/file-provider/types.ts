import type { FileProviderConfig, FileProviderTransportOperation } from "../../../shared/file-provider";
import type { MappingInitializationOutcome, MappingPersistenceOperation, MappingProvider, MappingStore } from "../../model";

/** One endpoint per domain; the spelling is pinned by the shared protocol. */
export const MAPPING_FILE_PROVIDER_DOMAIN = "mapping";

/**
 * Every wire operation is a `MappingStore` method, plus the two initialization
 * entry points that are not part of the store surface.
 *
 * Mapping has no atomic batch of its own, so a whole-batch mutation travels
 * through the shared `transaction` wire operation instead of a bespoke
 * operation here — see `plugins/mapping-domain-provider.mjs`'s
 * `applyTransaction`.
 */
export const MAPPING_FILE_PROVIDER_OPERATIONS = [
  "list", "read-all", "snapshot", "get", "put", "delete", "seed", "clear", "initialize", "start-fresh",
] as const;

export type MappingWireOperation = FileProviderTransportOperation<(typeof MAPPING_FILE_PROVIDER_OPERATIONS)[number]>;

/** `start-fresh` is an initialization entry point, not a store operation. */
export function mappingPersistenceOperationOf(operation: MappingWireOperation): MappingPersistenceOperation {
  if (operation === "transaction") return "transact";
  if (operation === "start-fresh") return "clear";
  // Reading the whole record set is a `list` as far as Mapping's own error
  // vocabulary is concerned; only the transport distinguishes them.
  if (operation === "read-all" || operation === "snapshot") return "list";
  return operation;
}

export type MappingFileProviderConfig = FileProviderConfig;

export interface MappingFileProviderStore extends MappingStore {
  initialize(): Promise<MappingInitializationOutcome>;
  startFresh(): Promise<MappingInitializationOutcome>;
}

export interface MappingFileProvider extends MappingProvider {
  readonly store: MappingFileProviderStore;
}
