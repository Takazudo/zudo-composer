import type { CompositionDocument } from "../../model/types";
import type { IdFactory } from "../../../shared/id-factory";

export const COMPOSER_DATABASE_NAME = "zudo-composer";
export const COMPOSER_DATABASE_VERSION = 1;
export const COMPOSITIONS_STORE_NAME = "compositions";
export const META_STORE_NAME = "meta";
export const UPDATED_AT_INDEX_NAME = "updatedAt";

export const COMPOSER_META_KEYS = {
  schema: "schema",
  initialization: "initialization",
} as const;

export interface SchemaMeta {
  key: typeof COMPOSER_META_KEYS.schema;
  databaseVersion: typeof COMPOSER_DATABASE_VERSION;
  recordSchemaVersion: number;
}

export interface InitializationMeta {
  key: typeof COMPOSER_META_KEYS.initialization;
  state: "ready";
  initializedAt: string;
  recordId: string;
}

export type ComposerMetaRecord = SchemaMeta | InitializationMeta;

export interface IndexedDbCompositionProviderOptions {
  /** Supplies the clean current-schema document seeded into a new database. */
  initialDocument: () => CompositionDocument;
  /** `null` explicitly represents an unavailable browser implementation. */
  idbFactory?: IDBFactory | null;
  idFactory?: IdFactory;
  now?: () => string;
}
