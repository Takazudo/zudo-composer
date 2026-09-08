import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { createDomainFileProviderMiddleware, domainFileProviderEndpoint } from "../domain-file-provider.mjs";
import workspaceDomainProvider from "../workspace-domain-provider.mjs";
import * as entry from "../../src/app/workspace-filesystem/dev-server-entry";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("workspace registry endpoint identity validation", () => {
  it.each(["../escape", "/tmp/escape", "alpha/../../escape", "Alpha", "", null, 123])("returns a specific 400 and refuses filesystem traversal for id %j", async (id) => {
    const root = await mkdtemp(join(tmpdir(), "zudo-workspace-wire-"));
    roots.push(root);
    const registryRoot = join(root, "workspaces");
    const provider = workspaceDomainProvider({ registryRoot, domainRoots: { compositions: join(root, "compositions"), content: join(root, "content"), mappings: join(root, "mappings"), sitemaps: join(root, "sitemaps") } });
    const service = await entry.createWorkspaceRegistryService({ registryRoot, domainRoots: { compositions: join(root, "compositions"), content: join(root, "content"), mappings: join(root, "mappings"), sitemaps: join(root, "sitemaps") } });
    const before = await readdir(root, { recursive: true });
    const generation = await service.generation();
    const binding = provider.bind(entry, registryRoot);
    expectTypeOf<Awaited<ReturnType<typeof binding.createStore>>>().toEqualTypeOf<entry.WorkspaceRegistryService>();
    const handler = createDomainFileProviderMiddleware({ domain: provider.domain, workspaceScoped: false, capability: "test-capability", ...binding });
    for (const operation of ["open", "create", "mark-seed-cleanup", "discard-seeding", "complete", "update", "delete-directories", "missing-directories"]) {
      const response = await handler({
        url: domainFileProviderEndpoint("workspace"), method: "POST", protocol: "http",
        headers: { host: "localhost:5173", origin: "http://localhost:5173", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-zudo-composer-capability": "test-capability", "x-zudo-composer-operation": operation },
        body: JSON.stringify({ id }),
      });
      expect(response.status, operation).toBe(400);
      expect(JSON.parse(response.body).error, operation).toMatchObject({ domain: "workspace", code: "validation", message: "Invalid workspace identity; a workspace id must be a stable path-safe id." });
    }
    expect(await service.generation()).toBe(generation);
    expect(await readdir(root, { recursive: true })).toEqual(before);
  });
});
