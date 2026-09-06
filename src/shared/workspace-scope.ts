// Workspace scoping, on disk.
//
// This lives in `shared/` rather than beside the workspace registry because the
// four authoring domains reach it from their own dev-server entries, and a
// domain may not import the application layer.
//
// In the browser a workspace is a *name* prefix: an `IDBFactory` Proxy rewrites
// every provider's database to `<database>-workspace-v1-<id>`, so the four
// authoring domains land in four separate databases per workspace. There is
// exactly one place that mangling happens, and it happens per provider store.
//
// The filesystem analogue is a *directory* prefix applied at the same point:
// each authoring domain root gains one `workspace-v1-<id>/` subdirectory, and a
// domain store is handed that path instead of the domain root. Scoping per
// domain root rather than re-rooting the whole CMS tree is what keeps the
// host's independently configurable `compositionsDir` / `contentDir` /
// `mappingsDir` / `sitemapsDir` meaningful — a host may point them anywhere,
// and each still carries its own workspaces.
//
// Media is deliberately not scoped, exactly as it is not scoped in IndexedDB:
// the Media store is a separate provider that is not one of the four authoring
// domains, and no workspace owns its bytes.

import { join } from "node:path";
import { isSafeRecordId } from "./record-identity";

/** Shared by the database name and the directory name; the same generation of scoping. */
export const WORKSPACE_DIRECTORY_PREFIX = "workspace-v1-";

/** The authoring domains a workspace scopes. Mirrors the four scoped databases. */
export interface WorkspaceDomainRoots {
  compositions: string;
  content: string;
  mappings: string;
  sitemaps: string;
}

/**
 * Workspace ids are filenames here, so they are held to the record-id rule
 * rather than IndexedDB's looser name rule: lower-case and case-stable, so two
 * workspaces cannot collide on a case-insensitive filesystem.
 */
export function isSafeWorkspaceId(id: unknown): id is string {
  return isSafeRecordId(id);
}

export function assertWorkspaceDirectoryId(id: unknown): asserts id is string {
  if (!isSafeWorkspaceId(id)) throw new Error("Invalid workspace identity; a workspace id must be a stable path-safe id.");
}

export function workspaceDirectoryName(id: string): string {
  assertWorkspaceDirectoryId(id);
  return `${WORKSPACE_DIRECTORY_PREFIX}${id}`;
}

/** One domain root, scoped to one workspace. */
export function workspaceScopedRoot(domainRoot: string, id: string): string {
  return join(domainRoot, workspaceDirectoryName(id));
}

export function workspaceDomainRoots(roots: WorkspaceDomainRoots, id: string): WorkspaceDomainRoots {
  return {
    compositions: workspaceScopedRoot(roots.compositions, id),
    content: workspaceScopedRoot(roots.content, id),
    mappings: workspaceScopedRoot(roots.mappings, id),
    sitemaps: workspaceScopedRoot(roots.sitemaps, id),
  };
}
