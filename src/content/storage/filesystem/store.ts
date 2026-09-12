// Filesystem construction stays outside the storage-independent domain core.
import { createTransactionalRecordStore } from "../../../shared/node-fs";
import { TransactionalContentStore, errorPolicy, PHASES } from "./transactional-store";
import { CONTENT_RECORD_SCHEMA_VERSION, type FilesystemContentStoreOptions } from "./types";
import type { ContentPersistenceOperation as Operation } from "../../library";
export * from "./transactional-store";
export class FilesystemContentStore extends TransactionalContentStore {
  static async create(options: FilesystemContentStoreOptions): Promise<FilesystemContentStore> {
    const records = await createTransactionalRecordStore<Operation>({
      root: options.contentRoot,
      schemaVersion: CONTENT_RECORD_SCHEMA_VERSION,
      errors: errorPolicy,
      rootLabel: "Content records root",
      ownerLabel: "Content",
      recordLabel: "content record",
      phases: PHASES,
      ...(options.operations === undefined ? {} : { operations: options.operations }),
      ...(options.randomToken === undefined ? {} : { randomToken: options.randomToken }),
      ...(options.newMutationToken === undefined ? {} : { newMutationToken: options.newMutationToken }),
    });
    return this.fromRecords(records, options.now);
  }
}
export function createFilesystemContentStore(options: FilesystemContentStoreOptions): Promise<FilesystemContentStore> { return FilesystemContentStore.create(options); }
