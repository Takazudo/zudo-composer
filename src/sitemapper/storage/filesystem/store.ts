// Filesystem construction stays outside the storage-independent domain core.
import { createTransactionalRecordStore } from "../../../shared/node-fs";
import { TransactionalSitemapStore, errorPolicy, PHASES } from "./transactional-store";
import { SITEMAP_RECORD_SCHEMA_VERSION, type FilesystemSitemapStoreOptions } from "./types";
import type { SitemapPersistenceOperation as Operation } from "../../library";
export * from "./transactional-store";
export class FilesystemSitemapStore extends TransactionalSitemapStore {
  static async create(options: FilesystemSitemapStoreOptions): Promise<FilesystemSitemapStore> {
    const records = await createTransactionalRecordStore<Operation>({
      root: options.sitemapsRoot,
      schemaVersion: SITEMAP_RECORD_SCHEMA_VERSION,
      errors: errorPolicy,
      rootLabel: "Sitemap records root",
      ownerLabel: "Sitemap",
      recordLabel: "sitemap record",
      phases: PHASES,
      ...(options.operations === undefined ? {} : { operations: options.operations }),
      ...(options.randomToken === undefined ? {} : { randomToken: options.randomToken }),
      ...(options.newMutationToken === undefined ? {} : { newMutationToken: options.newMutationToken }),
    });
    return this.fromRecords(records);
  }
}
export function createFilesystemSitemapStore(options: FilesystemSitemapStoreOptions): Promise<FilesystemSitemapStore> { return FilesystemSitemapStore.create(options); }
