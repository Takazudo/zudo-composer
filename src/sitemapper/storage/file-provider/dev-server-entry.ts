// Loaded only by the active Vite development server. Keeping this Node-side
// import behind `ssrLoadModule` prevents filesystem modules entering clients.
//
// The plugin graph cannot use `instanceof`, so the domain-error predicate is
// exported from here rather than reimplemented as a duck-type check.
import { SitemapPersistenceError } from "../../library";
import { createFilesystemSitemapStore } from "../filesystem";
import { workspaceScopedRoot } from "../../../shared/workspace-scope";

/** The Sitemapper root, scoped to one workspace. */
export function createWorkspaceScopedSitemapStore(sitemapsRoot: string, workspaceId: string) {
  return createFilesystemSitemapStore({ sitemapsRoot: workspaceScopedRoot(sitemapsRoot, workspaceId) });
}
export { SITEMAP_FILE_PROVIDER_OPERATIONS } from "./types";

export function isSitemapPersistenceError(value: unknown): boolean {
  return value instanceof SitemapPersistenceError;
}
