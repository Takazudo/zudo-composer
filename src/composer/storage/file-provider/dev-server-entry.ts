// Loaded only by the active Vite development server. Keeping these Node-side
// imports behind `ssrLoadModule` prevents production config evaluation from
// traversing the Composer filesystem implementation.
import { createFilesystemCompositionStore } from "../filesystem";
import type { FilesystemCompositionStoreOptions } from "../filesystem";
import { workspaceScopedRoot } from "../../../shared/workspace-scope";

export { validateCompositionRecord } from "../../library/validate";

/**
 * The compositions root, scoped to one workspace. Directory scoping lives in
 * exactly one module, and it is reached from here rather than from the plugin
 * so the `workspace-v1-` prefix is never spelled a second time in the Vite
 * config graph, which cannot import TypeScript.
 */
export function createWorkspaceScopedCompositionStore(
  compositionsRoot: string,
  workspaceId: string,
  options: Omit<FilesystemCompositionStoreOptions, "compositionsRoot">,
) {
  return createFilesystemCompositionStore({ ...options, compositionsRoot: workspaceScopedRoot(compositionsRoot, workspaceId) });
}
