import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { project, entry } from "../../compiler/__tests__/fixtures";
import { createSiteProjectApiService } from "../service";
import type { CompletedRelease, ReleasePlan, SiteProjectActiveSelection } from "../types";
import { fixture, call, review, PNG } from "../../../../server/site-project-local/__tests__/release-fixture";
const ref = (recordId: string) => ({ providerId: "content-filesystem", modelId: "articles", recordId });
const publish = (recordId: string) => ({ ref: ref(recordId), action: "publish" as const });
async function release(service: Parameters<typeof call>[0], plan: ReleasePlan, expectedActive: SiteProjectActiveSelection | null = null) {
  await call(service, "apply", { plan });
  const completed = await call<CompletedRelease>(service, "build", { projectId: plan.candidate.id, buildId: plan.buildId });
  await call(service, "activate", { ...completed.identity, expectedActive }); return completed.identity;
}
describe("protocol-2 staged release API", () => {
  it("rejects old/extra shapes and returns a real detached review before immutable staging", async () => {
    const { service, store } = await fixture();
    expect(await service.handle({ protocolVersion: 1, operation: "describe" })).toMatchObject({ ok: false, error: { code: "unsupported-protocol" } });
    expect(await service.handle({ protocolVersion: 2, operation: "list", extra: true })).toMatchObject({ ok: false, error: { code: "malformed-request" } });
    const value = project(), plan = await review(service, value);
    expect(plan.changes.length).toBeGreaterThan(0); expect(plan.affected.some(({ kind }) => kind === "route")).toBe(true); expect(plan.checks.every(({ severity }) => severity === "info")).toBe(true);
    value.name = "Later edit"; expect(plan.candidate.name).not.toBe(value.name);
    const tampered = structuredClone(plan); tampered.candidate.name = "Not approved";
    expect(await service.handle({ protocolVersion: 2, operation: "apply", plan: tampered })).toMatchObject({ ok: false, error: { code: "conflict" } });
    await call(service, "apply", { plan }); expect(await call(service, "active")).toEqual({ active: null });
    expect(await call(service, "stage", { projectId: plan.candidate.id, buildId: plan.buildId })).toMatchObject({ stage: { projectId: plan.candidate.id, buildId: plan.buildId, revision: plan.projectRevision }, stageGeneration: 1 });
    expect(await service.handle({ protocolVersion: 2, operation: "stage", projectId: plan.candidate.id, buildId: "f".repeat(64) })).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await service.handle({ protocolVersion: 2, operation: "stage", projectId: plan.candidate.id, buildId: plan.buildId, extra: true })).toMatchObject({ ok: false, error: { code: "malformed-request" } });
    expect(await service.handle({ protocolVersion: 2, operation: "activate", projectId: plan.candidate.id, revision: plan.projectRevision, buildId: plan.buildId, expectedActive: null })).toMatchObject({ ok: false, error: { code: "not-found" } });
    await call(service, "build", { projectId: plan.candidate.id, buildId: plan.buildId }); expect(await call(service, "active")).toEqual({ active: null });
    const active = await release(service, plan); expect(await store.readActiveProject()).toMatchObject({ status: "ok", value: { revision: active.revision, buildId: active.buildId } });
    expect(await service.handle({ protocolVersion: 2, operation: "discard", projectId: active.projectId, buildId: active.buildId, expectedStageGeneration: 1, expectedActive: active })).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await service.handle({ protocolVersion: 2, operation: "discard", projectId: active.projectId, buildId: active.buildId, expectedActive: active })).toMatchObject({ ok: false, error: { code: "malformed-request" } });
  });
  it("publishes only selected changes over the immutable activated Content baseline", async () => {
    const { service } = await fixture(); const initial = project({ entries: [entry("a", "Old A"), entry("b", "Old B")] });
    const first = await review(service, initial, { selection: [publish("a"), publish("b")] }); const active = await release(service, first);
    const noOp = await review(service, initial, { expectedRevision: first.projectRevision, expectedActive: active });
    expect(noOp.buildId).toBe(first.buildId); expect(noOp.publication).toEqual([]); await call(service, "apply", { plan: noOp }); await call(service, "apply", { plan: noOp });
    const working = structuredClone(initial); working.providers.content[0]!.entries[0]!.values.title = "New A"; working.providers.content[0]!.entries[1]!.values.title = "Pending B"; working.providers.content[0]!.entries.push({ ...entry("c"), lifecycle: "draft" });
    const next = await review(service, working, { expectedRevision: first.projectRevision, expectedActive: active, selection: [publish("a")] });
    expect(next.candidate.providers.content[0]!.entries.map(({ id, values }) => [id, values.title])).toEqual([["a", "New A"], ["b", "Old B"]]);
    await call(service, "apply", { plan: next }); expect((await call<{ active: SiteProjectActiveSelection }>(service, "active")).active).toEqual(active);
    const schemaChanged = structuredClone(working); schemaChanged.providers.content[0]!.models[0]!.document.fields[0] = { id: "title", key: "title", label: "Title", required: true, kind: "number" };
    schemaChanged.providers.content[0]!.entries.forEach((entry) => { entry.values.title = 42; });
    const incompatible = await review(service, schemaChanged, { selection: [], expectedRevision: next.projectRevision, expectedActive: active });
    expect(incompatible.checks.some(({ severity }) => severity === "blocking")).toBe(true);
    expect(await service.handle({ protocolVersion: 2, operation: "apply", plan: incompatible })).toMatchObject({ ok: false, error: { code: "compile-blocked" } });
  });
  it("invalidates review before stage, but later working edits do not alter pinned build/activation", async () => {
    const context = await fixture(); let current = true; const reconcile = vi.fn(async () => "changed" as const);
    const service = createSiteProjectApiService({ ...context.dependencies, isWorkingCurrent: async () => current, reconcilePublication: reconcile });
    const plan = await review(service, project({ entries: [{ ...entry("a"), lifecycle: "draft", generation: 7 }] }), { workingPrecondition: { generation: 7 }, selection: [publish("a")] });
    current = false; expect(await service.handle({ protocolVersion: 2, operation: "apply", plan })).toMatchObject({ ok: false, error: { code: "conflict" } });
    current = true; await call(service, "apply", { plan }); current = false;
    const active = await release(service, plan);
    expect(reconcile).toHaveBeenCalledWith(active, [expect.objectContaining({ expectedGeneration: 7, lifecycle: "published" })], 1);
  });
  it("pins exact bytes and gives the same project/new Media a different immutable build", async () => {
    const { service, media, testRoot } = await fixture({ media: true });
    const asset = await media!.upload({ fileName: "asset.png", declaredMediaType: "image/png", bytes: PNG });
    const value = project(); value.providers.compositions[0]!.records[0]!.document.root[0]!.props.href = `/uploaded-media/asset-${asset.id}`;
    const first = await review(service, value); await call(service, "apply", { plan: first });
    const nextAsset = await media!.replace(asset.id, { bytes: new Uint8Array([...PNG, 9]) }, { expectedRevision: asset.revision });
    const completed = await call<CompletedRelease>(service, "build", { projectId: value.id, buildId: first.buildId });
    const pinnedName = Object.keys(completed.files).find((name) => name.startsWith("media-"))!;
    expect(await readFile(join(testRoot, "builds", first.buildId, pinnedName))).toEqual(Buffer.from(PNG));
    const active = await release(service, first);
    const second = await review(service, value, { expectedRevision: first.projectRevision, expectedActive: active });
    expect(second.projectRevision).toBe(first.projectRevision); expect(second.buildId).not.toBe(first.buildId);
    await media!.trash(asset.id, { expectedRevision: nextAsset.revision });
    expect(await service.handle({ protocolVersion: 2, operation: "apply", plan: second })).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect((await call<CompletedRelease>(service, "completed", { projectId: value.id, buildId: first.buildId })).completionDigest).toBe(completed.completionDigest);
  });
  it("blocks incoming references when selected removal excludes their published dependency", async () => {
    const { service } = await fixture(); const value = project({ entries: [entry("a"), entry("b")] });
    value.providers.content[0]!.models[0]!.document.fields.push({ id: "related", key: "related", label: "Related", required: false, kind: "reference", target: { providerId: "content-filesystem", recordId: "articles" } });
    value.providers.content[0]!.entries[0]!.values.related = ref("b");
    const first = await review(service, value, { selection: [publish("a"), publish("b")] }); const active = await release(service, first);
    value.providers.content[0]!.entries[1]!.lifecycle = "draft";
    const next = await review(service, value, { selection: [{ ref: ref("b"), action: "unpublish" }], expectedRevision: first.projectRevision, expectedActive: active });
    expect(next.checks.some(({ severity }) => severity === "blocking")).toBe(true);
    expect(await service.handle({ protocolVersion: 2, operation: "apply", plan: next })).toMatchObject({ ok: false, error: { code: "compile-blocked" } });
  });
  it("binds staged toolchain identity and preserves the active release on unavailable toolchains", async () => {
    const context = await fixture(); const first = await review(context.service, project()); const active = await release(context.service, first);
    const next = await review(context.service, { ...project(), name: "Candidate" }, { expectedRevision: first.projectRevision, expectedActive: active }); await call(context.service, "apply", { plan: next });
    const different = createSiteProjectApiService({ ...context.dependencies, toolchain: { ...context.dependencies.toolchain, compiler: "different/3" } });
    expect(await different.handle({ protocolVersion: 2, operation: "build", projectId: next.candidate.id, buildId: next.buildId })).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect((await call<{ active: SiteProjectActiveSelection }>(different, "active")).active).toEqual(active);
    const replan = await review(different, next.workingProject, { expectedRevision: next.projectRevision, expectedActive: active }); expect(replan.projectRevision).toBe(next.projectRevision); expect(replan.buildId).not.toBe(next.buildId);
  });
  it("binds working-generation tokens even when a changed workspace returns to equal JSON", async () => {
    const context = await fixture(); let generation = 1;
    const service = createSiteProjectApiService({ ...context.dependencies, isWorkingCurrent: async (_project, precondition) => precondition === generation });
    const first = await review(service, project(), { workingPrecondition: 1 }); generation = 2;
    const second = await review(service, project(), { workingPrecondition: 2 });
    expect(first.projectRevision).toBe(second.projectRevision); expect(first.buildId).toBe(second.buildId); expect(first.planDigest).not.toBe(second.planDigest);
    expect(await service.handle({ protocolVersion: 2, operation: "apply", plan: first })).toMatchObject({ ok: false, error: { code: "conflict" } });
    await call(service, "apply", { plan: second });
    expect(await context.service.handle({ protocolVersion: 2, operation: "plan", project: project(), workingPrecondition: 1, selection: [], expectedRevision: second.projectRevision, expectedActive: null })).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });
  it("fails pinned-byte corruption without changing an already activated release", async () => {
    const context = await fixture({ media: true }); const asset = await context.media!.upload({ fileName: "asset.png", declaredMediaType: "image/png", bytes: PNG });
    const value = project(); value.providers.compositions[0]!.records[0]!.document.root[0]!.props.href = `/uploaded-media/asset-${asset.id}`;
    const first = await review(context.service, value); const active = await release(context.service, first);
    const replacement = await context.media!.replace(asset.id, { bytes: new Uint8Array([...PNG, 8]) }, { expectedRevision: asset.revision });
    const next = await review(context.service, value, { expectedRevision: first.projectRevision, expectedActive: active }); await call(context.service, "apply", { plan: next });
    await writeFile(join(context.mediaRoot, "versions", replacement.document.versions.at(-1)!.url.split("/").at(-1)!), "corrupt");
    expect(await context.service.handle({ protocolVersion: 2, operation: "build", projectId: value.id, buildId: next.buildId })).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect((await call<{ active: SiteProjectActiveSelection }>(context.service, "active")).active).toEqual(active);
  });
});
