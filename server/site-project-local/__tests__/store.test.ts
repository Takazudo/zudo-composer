import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { compileSiteProject } from "../../../src/site-project/compiler";
import { serializeSiteProject } from "../../../src/site-project/model/canonical";
import { releaseJson } from "../../../src/site-project/api/review";
import { fixture, stageFor, sha, catalog, review, call, PNG } from "./release-fixture";
import { createLocalSiteProjectStore, SITE_PROJECT_LOCAL_ROOT_ENV } from "../store";
const applyInput = (value = project()) => ({ project: value, stage: stageFor(value), expectedRevision: null, expectedActive: null, expectedGeneration: 0 });
async function build(value = project()) { const compiled = await compileSiteProject(value, { componentCatalog: catalog }); if (compiled.status !== "ready") throw new Error("Fixture compile failed"); return compiled.build; }
describe("immutable local release storage", () => {
  it("requires the original active precondition and current CAS for discard receipt retries", async () => {
    const { store } = await fixture(); const a = applyInput(), b = applyInput({ ...project(), name: "Discard me" });
    await store.apply(a); await store.apply({ ...b, expectedRevision: a.stage.revision, expectedGeneration: 1 });
    const request = { projectId: b.stage.projectId, buildId: b.stage.buildId, expectedStageGeneration: 2, expectedActive: null };
    expect(await store.discard(request)).toEqual({ status: "ok", value: { active: null } });
    expect(await store.discard(request)).toEqual({ status: "ok", value: { active: null } });
    const active = { projectId: a.stage.projectId, revision: a.stage.revision, buildId: a.stage.buildId };
    expect(await store.discard({ ...request, expectedActive: active })).toEqual({ status: "conflict" });
    await store.complete({ stage: a.stage, build: await build() });
    expect(await store.activate({ target: active, expectedActive: null })).toMatchObject({ status: "ok" });
    expect(await store.discard(request)).toEqual({ status: "conflict" });
    expect(await store.discard({ ...request, expectedActive: active })).toEqual({ status: "conflict" });
  });
  it("binds discard retries to the original stage incarnation across restage ABA", async () => {
    const { store } = await fixture(); const input = applyInput();
    const first = await store.apply(input); expect(first).toMatchObject({ status: "ok", value: { stageGeneration: 1 } });
    const original = { projectId: input.stage.projectId, buildId: input.stage.buildId, expectedStageGeneration: 1, expectedActive: null };
    expect(await store.discard(original)).toMatchObject({ status: "ok" }); expect(await store.discard(original)).toMatchObject({ status: "ok" });
    expect(await store.apply({ ...input, expectedGeneration: 2 })).toMatchObject({ status: "ok", value: { stageGeneration: 3 } });
    expect(await store.list()).toMatchObject({ status: "ok", value: { stageGenerations: { [input.stage.buildId]: 3 } } });
    expect(await store.getStage({ projectId: input.stage.projectId, buildId: input.stage.buildId, approvalDigest: input.stage.planDigest })).toMatchObject({ status: "ok", stageGeneration: 3 });
    expect(await store.discard(original)).toEqual({ status: "conflict" });
    expect(await store.getStage({ projectId: input.stage.projectId, buildId: input.stage.buildId })).toMatchObject({ status: "ok" });
    const current = { ...original, expectedStageGeneration: 3 };
    expect(await store.discard(current)).toMatchObject({ status: "ok" }); expect(await store.discard(original)).toEqual({ status: "conflict" }); expect(await store.discard(current)).toMatchObject({ status: "ok" });
  });
  it.each(["visible-discarded", "head", "order", "duplicate", "approval", "incarnation"])("rejects canonical contradictory heads %s before idempotent success", async (kind) => {
    const { store, testRoot } = await fixture(); const a = applyInput(), b = applyInput({ ...project(), name: "B" });
    await store.apply(a); await store.apply({ ...b, expectedRevision: a.stage.revision, expectedGeneration: 1 });
    const path = join(testRoot, "heads.json"), heads = JSON.parse(await readFile(path, "utf8"));
    if (kind === "visible-discarded") heads.discarded[a.stage.buildId] = { identity: { projectId: a.stage.projectId, revision: a.stage.revision, buildId: a.stage.buildId }, stageGeneration: 1, expectedActive: null };
    if (kind === "head") heads.projects[a.stage.projectId] = { revision: a.stage.revision, buildId: a.stage.buildId };
    if (kind === "order") heads.stageOrder.reverse();
    if (kind === "duplicate") heads.stageOrder.push(a.stage.buildId);
    if (kind === "approval") heads.approvals = {};
    if (kind === "incarnation") delete heads.stageGenerations[a.stage.buildId];
    const corrupt = releaseJson(heads); await writeFile(path, corrupt);
    expect(await store.apply(a)).toMatchObject({ status: "unavailable" });
    expect(await store.discard({ projectId: a.stage.projectId, buildId: a.stage.buildId, expectedStageGeneration: 1, expectedActive: null })).toMatchObject({ status: "unavailable" });
    expect(await readFile(path, "utf8")).toBe(corrupt);
  });
  it("restores the immediately preceding project head, not the greatest hash", async () => {
    const { store } = await fixture();
    const candidates = Array.from({ length: 8 }, (_, index) => applyInput({ ...project(), name: `Candidate ${index}` })).sort((a, b) => a.stage.buildId < b.stage.buildId ? -1 : 1);
    const a = candidates[7]!, b = candidates[0]!, c = candidates[4]!;
    await store.apply(a); await store.apply({ ...b, expectedRevision: a.stage.revision, expectedGeneration: 1 }); await store.apply({ ...c, expectedRevision: b.stage.revision, expectedGeneration: 2 });
    expect(await store.discard({ projectId: c.stage.projectId, buildId: c.stage.buildId, expectedStageGeneration: 3, expectedActive: null })).toMatchObject({ status: "ok" });
    expect(await store.list()).toMatchObject({ status: "ok", value: { projects: [expect.objectContaining({ head: b.stage.revision })] } });
  });
  it("resumes a durable pinned Media copy without consulting unavailable source bytes", async () => {
    const context = await fixture({ media: true }); const asset = await context.media!.upload({ fileName: "image.png", declaredMediaType: "image/png", bytes: PNG });
    const value = project(); value.providers.compositions[0]!.records[0]!.document.root[0]!.props.href = `/uploaded-media/asset-${asset.id}`;
    const plan = await review(context.service, value); await call(context.service, "apply", { plan });
    const staged = await context.store.getStage({ projectId: value.id, buildId: plan.buildId }); if (staged.status !== "ok") throw new Error("Stage missing");
    const compiled = await compileSiteProject(plan.candidate, { componentCatalog: catalog, mediaLock: plan.mediaLock! }); if (compiled.status !== "ready") throw new Error("Compile blocked");
    let once = true;
    const faulty = createLocalSiteProjectStore({ testRoot: context.testRoot, componentPack: catalog.pack, readMedia: async () => (async function* () { yield PNG; })(), fault(point) { if (once && point === "after-rename") { once = false; throw new Error("Copy acknowledged late"); } } });
    expect(await faulty.complete({ stage: staged.value, build: compiled.build })).toMatchObject({ status: "unavailable" });
    let reads = 0; const retry = createLocalSiteProjectStore({ testRoot: context.testRoot, componentPack: catalog.pack, readMedia: async () => { reads++; throw new Error("Source offline"); } });
    expect(await retry.complete({ stage: staged.value, build: compiled.build })).toMatchObject({ status: "ok" }); expect(reads).toBe(0);
    await writeFile(join(context.testRoot, "builds", plan.buildId, `media-${asset.document.versions[0]!.url.split("/").at(-1)}`), "corrupt");
    expect(await retry.getCompleted({ projectId: value.id, buildId: plan.buildId })).toMatchObject({ status: "unavailable" });
  });
  it.each(["apply", "build", "activate", "discard"].flatMap((operation) => ["unlink", "rmdir", "sync"].map((step) => ({ operation, step }))))("reports committed $operation cleanup $step as uncertain and retries idempotently", async ({ operation, step }) => {
    const { store, testRoot } = await fixture(); const input = applyInput(), output = await build();
    const identity = { projectId: input.stage.projectId, revision: input.stage.revision, buildId: input.stage.buildId };
    if (operation !== "apply") await store.apply(input);
    if (operation === "activate") await store.complete({ stage: input.stage, build: output });
    let once = true; const faulty = createLocalSiteProjectStore({ testRoot, componentPack: catalog.pack, fault(point) { if (once && point === `lock-cleanup-${step}`) { once = false; throw new Error("Cleanup failed"); } } });
    const run = (target: typeof store) => operation === "apply" ? target.apply(input) : operation === "build" ? target.complete({ stage: input.stage, build: output }) : operation === "activate" ? target.activate({ target: identity, expectedActive: null }) : target.discard({ projectId: identity.projectId, buildId: identity.buildId, expectedStageGeneration: 1, expectedActive: null });
    expect(await run(faulty)).toMatchObject({ status: "uncertain", identity, message: expect.stringContaining(identity.buildId) });
    expect(await run(store)).toMatchObject({ status: "ok" });
  });
  it("keeps precommit cleanup failure distinct from a committed mutation", async () => {
    const { testRoot } = await fixture(); let once = true;
    const faulty = createLocalSiteProjectStore({ testRoot, componentPack: catalog.pack, fault(point) { if (point === "after-write") throw new Error("Write failed before commit"); if (once && point === "lock-cleanup-unlink") { once = false; throw new Error("Cleanup also failed"); } } });
    expect(await faulty.apply(applyInput())).toMatchObject({ status: "unavailable" });
  });
  it("hides abandoned files and can restage equivalent inputs with a new idempotent approval receipt", async () => {
    const { store } = await fixture(); const first = applyInput();
    expect(await store.apply({ ...first, verifyApproval: async () => false })).toEqual({ status: "conflict" });
    expect(await store.get(first.stage)).toEqual({ status: "not-found" }); expect(await store.list()).toMatchObject({ status: "ok", value: { projects: [] } });
    const next = { ...first, stage: { ...first.stage, planDigest: "e".repeat(64) } };
    expect(await store.apply(next)).toMatchObject({ status: "ok" }); expect(await store.apply(next)).toMatchObject({ status: "ok" });
    expect(await store.getStage({ projectId: next.stage.projectId, buildId: next.stage.buildId, approvalDigest: next.stage.planDigest })).toMatchObject({ status: "ok" });
    expect(await store.getStage({ projectId: next.stage.projectId, buildId: next.stage.buildId, approvalDigest: first.stage.planDigest })).toEqual({ status: "not-found" });
    await store.discard({ projectId: next.stage.projectId, buildId: next.stage.buildId, expectedStageGeneration: 1, expectedActive: null });
    expect(await store.apply({ ...next, expectedGeneration: 2, stage: { ...next.stage, planDigest: "f".repeat(64) } })).toMatchObject({ status: "ok" });
  });
  it("lists immutable stages for multiple provider-neutral project identities", async () => {
    const { store } = await fixture(); await store.apply(applyInput());
    await store.apply({ ...applyInput({ ...project(), id: "another-site" }), expectedGeneration: 1 });
    expect(await store.list()).toMatchObject({ status: "ok", value: { projects: [expect.objectContaining({ projectId: "another-site" }), expect.objectContaining({ projectId: "compiler-site" })] } });
  });
  it("stages exact canonical revisions without changing the active release, and retains completed dependencies", async () => {
    const { store } = await fixture(); const first = applyInput();
    expect(first.stage.revision).toBe(sha(serializeSiteProject(first.project)));
    expect(await store.apply(first)).toMatchObject({ status: "ok", value: { active: null } });
    expect(await store.activate({ target: { projectId: first.stage.projectId, revision: first.stage.revision, buildId: first.stage.buildId }, expectedActive: null })).toEqual({ status: "not-found" });
    expect(await store.complete({ stage: first.stage, build: await build() })).toMatchObject({ status: "ok" });
    const active = { projectId: first.stage.projectId, revision: first.stage.revision, buildId: first.stage.buildId };
    expect(await store.activate({ target: active, expectedActive: null })).toMatchObject({ status: "ok" });
    const changed = applyInput({ ...project(), name: "New" });
    expect(await store.apply(changed)).toEqual({ status: "conflict" });
    expect(await store.apply({ ...changed, expectedRevision: active.revision, expectedActive: active, expectedGeneration: 1 })).toMatchObject({ status: "ok", value: { active } });
    expect(await store.get(active)).toMatchObject({ status: "ok", value: { project: { name: first.project.name } } });
    expect(await store.discard({ projectId: active.projectId, buildId: active.buildId, expectedStageGeneration: 1, expectedActive: active })).toEqual({ status: "conflict" });
    expect(await store.discard({ projectId: changed.stage.projectId, buildId: changed.stage.buildId, expectedStageGeneration: 2, expectedActive: active })).toMatchObject({ status: "ok" });
    expect(await store.discard({ projectId: changed.stage.projectId, buildId: changed.stage.buildId, expectedStageGeneration: 2, expectedActive: active })).toEqual({ status: "ok", value: { active } });
    expect(await store.discard({ projectId: changed.stage.projectId, buildId: changed.stage.buildId, expectedStageGeneration: 2, expectedActive: null })).toEqual({ status: "conflict" });
    expect(await store.readActiveProject()).toMatchObject({ status: "ok", value: { buildId: active.buildId } });
  });
  it.each([1, 2, 3, 4])("supports idempotent stages and concurrent distinct writers with generation/project CAS %#", async () => {
    const { store, testRoot } = await fixture(); const a = applyInput(), b = applyInput({ ...project(), name: "Other" });
    const other = createLocalSiteProjectStore({ testRoot, componentPack: catalog.pack });
    const results = await Promise.all([store.apply(a), other.apply(b)]);
    expect(results.map(({ status }) => status).sort(), JSON.stringify(results)).toEqual(["conflict", "ok"]);
    const winner = results[0]!.status === "ok" ? a : b;
    expect(await other.apply(winner)).toMatchObject({ status: "ok" });
  });
  it("enforces cross-process CAS", async () => {
    const { testRoot, store } = await fixture(); await store.list();
    await mkdir(join(testRoot, ".transaction-lock")); await writeFile(join(testRoot, ".transaction-lock", "owner.json"), JSON.stringify({ pid: 2147483647, nonce: "a".repeat(24) }));
    const run = (name: string) => new Promise<{ status: string }>((done, fail) => { const child = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "server/site-project-local/__tests__/store-worker.ts"), testRoot, name], { stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = ""; child.stdout.on("data", (value) => { stdout += String(value); }); child.stderr.on("data", (value) => { stderr += String(value); }); child.on("error", fail); child.on("close", (code) => code === 0 ? done(JSON.parse(stdout)) : fail(new Error(stderr))); });
    expect((await Promise.all([run("A"), run("B")])).map(({ status }) => status).sort()).toEqual(["conflict", "ok"]);
  });
  it.each(["after-write", "after-file-sync", "after-close", "before-rename", "after-rename", "after-directory-sync", "stage-files-durable"])("recovers staging interruption at %s without an active change", async (point) => {
    let failed = false; const { store, testRoot } = await fixture({ fault(current) { if (!failed && current === point) { failed = true; throw new Error("interrupted"); } } });
    expect(await store.apply(applyInput())).toMatchObject({ status: "unavailable" });
    const retry = createLocalSiteProjectStore({ testRoot, componentPack: catalog.pack });
    expect(await retry.apply(applyInput())).toMatchObject({ status: "ok", value: { active: null } });
  });
  it("keeps active through partial build failure and verifies all completion digests before activation", async () => {
    const { store, testRoot } = await fixture(); const first = applyInput(); await store.apply(first); const output = await build(); await store.complete({ stage: first.stage, build: output });
    const active = { projectId: first.stage.projectId, revision: first.stage.revision, buildId: first.stage.buildId }; await store.activate({ target: active, expectedActive: null });
    const second = applyInput({ ...project(), name: "Changed" }); await store.apply({ ...second, expectedRevision: active.revision, expectedActive: active, expectedGeneration: 1 });
    let failed = false; const faulty = createLocalSiteProjectStore({ testRoot, componentPack: catalog.pack, fault(point) { if (!failed && point === "build-files-durable") { failed = true; throw new Error("crash"); } } });
    expect(await faulty.complete({ stage: second.stage, build: await build(second.project) })).toMatchObject({ status: "unavailable" });
    expect(await store.activate({ target: { projectId: second.stage.projectId, revision: second.stage.revision, buildId: second.stage.buildId }, expectedActive: active })).toEqual({ status: "not-found" });
    expect(await store.readActiveProject()).toMatchObject({ status: "ok", value: { buildId: active.buildId } });
    expect(await store.complete({ stage: second.stage, build: await build(second.project) })).toMatchObject({ status: "ok" });
    await writeFile(join(testRoot, "builds", second.stage.buildId, "build.json"), "corrupt");
    expect(await store.activate({ target: { projectId: second.stage.projectId, revision: second.stage.revision, buildId: second.stage.buildId }, expectedActive: active })).toMatchObject({ status: "unavailable" });
    expect(await store.readActiveProject()).toMatchObject({ status: "ok", value: { buildId: active.buildId } });
  });
  it("reports post-rename activation uncertainty and recovers by exact idempotent retry", async () => {
    const { store, testRoot } = await fixture(); const input = applyInput(); await store.apply(input); await store.complete({ stage: input.stage, build: await build() });
    const target = { projectId: input.stage.projectId, revision: input.stage.revision, buildId: input.stage.buildId };
    const faulty = createLocalSiteProjectStore({ testRoot, componentPack: catalog.pack, fault(point) { if (point === "after-rename") throw new Error("Lost acknowledgement"); } });
    expect(await faulty.activate({ target, expectedActive: null })).toMatchObject({ status: "uncertain", message: expect.stringContaining("Inspect exact") });
    expect(await store.readActiveProject()).toMatchObject({ status: "ok", value: { buildId: target.buildId } });
    expect(await store.activate({ target, expectedActive: null })).toEqual({ status: "ok", value: { active: target } });
  });
  it("refuses symlinks, unknown schema files, and preserves their targets", async () => {
    const { testRoot, parent, store } = await fixture(); await store.list(); const outside = join(parent, "outside"); await mkdir(outside); await writeFile(join(outside, "keep"), "keep");
    await symlink(outside, join(parent, "linked")); expect(await createLocalSiteProjectStore({ testRoot: join(parent, "linked") }).list()).toMatchObject({ status: "unavailable" });
    await symlink(join(outside, "keep"), join(testRoot, "stages", `${"a".repeat(64)}.json`)); expect(await store.list()).toMatchObject({ status: "unavailable" });
    expect(await readFile(join(outside, "keep"), "utf8")).toBe("keep");
    await rm(join(testRoot, "stages", `${"a".repeat(64)}.json`)); await writeFile(join(testRoot, "active-build.json"), "old"); expect(await store.list()).toMatchObject({ status: "unavailable" });
  });
  it("does not steal a live writer lock and recovers a provably dead writer", async () => {
    const { store, testRoot } = await fixture(); await store.list(); const lock = join(testRoot, ".transaction-lock"); await mkdir(lock); await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, nonce: "a".repeat(24) }));
    expect(await createLocalSiteProjectStore({ testRoot, lockTimeoutMs: 15 }).list()).toMatchObject({ status: "unavailable" });
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: 2147483647, nonce: "a".repeat(24) })); expect(await store.list()).toMatchObject({ status: "ok" });
  });
  it("supports a symlinked ancestor but rejects root replacement during writes", async () => {
    const { parent } = await fixture(); const real = join(parent, "real"); await mkdir(real); await symlink(real, join(parent, "alias"));
    const testRoot = join(parent, "alias", "root"), store = createLocalSiteProjectStore({ testRoot, componentPack: catalog.pack }); expect(await store.apply(applyInput())).toMatchObject({ status: "ok" });
    const otherRoot = join(parent, "other"); await mkdir(otherRoot);
    let swapped = false; const faulty = createLocalSiteProjectStore({ testRoot, componentPack: catalog.pack, fault: async (point) => { if (!swapped && point === "after-close") { swapped = true; await rename(join(parent, "alias"), join(parent, "old-alias")); await symlink(otherRoot, join(parent, "alias")); } } });
    expect(await faulty.apply({ ...applyInput({ ...project(), name: "Changed" }), expectedRevision: applyInput().stage.revision, expectedGeneration: 1 })).toMatchObject({ status: "unavailable" });
  });
  it("uses the explicit disposable environment root", async () => {
    const { testRoot } = await fixture(); const prior = process.env[SITE_PROJECT_LOCAL_ROOT_ENV]; process.env[SITE_PROJECT_LOCAL_ROOT_ENV] = testRoot;
    try { expect(createLocalSiteProjectStore().root).toBe(testRoot); } finally { if (prior === undefined) delete process.env[SITE_PROJECT_LOCAL_ROOT_ENV]; else process.env[SITE_PROJECT_LOCAL_ROOT_ENV] = prior; }
  });
});
