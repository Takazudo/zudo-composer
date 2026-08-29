// Public barrel for app-neutral authoring primitives.

export { cloneJson, isJsonSafe, isPlainObject } from "./json";
export type { IdFactory } from "./id-factory";
export { createSequentialIdFactory, createUuidIdFactory } from "./id-factory";
export type { RecordId } from "./record-identity";
export { RECORD_ID_PATTERN, isSafeRecordId } from "./record-identity";
export * from "./persistence";
