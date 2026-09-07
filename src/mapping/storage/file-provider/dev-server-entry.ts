// Loaded only by the active Vite development server. Keeping this Node-side
// import behind `ssrLoadModule` prevents filesystem modules entering clients.
//
// The plugin graph cannot use `instanceof`, so the domain-error predicate is
// exported from here rather than reimplemented as a duck-type check.
import { MappingPersistenceError } from "../../model";
import { createFilesystemMappingStore } from "../filesystem";
import { workspaceScopedRoot } from "../../../shared/workspace-scope";

/** The Mapping root, scoped to one workspace. */
export function createWorkspaceScopedMappingStore(mappingsRoot: string, workspaceId: string) {
  return createFilesystemMappingStore({ mappingsRoot: workspaceScopedRoot(mappingsRoot, workspaceId) });
}
export { MAPPING_FILE_PROVIDER_OPERATIONS } from "./types";

export function isMappingPersistenceError(value: unknown): boolean {
  return value instanceof MappingPersistenceError;
}
