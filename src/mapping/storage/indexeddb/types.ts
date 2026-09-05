import type { MappingSeed } from "../../model";

export const MAPPING_DATABASE_NAME = "zudo-composer-mapping";
export const MAPPING_DATABASE_VERSION = 2;
export const MAPPING_RECORDS_STORE_NAME = "mappings";
export const MAPPING_META_STORE_NAME = "meta";
export const MAPPING_UPDATED_AT_INDEX = "updatedAt-id";
export const MAPPING_META_KEYS = { schema: "schema" } as const;
export interface MappingSchemaMeta { key: typeof MAPPING_META_KEYS.schema; databaseVersion: 2; mappingRecordSchemaVersion: 2 }
export interface IndexedDbMappingProviderOptions { idbFactory?: IDBFactory | null; seed?: MappingSeed }
