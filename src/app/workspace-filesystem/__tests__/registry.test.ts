// The filesystem workspace registry.
//
// Every assertion that survives the move is ported from the browser registry's
// coverage in `src/app/__tests__/workspace-state.test.ts` and
// `provider-integration.test.ts` — reserved identity, seeding resume, the
// cleanup marker ordering, the metadata CAS precondition. The rest cover what
// only a filesystem registry can get wrong: durability across a restart, and
// isolation between two workspaces on disk.

import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activeSiteProjectValidationContext } from "../../site-project-manifest";
import { loadSampleSiteProject } from "../../../test/site-project-fixture";
import { createFilesystemWorkspaceRegistry, type FilesystemWorkspaceRegistry } from "../registry";
import { WORKSPACE_META_RECORD_ID, WORKSPACE_SELECTION_RECORD_ID, WorkspaceRegistryError } from "../types";
import { workspaceDirectoryName, workspaceDomainRoots, workspaceScopedRoot } from "../../../shared/workspace-scope";
import { deleteWorkspaceDirectories } from "../seed-cleanup";

const revision = "a".repeat(64);
const other = "b".repeat(64);
const sample = () => loadSampleSiteProject(activeSiteProjectValidationContext);

const roots: string[] = [];

async function registryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zudo-workspace-registry-"));
  roots.push(root);
  return root;
}

