import { describe, expect, it } from "vitest";
import type { SiteBuildPlan } from "../../compiler/types";
import { componentCatalog, entry, project as makeProject } from "../../compiler/__tests__/fixtures";
import { canonicalizeSiteProject } from "../../model/canonical";
import type { SiteProject } from "../../model/types";
import { createSiteProjectApiService } from "../service";
import type {
  SiteProjectActiveSelection,
  SiteProjectBuildAdapter,
  SiteProjectStoreAdapter,
  StoredSiteProject,
} from "../types";

const protocolVersion = 1 as const;

function sameActive(left: SiteProjectActiveSelection | null, right: SiteProjectActiveSelection | null): boolean {
  return left === null || right === null
    ? left === right
    : left.projectId === right.projectId && left.revision === right.revision;
}

class FakeProjectStore implements SiteProjectStoreAdapter {
  readonly records = new Map<string, Map<string, SiteProject>>();
  active: SiteProjectActiveSelection | null = null;
  nextRevision = 1;
  unavailable = false;

  seed(project: SiteProject, revision: string): void {
    const revisions = this.records.get(project.id) ?? new Map<string, SiteProject>();
    revisions.set(revision, structuredClone(project));
    this.records.set(project.id, revisions);
  }

  async list(): ReturnType<SiteProjectStoreAdapter["list"]> {
    if (this.unavailable) return { status: "unavailable", message: "private detail" };
    return {
      status: "ok",
      value: {
        projects: [...this.records].map(([projectId, revisions]) => ({
          projectId,
          name: [...revisions.values()][0]?.name ?? projectId,
          revisions: [...revisions.keys()],
        })),
        active: this.active,
      },
    };
  }

  async get(input: { projectId: string; revision: string }): ReturnType<SiteProjectStoreAdapter["get"]> {
    if (this.unavailable) return { status: "unavailable", message: "private detail" };
    const project = this.records.get(input.projectId)?.get(input.revision);
    return project
      ? { status: "ok", value: { project: structuredClone(project), revision: input.revision } }
      : { status: "not-found" };
  }

  async apply(input: Parameters<SiteProjectStoreAdapter["apply"]>[0]): ReturnType<SiteProjectStoreAdapter["apply"]> {
    if (this.unavailable) return { status: "unavailable", message: "private detail" };
    if (!sameActive(this.active, input.expectedActive)) return { status: "conflict" };
    const current = this.records.get(input.project.id) ?? new Map<string, SiteProject>();
    if (input.expectedRevision === null ? current.size !== 0 : !current.has(input.expectedRevision)) {
      return { status: "conflict" };
    }
    const revision = `rev-${this.nextRevision++}`;
    const next = new Map(current);
    if (input.expectedRevision !== null) next.delete(input.expectedRevision);
    next.set(revision, structuredClone(input.project));
    let active = this.active;
    if (active?.projectId === input.project.id && active.revision === input.expectedRevision) {
      active = { projectId: input.project.id, revision };
    }
    this.records.set(input.project.id, next);
    this.active = active;
    return { status: "ok", value: { revision, active } };
  }

  async activate(input: Parameters<SiteProjectStoreAdapter["activate"]>[0]): ReturnType<SiteProjectStoreAdapter["activate"]> {
    if (this.unavailable) return { status: "unavailable", message: "private detail" };
    if (!this.records.get(input.target.projectId)?.has(input.target.revision)) return { status: "not-found" };
    if (!sameActive(this.active, input.expectedActive)) return { status: "conflict" };
    this.active = { ...input.target };
    return { status: "ok", value: { active: this.active } };
  }

  async discard(input: Parameters<SiteProjectStoreAdapter["discard"]>[0]): ReturnType<SiteProjectStoreAdapter["discard"]> {
    if (this.unavailable) return { status: "unavailable", message: "private detail" };
    const revisions = this.records.get(input.projectId);
    if (!revisions?.has(input.expectedRevision)) return { status: "not-found" };
    if (!sameActive(this.active, input.expectedActive)) return { status: "conflict" };
    const next = new Map(revisions);
    next.delete(input.expectedRevision);
    if (next.size === 0) this.records.delete(input.projectId);
    else this.records.set(input.projectId, next);
    if (this.active?.projectId === input.projectId && this.active.revision === input.expectedRevision) this.active = null;
    return { status: "ok", value: { active: this.active } };
  }
}

