import { lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiteProjectActiveSelection, SiteProjectApiRequest, SiteProjectApiResponse, SiteProjectApiService } from "../../../src/site-project/api/types";
import { entry, project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { readActivatedSiteRelease } from "../dev-reader";
import { seedSiteProject } from "../seed";
import { createLocalSiteProjectApiService } from "../service";
import { createLocalSiteProjectStore, type LocalSiteProjectStoreOptions } from "../store";
import { call, pack, review, toolchain } from "./release-fixture";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(overrides: LocalSiteProjectStoreOptions = {}) {
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), "seed-local-service-")));
  directories.push(workspaceRoot);
  const options = { workspaceRoot, pack, toolchain, assetsStoreRoot: join(workspaceRoot, "assets"), ...overrides };
  const store = createLocalSiteProjectStore({ ...options, componentPack: pack.manifest });
  return { options, store, service: createLocalSiteProjectApiService(options) };
}

function observe(service: SiteProjectApiService, hook: {
  before?(request: SiteProjectApiRequest): Promise<void>;
  after?(request: SiteProjectApiRequest, response: SiteProjectApiResponse): Promise<void>;
} = {}) {
  const requests: SiteProjectApiRequest[] = [];
  return {
    requests,
    service: {
      ...service,
      async handle(raw: unknown) {
        const request = raw as SiteProjectApiRequest;
        requests.push(structuredClone(request));
        await hook.before?.(request);
        const response = await service.handle(request);
        await hook.after?.(request, response);
        return response;
      },
    },
  };
}

async function fileSnapshot(root: string): Promise<unknown> {
  const result: unknown[] = [];
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name);
    const stat = await lstat(path);
    result.push(stat.isDirectory()
      ? [name, await fileSnapshot(path)]
      : [name, stat.ino, stat.mtimeMs, stat.ctimeMs, await readFile(path, "utf8")]);
  }
  return result;
}

const draftProject = () => project({ entries: [entry("first"), entry("second")].map((record) => ({ ...record, lifecycle: "draft" })) });
const identity = ({ projectId, revision, buildId }: SiteProjectActiveSelection): SiteProjectActiveSelection => ({ projectId, revision, buildId });

