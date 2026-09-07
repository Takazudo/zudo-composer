// Loaded only by the active Vite development server. Keeping this Node-side
// import behind `ssrLoadModule` prevents filesystem modules entering clients.
//
// The plugin graph cannot use `instanceof`, so the domain-error predicate is
// exported from here rather than reimplemented as a duck-type check.
import { ContentPersistenceError } from "../../library";
import { createFilesystemContentStore } from "../filesystem";
import { workspaceScopedRoot } from "../../../shared/workspace-scope";

/**
 * The Content root, scoped to one workspace. Directory scoping lives in exactly
 * one module, and it is reached from here rather than from the plugin so the
 * `workspace-v1-` prefix is never spelled a second time in the Vite config
 * graph, which cannot import TypeScript.
 */
export function createWorkspaceScopedContentStore(contentRoot: string, workspaceId: string) {
  return createFilesystemContentStore({ contentRoot: workspaceScopedRoot(contentRoot, workspaceId) });
}
export { CONTENT_FILE_PROVIDER_OPERATIONS } from "./types";

export function isContentPersistenceError(value: unknown): boolean {
  return value instanceof ContentPersistenceError;
}
