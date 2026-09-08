// Loaded only by the active Vite development server. Keeping these Node-side
// imports behind `ssrLoadModule` prevents the registry's filesystem modules
// entering the browser bundle.
//
// The registry endpoint is the one file-provider domain that is *not* workspace
// scoped: it is what names workspaces in the first place, so it answers from a
// single registry root while every other domain answers from a directory below
// it.
//
// Two responsibilities live here rather than in the registry itself:
//
//   * The cross-process seed lock. `withWorkspaceSeedLock` is a scoped
//     callback, and a scope cannot be held across a browser round-trip — a tab
//     that dies mid-seed would leave a lock the module never steals, wedging
//     that workspace until a human removed the file. So the lock is taken
//     around each registry transition that a second dev-server process could
//     interleave with, and released before the response is written. Serializing
//     the whole browser-driven seed across tabs stays with Web Locks, which
//     release when their tab goes away.
//   * The workspace's authoring directories: removal during seed cleanup, and
//     the existence check a ready workspace makes before it trusts its own
//     records.

import { lstat } from "node:fs/promises";
import { errorCode } from "../../shared/node-fs";
import type { SiteProject } from "../../site-project/model";
import { assertRegistryWorkspaceId, createFilesystemWorkspaceRegistry, type WorkspaceMetadataPatch } from "./registry";
import { deleteWorkspaceDirectories } from "./seed-cleanup";
import { withWorkspaceSeedLock } from "./seed-lock";
import { workspaceDomainRoots, type WorkspaceDomainRoots } from "../../shared/workspace-scope";
import { WorkspaceRegistryError, type WorkspaceRegistryOperation } from "./types";

export function isWorkspaceRegistryError(value: unknown): boolean {
  return value instanceof WorkspaceRegistryError;
}

export interface WorkspaceRegistryServiceOptions {
  /** `<paths.data>/workspaces`; the registry documents and the lock directories. */
  registryRoot: string;
  /** The four unscoped authoring domain roots this host is configured with. */
  domainRoots: WorkspaceDomainRoots;
}

/**
 * The whole registry surface the browser reaches, with the lock and directory
 * work already folded in. Each method is one wire operation.
 */
export async function createWorkspaceRegistryService(options: WorkspaceRegistryServiceOptions) {
  const registry = await createFilesystemWorkspaceRegistry({ registryRoot: options.registryRoot });
  const locked = async <T>(id: string, operation: WorkspaceRegistryOperation, action: () => Promise<T>): Promise<T> => {
    assertRegistryWorkspaceId(id, operation);
    return withWorkspaceSeedLock(id, { registryRoot: options.registryRoot }, action);
  };

  return {
    list: () => registry.list(),
    selection: () => registry.selection(),
    generation: () => registry.generation(),
    /** `null` rather than `undefined`, so the answer survives JSON. */
    open: async (id?: string) => (await registry.open(id)) ?? null,
    findSeeding: async (project: SiteProject, revision: string) =>
      (await registry.findSeeding(project, revision)) ?? null,

    create: (project: SiteProject, baselineRevision: string, id: string | undefined, requiresBeforeComplete: boolean) =>
      id === undefined
        ? registry.create(project, baselineRevision, undefined, requiresBeforeComplete)
        : locked(id, "create", () => registry.create(project, baselineRevision, id, requiresBeforeComplete)),
    markSeedCleanup: (id: string, revision: string) => locked(id, "discard", () => registry.markSeedCleanup(id, revision)),
    discardSeeding: (id: string, revision: string) => locked(id, "discard", () => registry.discardSeeding(id, revision)),
    complete: (id: string, creationValidated: boolean) => locked(id, "complete", () => registry.complete(id, creationValidated)),
    update: (id: string, expectedToken: number, patch: WorkspaceMetadataPatch) => registry.update(id, expectedToken, patch),

    deleteDirectories: (id: string) => locked(id, "discard", () => deleteWorkspaceDirectories(options.domainRoots, id)),

    /**
     * Which of the workspace's four authoring directories are absent. A ready
     * workspace with a missing directory has lost records the registry still
     * claims, and the app refuses to open it rather than silently re-seeding.
     */
    missingDirectories: async (id: string): Promise<readonly string[]> => {
      assertRegistryWorkspaceId(id, "read");
      const scoped = workspaceDomainRoots(options.domainRoots, id);
      const missing: string[] = [];
      for (const [domain, path] of Object.entries(scoped)) {
        try {
          const stats = await lstat(path);
          if (!stats.isDirectory() || stats.isSymbolicLink()) missing.push(domain);
        } catch (cause) {
          if (errorCode(cause) === "ENOENT") missing.push(domain);
          else throw new WorkspaceRegistryError("read", "read-failed", `Could not inspect the workspace directory ${path}.`, true, { cause });
        }
      }
      return missing;
    },
  };
}

export type WorkspaceRegistryService = Awaited<ReturnType<typeof createWorkspaceRegistryService>>;