describe("seed through the local SiteProject API service", () => {
  it("activates the first committed project and makes its published contents available to the dev reader", async () => {
    const { options, store, service } = await fixture();
    await expect(lstat(store.root)).rejects.toMatchObject({ code: "ENOENT" });
    const observed = observe(service);
    const source = draftProject();
    const result = await seedSiteProject(source, options, observed);
    expect(result).toEqual({ projectId: source.id, revision: expect.stringMatching(/^[a-f0-9]{64}$/), buildId: expect.stringMatching(/^[a-f0-9]{64}$/), status: "activated" });
    expect(observed.requests.map(({ operation }) => operation)).toEqual(["list", "plan", "apply", "build", "activate"]);
    expect(observed.requests[1]).toMatchObject({
      protocolVersion: 2, operation: "plan", workingPrecondition: null, expectedRevision: null, expectedActive: null,
      selection: ["first", "second"].map((recordId) => ({ ref: { providerId: "content-filesystem", modelId: "articles", recordId }, action: "publish" })),
    });
    expect(observed.requests[4]).toEqual({ protocolVersion: 2, operation: "activate", ...identity(result), expectedActive: null });
    const active = await readActivatedSiteRelease({ ...options, componentPack: pack.manifest });
    expect(active?.release.identity).toEqual(identity(result));
    expect(active?.release.build.routes.map(({ pathname }) => pathname)).toEqual(["/"]);
    expect(active?.project.providers.content[0]!.entries.map(({ id, lifecycle }) => ({ id, lifecycle })))
      .toEqual(["first", "second"].map((id) => ({ id, lifecycle: "published" })));
    expect(source.providers.content[0]!.entries.every(({ lifecycle }) => lifecycle === "draft")).toBe(true);
  });

  it("repeats the same committed draft input as a verified no-op without changing release files", async () => {
    const { options, store, service } = await fixture();
    const source = draftProject();
    const first = await seedSiteProject(source, options);
    const before = await fileSnapshot(store.root);
    const observed = observe(service);
    expect(await seedSiteProject(source, options, observed)).toEqual({ ...first, status: "unchanged" });
    expect(observed.requests.map(({ operation }) => operation)).toEqual(["list", "get", "plan", "list"]);
    expect(observed.requests[2]).toMatchObject({ operation: "plan", expectedRevision: first.revision, expectedActive: identity(first), selection: [] });
    expect(await fileSnapshot(store.root)).toEqual(before);
  });

  it("selects changed/new committed entries and removes absent ones without republishing unchanged entries", async () => {
    const { options, service } = await fixture();
    const source = draftProject();
    source.providers.content[0]!.entries.push({ ...entry("retained"), lifecycle: "draft" });
    const first = await seedSiteProject(source, options);
    const next = structuredClone(source);
    next.providers.content[0]!.entries = [
      { ...entry("first", "Changed"), lifecycle: "draft" },
      { ...entry("new"), lifecycle: "draft" },
      { ...entry("retained"), lifecycle: "draft" },
    ];
    const observed = observe(service);
    const result = await seedSiteProject(next, options, observed);
    expect(result.status).toBe("activated");
    expect(result.revision).not.toBe(first.revision);
    expect(observed.requests[2]).toMatchObject({
      operation: "plan", expectedRevision: first.revision, expectedActive: identity(first),
      selection: [
        { ref: { providerId: "content-filesystem", modelId: "articles", recordId: "first" }, action: "publish" },
        { ref: { providerId: "content-filesystem", modelId: "articles", recordId: "new" }, action: "publish" },
        { ref: { providerId: "content-filesystem", modelId: "articles", recordId: "second" }, action: "delete" },
      ],
    });
    const active = await readActivatedSiteRelease({ ...options, componentPack: pack.manifest });
    expect(active?.project.providers.content[0]!.entries.map(({ id }) => id)).toEqual(["first", "new", "retained"]);
    expect(await seedSiteProject(next, options)).toEqual({ ...result, status: "unchanged" });
  });

  it("preserves distinct non-null project-head and active-project CAS values verbatim", async () => {
    const { options, service } = await fixture();
    const original = project();
    const first = await seedSiteProject(original, options);
    const pending = await review(service, { ...original, name: "Pending head" }, { expectedRevision: first.revision, expectedActive: identity(first) });
    await call(service, "apply", { plan: pending });
    const other = await seedSiteProject({ ...original, id: "other-project" }, options);
    const observed = observe(service);
    const result = await seedSiteProject({ ...original, name: "Committed update" }, options, observed);
    expect(observed.requests[1]).toMatchObject({ operation: "plan", expectedRevision: pending.projectRevision, expectedActive: identity(other) });
    const applied = observed.requests.find((request) => request.operation === "apply");
    expect(applied).toMatchObject({ plan: { expectedRevision: pending.projectRevision, expectedActive: identity(other) } });
    expect(observed.requests.at(-1)).toEqual({ protocolVersion: 2, operation: "activate", ...identity(result), expectedActive: identity(other) });
  });

  it("accepts the service's idempotent apply response without a top-level revision", async () => {
    const { options, service } = await fixture();
    const observed = observe(service, {
      async before(request) {
        if (request.operation === "apply") expect(await service.handle(request)).toMatchObject({ ok: true });
      },
      async after(request, response) {
        if (request.operation === "apply") {
          expect(response).toMatchObject({ ok: true, result: { idempotent: true, staged: { revision: expect.any(String) } } });
          expect(response).not.toHaveProperty("result.revision");
        }
      },
    });
    expect((await seedSiteProject(draftProject(), options, observed)).status).toBe("activated");
  });

  it.each(["plan", "apply"] as const)("rejects a concurrent head change before %s, without retrying or making further writes", async (boundary) => {
    const { options, store, service } = await fixture();
    const peer = createLocalSiteProjectApiService(options);
    let winnerFiles: unknown;
    const observed = observe(service, {
      async before(request) {
        if (request.operation !== boundary) return;
        const winner = await review(peer, { ...project(), name: "Competing head" });
        await call(peer, "apply", { plan: winner });
        winnerFiles = await fileSnapshot(store.root);
      },
    });
    await expect(seedSiteProject(project(), options, observed)).rejects.toThrow(new RegExp(`${boundary} failed \\(conflict\\)`));
    expect(observed.requests.filter(({ operation }) => operation === "list")).toHaveLength(1);
    expect(observed.requests.at(-1)?.operation).toBe(boundary);
    expect(await fileSnapshot(store.root)).toEqual(winnerFiles);
    expect(await store.list()).toMatchObject({ status: "ok", value: { active: null } });
  });

  it("rejects an activation race and leaves the competing active release intact", async () => {
    const { options, store, service } = await fixture();
    let winner: SiteProjectActiveSelection | undefined;
    let winnerFiles: unknown;
    const observed = observe(service, {
      async before(request) {
        if (request.operation !== "activate") return;
        winner = identity(await seedSiteProject({ ...project(), id: "competing-project" }, options));
        winnerFiles = await fileSnapshot(store.root);
      },
    });
    await expect(seedSiteProject(project(), options, observed)).rejects.toThrow(/activate failed \(conflict\)/);
    expect(observed.requests.at(-1)).toMatchObject({ operation: "activate", expectedActive: null });
    expect(observed.requests.filter(({ operation }) => operation === "activate")).toHaveLength(1);
    expect(await store.list()).toMatchObject({ status: "ok", value: { active: winner } });
    expect(await fileSnapshot(store.root)).toEqual(winnerFiles);
  });

  it.each(["head", "active"] as const)("fails the no-op check if the %s changes after planning", async (boundary) => {
    const { options, store, service } = await fixture();
    const first = await seedSiteProject(project(), options);
    let winnerFiles: unknown;
    const observed = observe(service, {
      async after(request, response) {
        if (request.operation !== "plan" || !response.ok) return;
        if (boundary === "head") {
          const pending = await review(service, { ...project(), name: "Newer head" }, { expectedRevision: first.revision, expectedActive: identity(first) });
          await call(service, "apply", { plan: pending });
        } else {
          await seedSiteProject({ ...project(), id: "new-active" }, options);
        }
        winnerFiles = await fileSnapshot(store.root);
      },
    });
    await expect(seedSiteProject(project(), options, observed)).rejects.toThrow(/verify unchanged release failed \(conflict\)/);
    expect(observed.requests.map(({ operation }) => operation)).toEqual(["list", "get", "plan", "list"]);
    expect(await fileSnapshot(store.root)).toEqual(winnerFiles);
  });

  it("reports a real build storage failure without activating its incomplete release", async () => {
    let failBuild = false;
    const { options, store, service } = await fixture({ fault(point) {
      if (failBuild && point === "build-files-durable") throw new Error("Interrupted build");
    } });
    const first = await seedSiteProject(project(), options);
    failBuild = true;
    const observed = observe(service);
    await expect(seedSiteProject({ ...project(), name: "Not activated" }, options, observed)).rejects.toThrow(/build failed \(unavailable\)/);
    expect(observed.requests.at(-1)?.operation).toBe("build");
    expect(await store.list()).toMatchObject({ status: "ok", value: { active: identity(first) } });
  });

  it("rejects invalid input before creating local release state", async () => {
    const { options, store } = await fixture();
    await expect(seedSiteProject({}, options)).rejects.toThrow(/read project failed \(validation\)/);
    await expect(lstat(store.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not stage a candidate whose release checks are blocking", async () => {
    const { options, store, service } = await fixture();
    const source = project({ entries: [entry("first", "First", "duplicate"), entry("second", "Second", "duplicate")] });
    // A mapping collection produces both entry routes under the same slug.
    source.providers.sitemaps[0]!.records[0]!.document.root[0]!.children = [{ id: "articles", title: "Articles", slug: "articles", source: { kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: "article-page" }, route: { kind: "entry-field", fieldId: "slug" } }, children: [] }];
    source.providers.mappings[0]!.records[0]!.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 100 } };
    const observed = observe(service);
    await expect(seedSiteProject(source, options, observed)).rejects.toThrow(/plan failed \(compile-blocked\)/);
    expect(observed.requests.map(({ operation }) => operation)).toEqual(["list", "plan"]);
    expect(await store.list()).toMatchObject({ status: "ok", value: { projects: [], active: null } });
  });
});