function open(root: string): Promise<FilesystemWorkspaceRegistry> {
  return createFilesystemWorkspaceRegistry({ registryRoot: join(root, "workspaces") });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("filesystem workspace registry", () => {
  it("rejects malformed identities before mutation and the complete no-op", async () => {
    const registry = await open(await registryRoot());
    await registry.create(sample(), revision, "alpha");
    await registry.complete("alpha");
    const generation = await registry.generation();
    for (const id of ["../escape", "Alpha", ""]) {
      for (const [operation, invoke] of [
        ["read", () => registry.open(id)],
        ["create", () => registry.create(sample(), revision, id)],
        ["discard", () => registry.markSeedCleanup(id, revision)],
        ["discard", () => registry.discardSeeding(id, revision)],
        ["complete", () => registry.complete(id)],
        ["update", () => registry.update(id, 1, { name: "Changed" })],
      ] as const) {
        await expect(invoke()).rejects.toBeInstanceOf(WorkspaceRegistryError);
        await expect(invoke()).rejects.toMatchObject({ operation, code: "validation", retryable: false, message: expect.stringContaining("path-safe") });
      }
    }
    expect(await registry.generation()).toBe(generation);
    expect(await registry.selection()).toBe("alpha");
  });

  it("stamps its layout and starts with no workspace selected", async () => {
    const root = await registryRoot();
    const registry = await open(root);
    expect(await registry.list()).toEqual([]);
    expect(await registry.selection()).toBeNull();
    expect(await registry.open()).toBeUndefined();
    const documents = await readdir(join(registry.root, "generations", "1"));
    expect(documents.sort()).toEqual([`${WORKSPACE_META_RECORD_ID}.json`, `${WORKSPACE_SELECTION_RECORD_ID}.json`]);
  });

  it("round-trips creation, selection, rename and deletion across a restart", async () => {
    const root = await registryRoot();
    const first = await open(root);
    const created = await first.create(sample(), revision, "alpha");
    expect(created.status).toBe("seeding");

    // A restart sees the seeding attempt, and resuming it returns the same one.
    const second = await open(root);
    expect(await second.findSeeding(sample(), revision)).toMatchObject({ id: "alpha", status: "seeding" });
    expect(await second.create(sample(), revision, "alpha")).toMatchObject({ id: "alpha", mutationToken: 0 });
    const ready = await second.complete("alpha");
    expect(ready).toMatchObject({ status: "ready", mutationToken: 1 });
    expect(ready.seed).toBeUndefined();

    const third = await open(root);
    expect(await third.selection()).toBe("alpha");
    const renamed = await third.update("alpha", ready.mutationToken, { name: "Renamed" });
    expect(renamed.metadata.name).toBe("Renamed");

    // Rename survives the next restart, and its token moved with it.
    const fourth = await open(root);
    expect(await fourth.open()).toMatchObject({ id: "alpha", metadata: { name: "Renamed" }, mutationToken: renamed.mutationToken });

    // Deletion is the seeding-attempt path: ready workspaces are never removed.
    await fourth.create(sample(), other, "beta");
    await fourth.markSeedCleanup("beta", other);
    await fourth.discardSeeding("beta", other);
    const fifth = await open(root);
    expect((await fifth.list()).map((record) => record.id)).toEqual(["alpha"]);
    expect(await fifth.selection()).toBe("alpha");
  });

  it("does not write a new generation when completing the ready, active workspace", async () => {
    const root = await registryRoot();
    const registry = await open(root);
    await registry.create(sample(), revision, "alpha");
    const ready = await registry.complete("alpha");
    const generation = await registry.generation();
    const before = await snapshotTree(registry.root);

    expect(await registry.complete("alpha")).toEqual(ready);

    expect(await registry.generation()).toBe(generation);
    expect(await snapshotTree(registry.root)).toEqual(before);
    const reopened = await open(root);
    expect(await reopened.selection()).toBe("alpha");
    expect(await reopened.open()).toEqual(ready);
  });

  it("selects a ready, inactive workspace in a new durable generation", async () => {
    const root = await registryRoot();
    const registry = await open(root);
    await registry.create(sample(), revision, "alpha");
    const alpha = await registry.complete("alpha");
    await registry.create(sample(), other, "beta");
    await registry.complete("beta");
    expect(await registry.selection()).toBe("beta");
    const generation = await registry.generation();

    expect(await registry.complete("alpha")).toEqual(alpha);

    expect(await registry.generation()).toBe(generation + 1);
    const reopened = await open(root);
    expect(await reopened.selection()).toBe("alpha");
    expect(await reopened.open()).toEqual(alpha);
  });

  it("refuses a stale metadata update and keeps the stored record unchanged", async () => {
    const root = await registryRoot();
    const registry = await open(root);
    await registry.create(sample(), revision, "alpha");
    const ready = await registry.complete("alpha");
    await registry.update("alpha", ready.mutationToken, { name: "First" });
    await expect(registry.update("alpha", ready.mutationToken, { name: "Second" })).rejects.toMatchObject({ code: "conflict" });
    expect(await registry.open("alpha")).toMatchObject({ metadata: { name: "First" } });
  });

  it("refuses reserved and unsafe workspace identities", async () => {
    const root = await registryRoot();
    const registry = await open(root);
    await expect(registry.create(sample(), revision, WORKSPACE_SELECTION_RECORD_ID)).rejects.toBeInstanceOf(WorkspaceRegistryError);
    await expect(registry.create(sample(), revision, WORKSPACE_META_RECORD_ID)).rejects.toBeInstanceOf(WorkspaceRegistryError);
    await expect(registry.create(sample(), revision, "../escape")).rejects.toMatchObject({ name: "WorkspaceRegistryError", operation: "create", code: "validation", message: expect.stringMatching(/path-safe/) });
    await expect(registry.create(sample(), revision, "Alpha")).rejects.toMatchObject({ name: "WorkspaceRegistryError", operation: "create", code: "validation", message: expect.stringMatching(/path-safe/) });
    expect(await registry.list()).toEqual([]);
  });

  it("refuses a resumed creation that skipped its before-complete validation", async () => {
    const root = await registryRoot();
    const registry = await open(root);
    await registry.create(sample(), revision, "alpha", true);
    await expect(registry.complete("alpha")).rejects.toMatchObject({ code: "conflict" });
    expect(await registry.complete("alpha", true)).toMatchObject({ status: "ready" });
    expect(Object.hasOwn((await registry.open("alpha"))!, "requiresBeforeComplete")).toBe(false);
  });

  it("cannot discard a seeding attempt before its cleanup marker is persisted", async () => {
    const root = await registryRoot();
    const registry = await open(root);
    await registry.create(sample(), revision, "alpha");
    await expect(registry.discardSeeding("alpha", revision)).rejects.toMatchObject({ code: "conflict" });
    await expect(registry.markSeedCleanup("alpha", other)).rejects.toMatchObject({ code: "conflict" });
    await registry.markSeedCleanup("alpha", revision);
    await expect(registry.complete("alpha")).rejects.toMatchObject({ code: "conflict" });
    await registry.discardSeeding("alpha", revision);
    expect(await registry.list()).toEqual([]);
  });

  // Editing a generation document breaks its pointer digest, so this is the
  // record store's tamper guard rather than the registry's own decoding — which
  // is the point: a hand-edited registry is refused before it is interpreted.
  it("refuses a tampered registry document instead of repairing it", async () => {
    const root = await registryRoot();
    const registry = await open(root);
    await registry.create(sample(), revision, "alpha");
    const generation = (await readdir(join(registry.root, "generations"))).sort((a, b) => Number(b) - Number(a))[0]!;
    const document = join(registry.root, "generations", generation, "alpha.json");
    const original = await readFile(document, "utf8");
    await writeFile(document, JSON.stringify({ schemaVersion: 1, id: "alpha" }));
    await expect(registry.list()).rejects.toBeInstanceOf(WorkspaceRegistryError);
    await writeFile(document, original);
  });
});

describe("workspace scoping on disk", () => {
  it("prefixes every authoring domain root and leaves assets unscoped", () => {
    const domains = { compositions: "/cms/compositions", content: "/elsewhere/content", mappings: "/cms/mappings", sitemaps: "/cms/sitemaps" };
    expect(workspaceDomainRoots(domains, "alpha")).toEqual({
      compositions: "/cms/compositions/workspace-v1-alpha",
      content: "/elsewhere/content/workspace-v1-alpha",
      mappings: "/cms/mappings/workspace-v1-alpha",
      sitemaps: "/cms/sitemaps/workspace-v1-alpha",
    });
    expect(workspaceDirectoryName("alpha")).toBe("workspace-v1-alpha");
    expect(() => workspaceScopedRoot("/cms/content", "../escape")).toThrow(/path-safe/);
  });

  it("keeps two workspaces byte-identical when only one is written", async () => {
    const root = await registryRoot();
    const domains = { compositions: join(root, "compositions"), content: join(root, "content"), mappings: join(root, "mappings"), sitemaps: join(root, "sitemaps") };
    const { createTransactionalRecordStore } = await import("../../../shared/node-fs");
    const options = (workspace: string) => ({
      root: workspaceDomainRoots(domains, workspace).content,
      schemaVersion: 1,
      errors: {
        isError: (value: unknown) => value instanceof Error,
        create: (_operation: string, _code: string, message: string) => new Error(message),
        rethrow: (_operation: string, _code: string, message: string, cause: unknown) => { throw new Error(message, { cause }); },
      },
      rootLabel: "Content records root",
      ownerLabel: "Content",
      recordLabel: "content record",
      phases: { initialize: "initialize", snapshot: "list", commit: "transact" },
    });
    const alpha = await createTransactionalRecordStore(options("alpha") as never);
    const beta = await createTransactionalRecordStore(options("beta") as never);
    await beta.commit(() => ({ records: [{ id: "shared", json: '{"origin":"beta"}\n' }], result: null }));

    const before = await snapshotTree(domains.content);
    await alpha.commit(() => ({ records: [{ id: "shared", json: '{"origin":"alpha"}\n' }], result: null }));
    const after = await snapshotTree(domains.content);

    const betaBefore = before.filter(([path]) => path.includes("workspace-v1-beta"));
    const betaAfter = after.filter(([path]) => path.includes("workspace-v1-beta"));
    expect(betaAfter).toEqual(betaBefore);
    expect(betaAfter.length).toBeGreaterThan(0);
    expect(await beta.snapshot()).toMatchObject({ records: [{ id: "shared", json: '{"origin":"beta"}\n' }] });
    expect(await alpha.snapshot()).toMatchObject({ records: [{ id: "shared", json: '{"origin":"alpha"}\n' }] });
  });
});

describe("workspace directory cleanup", () => {
  it("removes only the named workspace's directories and tolerates missing ones", async () => {
    const root = await registryRoot();
    const domains = { compositions: join(root, "compositions"), content: join(root, "content"), mappings: join(root, "mappings"), sitemaps: join(root, "sitemaps") };
    const alpha = workspaceDomainRoots(domains, "alpha");
    const beta = workspaceDomainRoots(domains, "beta");
    await mkdir(join(alpha.content, "generations", "1"), { recursive: true });
    await writeFile(join(alpha.content, "generations", "1", "record.json"), "{}");
    await mkdir(beta.content, { recursive: true });
    await writeFile(join(beta.content, "marker"), "beta");

    await deleteWorkspaceDirectories(domains, "alpha");
    await expect(readdir(alpha.content)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(beta.content)).toEqual(["marker"]);
  });

  it("refuses to remove a workspace path that is not a plain directory", async () => {
    const root = await registryRoot();
    const domains = { compositions: join(root, "compositions"), content: join(root, "content"), mappings: join(root, "mappings"), sitemaps: join(root, "sitemaps") };
    const alpha = workspaceDomainRoots(domains, "alpha");
    await mkdir(domains.content, { recursive: true });
    await mkdir(join(root, "outside"), { recursive: true });
    await symlink(join(root, "outside"), alpha.content);

    await expect(deleteWorkspaceDirectories(domains, "alpha")).rejects.toMatchObject({ code: "blocked" });
    expect(await readdir(join(root, "outside"))).toEqual([]);
  });
});

/** Every file below `root`, as `[relative path, contents]`, sorted. */
async function snapshotTree(root: string): Promise<[string, string][]> {
  const files: [string, string][] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(path, `${relative}/`);
      else files.push([relative, await readFile(path, "utf8")]);
    }
  };
  await walk(root, "");
  return files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
