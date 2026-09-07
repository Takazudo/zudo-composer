// The capture protocol, unchanged by the move to disk.
//
// `captureWorkspaceSnapshot` reads every durable token, then every snapshot,
// then every token again, and retries three times before reporting `changed`.
// Nothing about that is storage-specific — which is the point of these tests:
// the same invariant has to hold when the tokens are filesystem generations
// rather than in-memory counters, across the workspace registry plus the four
// authoring domains.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activeSiteProjectValidationContext } from "../../site-project-manifest";
import { loadSampleSiteProject } from "../../../test/site-project-fixture";
import { createWorkspaceSaveRegistry } from "../../workspace-sessions";
import { captureWorkspaceSnapshot, checkWorkspaceCapture, type WorkspaceSnapshotSource } from "../../workspace-snapshot";
import { createTransactionalRecordStore, type TransactionalRecordStore } from "../../../shared/node-fs";
import { createFilesystemWorkspaceRegistry, type FilesystemWorkspaceRegistry } from "../registry";
import { workspaceDomainRoots } from "../../../shared/workspace-scope";

const revision = "a".repeat(64);
const sample = () => loadSampleSiteProject(activeSiteProjectValidationContext);
const DOMAINS = ["compositions", "content", "mappings", "sitemaps"] as const;
type Domain = (typeof DOMAINS)[number];

const roots: string[] = [];

const errors = {
  isError: (value: unknown) => value instanceof Error,
  create: (_operation: string, _code: string, message: string) => new Error(message),
  rethrow: (_operation: string, _code: string, message: string, cause: unknown) => { throw new Error(message, { cause }); },
};

interface Workspace {
  registry: FilesystemWorkspaceRegistry;
  stores: Record<Domain, TransactionalRecordStore<string>>;
  sources: WorkspaceSnapshotSource[];
}

async function workspace(id: string): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), "zudo-workspace-capture-"));
  roots.push(root);
  const registry = await createFilesystemWorkspaceRegistry({ registryRoot: join(root, "workspaces") });
  await registry.create(sample(), revision, id);
  await registry.complete(id);

  const scoped = workspaceDomainRoots({
    compositions: join(root, "compositions"),
    content: join(root, "content"),
    mappings: join(root, "mappings"),
    sitemaps: join(root, "sitemaps"),
  }, id);
  const stores = {} as Record<Domain, TransactionalRecordStore<string>>;
  for (const domain of DOMAINS) {
    stores[domain] = await createTransactionalRecordStore<string>({
      root: scoped[domain],
      schemaVersion: 1,
      errors,
      rootLabel: `${domain} root`,
      ownerLabel: domain,
      recordLabel: `${domain} record`,
      phases: { initialize: "initialize", snapshot: "list", commit: "transact" },
    });
  }
  const sources: WorkspaceSnapshotSource[] = [
    registry.snapshotSource(id),
    ...DOMAINS.map((domain): WorkspaceSnapshotSource => ({
      id: `${domain}:filesystem`,
      token: () => stores[domain].mutationToken(),
      read: async () => {
        const snapshot = await stores[domain].snapshot();
        return { mutationToken: snapshot.mutationToken, value: snapshot.records };
      },
    })),
  ];
  return { registry, stores, sources };
}

function write(store: TransactionalRecordStore<string>, json: string): Promise<null> {
  return store.commit(() => ({ records: [{ id: "record", json }], result: null }));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("coherent filesystem capture", () => {
  it("captures all five domains and stays current until something writes", async () => {
    const { registry, stores, sources } = await workspace("alpha");
    for (const domain of DOMAINS) await write(stores[domain], `{"domain":"${domain}"}\n`);
    const sessions = createWorkspaceSaveRegistry();

    const outcome = await captureWorkspaceSnapshot("alpha", sessions, sources);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(Object.keys(outcome.capture.tokens).sort()).toEqual([
      "compositions:filesystem", "content:filesystem", "mappings:filesystem", "sitemaps:filesystem", "workspace",
    ]);
    expect(outcome.capture.tokens.workspace).toBe((await registry.open("alpha"))!.mutationToken);
    expect(await checkWorkspaceCapture(outcome.capture, "alpha", sessions, sources)).toBe(true);

    await write(stores.mappings, '{"domain":"mappings","edited":true}\n');
    expect(await checkWorkspaceCapture(outcome.capture, "alpha", sessions, sources)).toBe(false);
  });

  it("fails the capture when a write lands mid-read", async () => {
    const { stores, sources } = await workspace("alpha");
    for (const domain of DOMAINS) await write(stores[domain], `{"domain":"${domain}"}\n`);
    const sessions = createWorkspaceSaveRegistry();

    // A writer that commits to `sitemaps` while `content` is being read, on
    // every attempt: the after-token can never match the embedded one.
    let writes = 0;
    const racing = sources.map((source) => (source.id !== "content:filesystem" ? source : {
      ...source,
      read: async () => {
        const value = await source.read();
        writes += 1;
        await write(stores.sitemaps, `{"domain":"sitemaps","write":${writes}}\n`);
        return value;
      },
    }));

    const outcome = await captureWorkspaceSnapshot("alpha", sessions, racing);
    expect(outcome).toMatchObject({ status: "changed", sources: ["sitemaps:filesystem"] });
    expect(writes).toBe(3);
  });

  it("retries and succeeds when the interfering write stops", async () => {
    const { stores, sources } = await workspace("alpha");
    for (const domain of DOMAINS) await write(stores[domain], `{"domain":"${domain}"}\n`);
    const sessions = createWorkspaceSaveRegistry();

    let interfered = false;
    const racing = sources.map((source) => (source.id !== "content:filesystem" ? source : {
      ...source,
      read: async () => {
        const value = await source.read();
        if (!interfered) {
          interfered = true;
          await write(stores.sitemaps, '{"domain":"sitemaps","late":true}\n');
        }
        return value;
      },
    }));

    expect(await captureWorkspaceSnapshot("alpha", sessions, racing)).toMatchObject({ status: "ready" });
  });

  it("reports the failing source when one domain cannot be read", async () => {
    const { sources } = await workspace("alpha");
    const broken = sources.map((source) => (source.id !== "mappings:filesystem" ? source : {
      ...source,
      read: async () => { throw new Error("mappings root is gone"); },
    }));
    expect(await captureWorkspaceSnapshot("alpha", createWorkspaceSaveRegistry(), broken)).toMatchObject({
      status: "unavailable",
      source: "mappings:filesystem",
    });
  });
});
