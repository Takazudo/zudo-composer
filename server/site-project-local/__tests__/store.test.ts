import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { project as makeProject } from "../../../src/site-project/compiler/__tests__/fixtures";
import { serializeSiteProject } from "../../../src/site-project/model/canonical";
import type { SiteBuildPlan } from "../../../src/site-project/compiler/types";
import { createLocalSiteProjectStore, SITE_PROJECT_LOCAL_ROOT_ENV } from "../store";

const roots: string[] = [];
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "zudo-site-project-"));
  roots.push(path);
  return join(path, ".zudo-site-project");
}
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("LocalSiteProjectStore", () => {
  it("uses the disposable environment root when no explicit test root is supplied", async () => {
    const configured = await root();
    const prior = process.env[SITE_PROJECT_LOCAL_ROOT_ENV];
    process.env[SITE_PROJECT_LOCAL_ROOT_ENV] = configured;
    try {
      await expect(createLocalSiteProjectStore().list()).resolves.toEqual({ status: "ok", value: { projects: [], active: null } });
    } finally {
      if (prior === undefined) delete process.env[SITE_PROJECT_LOCAL_ROOT_ENV];
      else process.env[SITE_PROJECT_LOCAL_ROOT_ENV] = prior;
    }
  });

  it("hashes exact canonical UTF-8 including the newline and enforces both CAS dimensions", async () => {
    const store = createLocalSiteProjectStore({ testRoot: await root() });
    const project = makeProject();
    const expected = createHash("sha256").update(serializeSiteProject(project), "utf8").digest("hex");
    await expect(store.apply({ project, expectedRevision: null, expectedActive: null })).resolves.toEqual({ status: "ok", value: { revision: expected, active: null } });
    await expect(store.apply({ project, expectedRevision: null, expectedActive: null })).resolves.toEqual({ status: "conflict" });
    await expect(store.activate({ target: { projectId: project.id, revision: expected }, expectedActive: null })).resolves.toEqual({ status: "ok", value: { active: { projectId: project.id, revision: expected } } });
    const changed = { ...makeProject(), name: "Changed" };
    const stale = store.apply({ project: changed, expectedRevision: expected, expectedActive: null });
    await expect(stale).resolves.toEqual({ status: "conflict" });
    const replacement = await store.apply({ project: changed, expectedRevision: expected, expectedActive: { projectId: project.id, revision: expected } });
    expect(replacement).toEqual({ status: "ok", value: { revision: expect.stringMatching(/^[a-f0-9]{64}$/), active: { projectId: project.id, revision: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
    if (replacement.status !== "ok") throw new Error("replacement failed");
    expect(replacement.value.active?.revision).toBe(replacement.value.revision);
  });

  it("serializes concurrent creators across independent store instances", async () => {
    const testRoot = await root();
    const attempts = await Promise.all([
      createLocalSiteProjectStore({ testRoot }).apply({ project: makeProject(), expectedRevision: null, expectedActive: null }),
      createLocalSiteProjectStore({ testRoot }).apply({ project: makeProject(), expectedRevision: null, expectedActive: null }),
    ]);
    expect(attempts.filter((result) => result.status === "ok")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "conflict")).toHaveLength(1);
  });

  it("enforces create-only CAS across separate Node processes", async () => {
    const testRoot = await root();
    const worker = join(process.cwd(), "server/site-project-local/__tests__/store-worker.ts");
    const run = () => new Promise<string>((resolveResult, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", worker, testRoot], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolveResult(stdout.trim()) : reject(new Error(stderr)));
    });
    const results = (await Promise.all([run(), run()])).map((value) => JSON.parse(value) as { status: string });
    expect(results.filter((result) => result.status === "ok")).toHaveLength(1);
    expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
  });

  it("recovers a durable project-plus-pointer journal after an injected interruption", async () => {
    const testRoot = await root();
    let crashed = false;
    const faulty = createLocalSiteProjectStore({ testRoot, fault(point) {
      if (!crashed && point === "project-installed") { crashed = true; throw new Error("crash"); }
    } });
    await expect(faulty.apply({ project: makeProject(), expectedRevision: null, expectedActive: null })).resolves.toEqual({ status: "unavailable", message: "crash" });
    const recovered = await createLocalSiteProjectStore({ testRoot }).list();
    expect(recovered).toEqual({ status: "ok", value: { projects: [{ projectId: "compiler-site", name: "Compiler site", revisions: [expect.stringMatching(/^[a-f0-9]{64}$/)] }], active: null } });
    await expect(readFile(join(testRoot, ".transaction.json"), "utf8")).rejects.toThrow();
  });

  it.each([
    ["after-file-sync", 0],
    ["after-rename", 1],
    ["after-directory-sync", 1],
  ])("has deterministic recovery at atomic-write fault point %s", async (point, recoveredCount) => {
    const testRoot = await root();
    let failed = false;
    const faulty = createLocalSiteProjectStore({ testRoot, fault(current) {
      if (!failed && current === point) { failed = true; throw new Error(point); }
    } });
    await expect(faulty.apply({ project: makeProject(), expectedRevision: null, expectedActive: null })).resolves.toEqual({ status: "unavailable", message: point });
    const recovered = await createLocalSiteProjectStore({ testRoot }).list();
    expect(recovered.status).toBe("ok");
    if (recovered.status === "ok") expect(recovered.value.projects).toHaveLength(recoveredCount);
  });

  it("preserves another active selection on discard and clears the discarded active project", async () => {
    const store = createLocalSiteProjectStore({ testRoot: await root() });
    const first = await store.apply({ project: makeProject(), expectedRevision: null, expectedActive: null });
    const otherProject = { ...makeProject(), id: "other-site", name: "Other" };
    const second = await store.apply({ project: otherProject, expectedRevision: null, expectedActive: null });
    if (first.status !== "ok" || second.status !== "ok") throw new Error("apply failed");
    const otherActive = { projectId: otherProject.id, revision: second.value.revision };
    await store.activate({ target: otherActive, expectedActive: null });
    await expect(store.discard({ projectId: "compiler-site", expectedRevision: first.value.revision, expectedActive: otherActive })).resolves.toEqual({ status: "ok", value: { active: otherActive } });
    await expect(store.discard({ projectId: otherProject.id, expectedRevision: second.value.revision, expectedActive: otherActive })).resolves.toEqual({ status: "ok", value: { active: null } });
  });

  it.each(["after-delete-rename", "after-delete-directory-sync"])("recovers discard at %s", async (point) => {
    const testRoot = await root();
    const initial = createLocalSiteProjectStore({ testRoot });
    const applied = await initial.apply({ project: makeProject(), expectedRevision: null, expectedActive: null });
    if (applied.status !== "ok") throw new Error("apply failed");
    await initial.activate({ target: { projectId: "compiler-site", revision: applied.value.revision }, expectedActive: null });
    let failed = false;
    const faulty = createLocalSiteProjectStore({ testRoot, fault(current) {
      if (!failed && current === point) { failed = true; throw new Error(point); }
    } });
    await expect(faulty.discard({ projectId: "compiler-site", expectedRevision: applied.value.revision, expectedActive: { projectId: "compiler-site", revision: applied.value.revision } })).resolves.toEqual({ status: "unavailable", message: point });
    await expect(createLocalSiteProjectStore({ testRoot }).list()).resolves.toEqual({ status: "ok", value: { projects: [], active: null } });
  });

  it("refuses symlink roots, symlink/special targets, and unknown filenames", async () => {
    const parent = await mkdtemp(join(tmpdir(), "zudo-site-project-links-")); roots.push(parent);
    const actual = join(parent, "actual"); await mkdir(actual);
    const linked = join(parent, "linked"); await symlink(actual, linked, "dir");
    await expect(createLocalSiteProjectStore({ testRoot: linked }).list()).resolves.toEqual(expect.objectContaining({ status: "unavailable" }));

    const testRoot = await root();
    const store = createLocalSiteProjectStore({ testRoot });
    await expect(store.list()).resolves.toEqual({ status: "ok", value: { projects: [], active: null } });
    await writeFile(join(testRoot, "unknown.txt"), "preserve", "utf8");
    await expect(store.list()).resolves.toEqual(expect.objectContaining({ status: "unavailable" }));
    await expect(readFile(join(testRoot, "unknown.txt"), "utf8")).resolves.toBe("preserve");
  });

  it("refuses lock and recognizable-orphan symlinks without following or deleting them", async () => {
    const testRoot = await root();
    const store = createLocalSiteProjectStore({ testRoot });
    await store.list();
    const outside = join(dirname(testRoot), "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep"), "keep", "utf8");
    await symlink(outside, join(testRoot, ".transaction-lock"), "dir");
    await expect(store.list()).resolves.toEqual(expect.objectContaining({ status: "unavailable" }));
    await expect(readFile(join(outside, "keep"), "utf8")).resolves.toBe("keep");
    await rm(join(testRoot, ".transaction-lock"));
    await symlink(join(outside, "keep"), join(testRoot, "projects", ".site-project-tmp-999-aaaaaaaaaaaaaaaaaaaaaaaa"));
    await expect(store.list()).resolves.toEqual(expect.objectContaining({ status: "unavailable" }));
    await expect(readFile(join(outside, "keep"), "utf8")).resolves.toBe("keep");
  });

  it("preserves and refuses a canonical but incoherent recovery journal", async () => {
    const testRoot = await root();
    const store = createLocalSiteProjectStore({ testRoot });
    await store.list();
    const projectText = serializeSiteProject(makeProject());
    const journal = `${JSON.stringify({ active: { projectId: "compiler-site", revision: "0".repeat(64) }, projectId: "compiler-site", projectText, version: 1 })}\n`;
    await writeFile(join(testRoot, ".transaction.json"), journal, "utf8");
    await expect(store.list()).resolves.toEqual(expect.objectContaining({ status: "unavailable" }));
    await expect(readFile(join(testRoot, ".transaction.json"), "utf8")).resolves.toBe(journal);
  });

  it("publishes immutable complete builds idempotently and never advances after a failed build", async () => {
    const testRoot = await root();
    const store = createLocalSiteProjectStore({ testRoot });
    const applied = await store.apply({ project: makeProject(), expectedRevision: null, expectedActive: null });
    if (applied.status !== "ok") throw new Error("apply failed");
    const build: SiteBuildPlan = { projectId: "compiler-site", activeSitemap: { providerId: "sitemap-indexeddb", recordId: "main" }, routes: [], modules: [] };
    await expect(store.publish({ projectId: "compiler-site", revision: applied.value.revision, build })).resolves.toEqual({ status: "ok" });
    await expect(store.publish({ projectId: "compiler-site", revision: applied.value.revision, build })).resolves.toEqual({ status: "ok" });
    const pointer = await readFile(join(testRoot, "active-build.json"), "utf8");
    const different: SiteBuildPlan = { ...build, routes: [{ pathname: "/", sitemapNode: { id: "x", path: "/" }, source: { kind: "composition" as const, ref: { providerId: "p", recordId: "r" } }, composition: { local: { providerId: "p", recordId: "r" }, routeRecordId: "r", document: { schemaVersion: 2 as const, id: "r", name: "r", root: [] } }, modules: [] }] };
    await expect(store.publish({ projectId: "compiler-site", revision: applied.value.revision, build: different })).resolves.toEqual(expect.objectContaining({ status: "unavailable" }));
    await expect(readFile(join(testRoot, "active-build.json"), "utf8")).resolves.toBe(pointer);

    const replacement = await store.apply({ project: { ...makeProject(), name: "Next revision" }, expectedRevision: applied.value.revision, expectedActive: null });
    if (replacement.status !== "ok") throw new Error("replacement failed");
    let failed = false;
    const faulty = createLocalSiteProjectStore({ testRoot, fault(point) {
      if (!failed && point === "build-files-durable") { failed = true; throw new Error("build crash"); }
    } });
    await expect(faulty.publish({ projectId: "compiler-site", revision: replacement.value.revision, build })).resolves.toEqual({ status: "unavailable", message: "build crash" });
    await expect(readFile(join(testRoot, "active-build.json"), "utf8")).resolves.toBe(pointer);
    await expect(store.publish({ projectId: "compiler-site", revision: replacement.value.revision, build })).resolves.toEqual({ status: "ok" });
    const recoveredPointer = await readFile(join(testRoot, "active-build.json"), "utf8");
    expect(recoveredPointer).not.toBe(pointer);

    const third = await store.apply({ project: { ...makeProject(), name: "Third revision" }, expectedRevision: replacement.value.revision, expectedActive: null });
    if (third.status !== "ok") throw new Error("third apply failed");
    let failedAgain = false;
    const faultyAgain = createLocalSiteProjectStore({ testRoot, fault(point) {
      if (!failedAgain && point === "build-files-durable") { failedAgain = true; throw new Error("second build crash"); }
    } });
    await expect(faultyAgain.publish({ projectId: "compiler-site", revision: third.value.revision, build })).resolves.toEqual({ status: "unavailable", message: "second build crash" });
    await writeFile(join(testRoot, "builds", "compiler-site", third.value.revision, "build.json"), "conflicting", "utf8");
    await expect(store.publish({ projectId: "compiler-site", revision: third.value.revision, build })).resolves.toEqual(expect.objectContaining({ status: "unavailable", message: expect.stringContaining("conflicts") }));
    await expect(readFile(join(testRoot, "active-build.json"), "utf8")).resolves.toBe(recoveredPointer);
  });
});