class FakeBuildStore implements SiteProjectBuildAdapter {
  readonly published: Array<{ projectId: string; revision: string; build: SiteBuildPlan }> = [];
  unavailable = false;

  async publish(input: { projectId: string; revision: string; build: SiteBuildPlan }) {
    if (this.unavailable) return { status: "unavailable" as const, message: "private detail" };
    this.published.push(structuredClone(input));
    return { status: "ok" as const };
  }
}

function setup(initial?: StoredSiteProject) {
  const projectStore = new FakeProjectStore();
  if (initial) projectStore.seed(initial.project, initial.revision);
  const buildStore = new FakeBuildStore();
  return {
    projectStore,
    buildStore,
    service: createSiteProjectApiService({ componentCatalog, projectStore, buildStore }),
  };
}

describe("SiteProject API protocol", () => {
  it("describes the exact protocol, manifest contract, capabilities, and stable errors", async () => {
    const { service } = setup();
    const response = await service.handle({ protocolVersion, operation: "describe" });
    expect(response).toEqual({
      ok: true,
      result: {
        protocolVersion: 1,
        projectSchemaVersion: 1,
        requestShapes: [
          { operation: "activate", keys: ["protocolVersion", "operation", "projectId", "revision", "expectedActive"] },
          { operation: "apply", keys: ["protocolVersion", "operation", "project", "expectedRevision", "expectedActive"] },
          { operation: "build", keys: ["protocolVersion", "operation", "projectId", "revision"] },
          { operation: "describe", keys: ["protocolVersion", "operation"] },
          { operation: "discard", keys: ["protocolVersion", "operation", "projectId", "expectedRevision", "expectedActive"] },
          { operation: "get", keys: ["protocolVersion", "operation", "projectId", "revision"] },
          { operation: "list", keys: ["protocolVersion", "operation"] },
          { operation: "plan", keys: ["protocolVersion", "operation", "source"] },
        ],
        nestedShapes: {
          activeSelection: ["projectId", "revision"],
          planSource: [
            { kind: "inline", keys: ["kind", "project"] },
            { kind: "stored", keys: ["kind", "projectId", "revision"] },
          ],
        },
        errorCodes: ["malformed-request", "unsupported-protocol", "validation", "compile-blocked", "not-found", "conflict", "unavailable", "internal"],
        componentPack: componentCatalog.pack,
        capabilities: { atomicApply: true, atomicActivate: true, atomicDiscard: true, derivedBuilds: true },
      },
    });
  });

  it.each([
    [{ protocolVersion, operation: "describe", extra: true }, "malformed-request"],
    [{ protocolVersion: 2, operation: "describe" }, "unsupported-protocol"],
    [{ protocolVersion, operation: "unknown" }, "malformed-request"],
    [{ protocolVersion, operation: "plan", source: { kind: "inline", project: makeProject(), extra: true } }, "malformed-request"],
    [{ protocolVersion, operation: "activate", projectId: "../unsafe", revision: "r", expectedActive: null }, "malformed-request"],
  ])("rejects a non-exact request %#", async (request, code) => {
    await expect(setup().service.handle(request)).resolves.toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) }));
  });

  it("lists deterministically and gets one exact canonical revision", async () => {
    const original = makeProject();
    const second = { ...makeProject(), id: "another-site", name: "Another" };
    const { service, projectStore } = setup({ project: original, revision: "z-revision" });
    projectStore.seed(original, "a-revision");
    projectStore.seed(second, "only-revision");
    projectStore.active = { projectId: original.id, revision: "a-revision" };
    await expect(service.handle({ protocolVersion, operation: "list" })).resolves.toEqual({
      ok: true,
      result: {
        projects: [
          { projectId: "another-site", name: "Another", revisions: ["only-revision"] },
          { projectId: original.id, name: original.name, revisions: ["a-revision", "z-revision"] },
        ],
        active: { projectId: original.id, revision: "a-revision" },
      },
    });
    await expect(service.handle({ protocolVersion, operation: "get", projectId: original.id, revision: "z-revision" })).resolves.toEqual({
      ok: true,
      result: { projectId: original.id, revision: "z-revision", project: canonicalizeSiteProject(original) },
    });
    await expect(service.handle({ protocolVersion, operation: "get", projectId: original.id, revision: "missing" })).resolves.toEqual({
      ok: false,
      error: { code: "not-found", message: "The requested project revision was not found." },
    });
  });

  it("plans inline and stored projects without writing", async () => {
    const project = makeProject();
    const inline = setup();
    const inlineResult = await inline.service.handle({ protocolVersion, operation: "plan", source: { kind: "inline", project } });
    expect(inlineResult).toEqual(expect.objectContaining({ ok: true, result: expect.objectContaining({ source: { kind: "inline" }, diff: { writes: [] }, diagnostics: [] }) }));
    expect(inline.projectStore.records.size).toBe(0);
    expect(inline.buildStore.published).toHaveLength(0);

    const stored = setup({ project, revision: "stored-1" });
    await expect(stored.service.handle({ protocolVersion, operation: "plan", source: { kind: "stored", projectId: project.id, revision: "stored-1" } })).resolves.toEqual(
      expect.objectContaining({ ok: true, result: expect.objectContaining({ source: { kind: "stored", projectId: project.id, revision: "stored-1" } }) }),
    );
    expect(stored.buildStore.published).toHaveLength(0);
  });

  it("requires a complete compiler-ready graph for plan and apply", async () => {
    const invalid = makeProject() as SiteProject & { extra?: boolean };
    invalid.extra = true;
    await expect(setup().service.handle({ protocolVersion, operation: "plan", source: { kind: "inline", project: invalid } })).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "validation", diagnostics: expect.any(Array) }) }),
    );
    const blocked = makeProject();
    blocked.providers.sitemaps[0]!.records[0]!.document.root[0]!.source = { kind: "unassigned" };
    await expect(setup().service.handle({ protocolVersion, operation: "apply", project: blocked, expectedRevision: null, expectedActive: null })).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "compile-blocked", diagnostics: expect.any(Array) }) }),
    );
  });

  it("rejects Single Content cardinality during API apply before calling the store", async () => {
    const invalid = makeProject();
    invalid.providers.content[0]!.models[0]!.document.kind = "single";
    invalid.providers.content[0]!.entries.push(entry("first"), entry("second"));
    const current = setup();
    const result = await current.service.handle({ protocolVersion, operation: "apply", project: invalid, expectedRevision: null, expectedActive: null });
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "validation", diagnostics: expect.arrayContaining([expect.objectContaining({ code: "single-content-cardinality" })]) }),
    }));
    expect(current.projectStore.records.size).toBe(0);
  });

  it("enforces create-only and replacement CAS and atomically advances a matching active pointer", async () => {
    const project = makeProject();
    const { service, projectStore } = setup();
    const created = await service.handle({ protocolVersion, operation: "apply", project, expectedRevision: null, expectedActive: null });
    expect(created).toEqual(expect.objectContaining({ ok: true, result: expect.objectContaining({ revision: "rev-1", active: null }) }));
    await expect(service.handle({ protocolVersion, operation: "apply", project, expectedRevision: null, expectedActive: null })).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "conflict" }) }),
    );
    projectStore.active = { projectId: project.id, revision: "rev-1" };
    project.name = "Replacement";
    const replaced = await service.handle({
      protocolVersion,
      operation: "apply",
      project,
      expectedRevision: "rev-1",
      expectedActive: { projectId: project.id, revision: "rev-1" },
    });
    expect(replaced).toEqual(expect.objectContaining({
      ok: true,
      result: expect.objectContaining({ revision: "rev-2", active: { projectId: project.id, revision: "rev-2" } }),
    }));
    expect(projectStore.records.get(project.id)?.has("rev-1")).toBe(false);
  });

  it("rejects target and active-pointer conflicts without partial mutation", async () => {
    const project = makeProject();
    const { service, projectStore } = setup({ project, revision: "r1" });
    projectStore.active = { projectId: project.id, revision: "r1" };
    await expect(service.handle({ protocolVersion, operation: "activate", projectId: project.id, revision: "missing", expectedActive: projectStore.active })).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "not-found" }) }),
    );
    await expect(service.handle({ protocolVersion, operation: "discard", projectId: project.id, expectedRevision: "r1", expectedActive: null })).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "conflict" }) }),
    );
    expect(projectStore.records.get(project.id)?.has("r1")).toBe(true);
  });

  it("activates exact revisions and clears or preserves the pointer atomically on discard", async () => {
    const first = makeProject();
    const second = { ...makeProject(), id: "second-site", name: "Second" };
    const { service, projectStore } = setup({ project: first, revision: "first-1" });
    projectStore.seed(second, "second-1");
    await expect(service.handle({ protocolVersion, operation: "activate", projectId: first.id, revision: "first-1", expectedActive: null })).resolves.toEqual({
      ok: true,
      result: { active: { projectId: first.id, revision: "first-1" } },
    });
    await expect(service.handle({ protocolVersion, operation: "discard", projectId: first.id, expectedRevision: "first-1", expectedActive: { projectId: first.id, revision: "first-1" } })).resolves.toEqual({
      ok: true,
      result: { projectId: first.id, revision: "first-1", active: null },
    });
    projectStore.active = { projectId: second.id, revision: "second-1" };
    projectStore.seed(first, "first-2");
    await expect(service.handle({ protocolVersion, operation: "discard", projectId: first.id, expectedRevision: "first-2", expectedActive: { projectId: second.id, revision: "second-1" } })).resolves.toEqual({
      ok: true,
      result: { projectId: first.id, revision: "first-2", active: { projectId: second.id, revision: "second-1" } },
    });
  });

  it("builds an exact stored revision before publishing derived artifacts", async () => {
    const project = makeProject();
    const { service, buildStore } = setup({ project, revision: "build-1" });
    const response = await service.handle({ protocolVersion, operation: "build", projectId: project.id, revision: "build-1" });
    expect(response).toEqual(expect.objectContaining({ ok: true, result: expect.objectContaining({ projectId: project.id, revision: "build-1", build: expect.any(Object) }) }));
    expect(buildStore.published).toHaveLength(1);
    expect(buildStore.published[0]!.revision).toBe("build-1");
  });

  it("normalizes declared adapter unavailability and unexpected throws", async () => {
    const unavailable = setup();
    unavailable.projectStore.unavailable = true;
    await expect(unavailable.service.handle({ protocolVersion, operation: "list" })).resolves.toEqual({
      ok: false,
      error: { code: "unavailable", message: "Project storage is unavailable." },
    });
    const throwing = setup();
    throwing.projectStore.list = async () => { throw new Error("secret path and stack"); };
    await expect(throwing.service.handle({ protocolVersion, operation: "list" })).resolves.toEqual({
      ok: false,
      error: { code: "internal", message: "The SiteProject service failed unexpectedly." },
    });
    const hostileRequest = new Proxy({}, { ownKeys() { throw new Error("hostile request"); } });
    await expect(throwing.service.handle(hostileRequest)).resolves.toEqual({
      ok: false,
      error: { code: "internal", message: "The SiteProject service failed unexpectedly." },
    });
  });

  it("serializes equivalent set-order permutations to byte-identical success and failure responses", async () => {
    const original = makeProject();
    original.providers.compositions[0]!.records.push(structuredClone(original.providers.compositions[0]!.records[0]!));
    original.providers.compositions[0]!.records[1]!.id = "second";
    original.providers.compositions[0]!.records[1]!.document.id = "second";
    const permuted = structuredClone(original);
    permuted.providers.compositions[0]!.records.reverse();
    const service = setup().service;
    const request = (project: SiteProject) => ({ protocolVersion, operation: "plan" as const, source: { kind: "inline" as const, project } });
    await expect(service.serialize(request(original))).resolves.toBe(await service.serialize(request(permuted)));

    original.activeSitemap.recordId = "missing";
    permuted.activeSitemap.recordId = "missing";
    await expect(service.serialize(request(original))).resolves.toBe(await service.serialize(request(permuted)));
  });
});
