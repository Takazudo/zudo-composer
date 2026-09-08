// Filesystem construction stays outside the storage-independent domain core.
import { createTransactionalRecordStore } from "../../../shared/node-fs";
import { TransactionalMappingStore, errorPolicy, PHASES } from "./transactional-store";
import { MAPPING_RECORD_SCHEMA_VERSION, type FilesystemMappingStoreOptions } from "./types";
import type { MappingPersistenceOperation as Operation } from "../../model";
export * from "./transactional-store";
export class FilesystemMappingStore extends TransactionalMappingStore {
  static async create(options: FilesystemMappingStoreOptions): Promise<FilesystemMappingStore> {
    const records = await createTransactionalRecordStore<Operation>({
      root: options.mappingsRoot,
      schemaVersion: MAPPING_RECORD_SCHEMA_VERSION,
      errors: errorPolicy,
      rootLabel: "Mapping records root",
      ownerLabel: "Mapping",
      recordLabel: "mapping record",
      phases: PHASES,
      ...(options.operations === undefined ? {} : { operations: options.operations }),
      ...(options.randomToken === undefined ? {} : { randomToken: options.randomToken }),
    });
    return this.fromRecords(records);
  }
}
export function createFilesystemMappingStore(options: FilesystemMappingStoreOptions): Promise<FilesystemMappingStore> { return FilesystemMappingStore.create(options); }
