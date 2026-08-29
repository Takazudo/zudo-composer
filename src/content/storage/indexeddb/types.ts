import type { ContentSeed } from "../../library";

export const CONTENT_DATABASE_NAME = "zudo-composer-content";
export const CONTENT_DATABASE_VERSION = 1;
export const CONTENT_MODELS_STORE_NAME = "models";
export const CONTENT_ENTRIES_STORE_NAME = "entries";
export const CONTENT_META_STORE_NAME = "meta";
export const CONTENT_MODEL_CREATED_AT_INDEX = "createdAt-id";
export const CONTENT_ENTRY_MODEL_CREATED_AT_INDEX = "modelId-createdAt-id";
export const CONTENT_ENTRY_MODEL_INDEX = "modelId";
export const CONTENT_META_KEYS = { schema: "schema" } as const;

export interface ContentSchemaMeta {
  key: typeof CONTENT_META_KEYS.schema;
  databaseVersion: typeof CONTENT_DATABASE_VERSION;
  modelRecordSchemaVersion: 1;
  entryRecordSchemaVersion: 1;
}

export interface IndexedDbContentProviderOptions {
  idbFactory?: IDBFactory | null;
  seed?: ContentSeed;
  now?: () => string;
  keyRangeFactory?: Pick<typeof IDBKeyRange, "bound"> | null;
}
