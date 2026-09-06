// Loaded only by the active Vite development server. Keeping this Node-side
// import behind `ssrLoadModule` prevents filesystem modules entering clients.
//
// The plugin graph cannot use `instanceof`, so the domain-error predicate is
// exported from here rather than reimplemented as a duck-type check.
import { MappingPersistenceError } from "../../model";

export { createFilesystemMappingStore } from "../filesystem";
export { MAPPING_FILE_PROVIDER_OPERATIONS } from "./types";

export function isMappingPersistenceError(value: unknown): boolean {
  return value instanceof MappingPersistenceError;
}
