import { mkdtemp, rm, lstat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { defineComponentPack } from "@zudo-composer/component-contract";
import { composer } from "../../config/config";
import { initializeAuthoringWorkspace } from "../../edit/initialize-workspace";
import { defineSite, node } from "../../../src/site-project/authoring";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import { createNativeContentEditorial } from "../../../src/content/editorial/native";
import { createFilesystemContentStore } from "../../../src/content/storage/filesystem/store";
import { captureHost } from "../../edit/inspect";
import { createDraftOperations } from "../../edit/draft-service";
import { editDigest } from "../../edit/service";
import { executeAuthoringOperation } from "../../edit/authoring-lease.mjs";
import { withMutationBarrier } from "../../../src/shared/node-fs";
import { workspaceDomainRoots } from "../../../src/shared/workspace-scope";
import { captureAuthoringWorkspace, compileAuthoringWorkspaceSnapshot } from "../../authoring-workspace/capture";
import { createNativeContentAiService, createNativeContentAiStager } from "../../../src/content/storage/file-provider/dev-server-entry";
import { createHostReviewService, type HostReviewDependencies } from "../review-service";
import { resolveHostOwnership } from "../ownership";
import { hostDocumentTargets } from "../render";
import type { RunFence, HostReviewPreview } from "../../../src/features/assistant/host-review-types";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const fence = (): RunFence => ({ conversationId: "conversation", runId: "run", turnId: "turn", toolCallId: "tool", signal: new AbortController().signal, assertActive: async () => {} });
const ack = (value: HostReviewPreview) => ({ reviewId: value.reviewId, candidateDigest: value.candidateDigest, baseDigest: value.baseDigest, identity: value.preview.identity, frameId: value.preview.frameId });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "host-review-")); roots.push(root);
  const pack = defineComponentPack({ packId: "proof", packVersion: "1", components: [
    { component: () => null, id: "group", schemaVersion: 1, title: "Group", description: "Group", category: "Test", source: { module: "proof/pack", exportName: "Group", exportKind: "named" }, defaults: {}, fields: [], slots: [{ id: "children", prop: "children", label: "Children", cardinality: "many", accepts: ["text"] }] },
    { component: () => null, id: "text", schemaVersion: 1, title: "Text", description: "Text", category: "Test", source: { module: "proof/pack", exportName: "Text", exportKind: "named" }, defaults: { text: "" }, fields: [{ kind: "text", prop: "text", label: "Text" }] },
  ] });
  const config = composer({ workspaceRoot: root, pack: "proof/pack", authoringAuthority: "workspace", nativeEditing: { source: "workspace" }, assistant: { provider: "fake", name: "Proof", permission: "apply", contentFields: [{ providerId: "content-filesystem", modelId: "course", fieldIds: ["course-price"] }] } }, { env: {} });
  await createFilesystemAssetStore({ assetsStoreRoot: config.paths.assets });
  const site = defineSite({ id: "proof", name: "Proof", componentPack: pack });
  const model = site.model({ id: "course", name: "Course", kind: "collection", fields: [{ key: "price", label: "Price", kind: "text" }] });
  site.entry(model, { id: "consultation", values: { price: "100" } });
  const presentation = site.page({ id: "price", name: "Price", root: [node("text", { text: "" }, {}, "price")] });
  const mapping = site.mapping({ id: "price", name: "Price", model, composition: presentation, mode: { kind: "collection" }, bindings: [{ field: "price", nodeId: "price", prop: "text" }] });
  const pages = ["home", "lessons"].map(id => { const page = site.page({ id, name: id, root: [node("text", { text: "local" }, {}, "local"), node("group", {}, { children: [] }, "group")] }); site.attach(mapping, { composition: page, nodeId: "group", slotId: "children" }, `${id}-price`); return page; });
  site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page: pages[0]!, children: [{ id: "lessons", title: "Lessons", slug: "lessons", page: pages[1]! }] } });
  await initializeAuthoringWorkspace({ composerConfig: config, pack, project: site.toSiteProject(), workspaceId: "proof" });
  const packIdentity = { specifier: "proof/pack", source: "self", digest: "a".repeat(64), compiler: "compiler", contractDigest: "b".repeat(64) };
  const options = { composerConfig: config, pack, packIdentity, renderer: { id: "proof", version: "1", module: "proof/renderer", digest: "c".repeat(64) } };
  const capture = () => captureHost({ config, pack, packIdentity: packIdentity as never });
  const barriers = async <T>(state: Awaited<ReturnType<typeof capture>>, action: () => Promise<T>) => {
    const paths = workspaceDomainRoots(config.paths, state.workspaceId), all = [join(config.paths.data, "workspaces"), paths.content, paths.mappings, paths.sitemaps, config.paths.assets];
    const run = (index: number): Promise<T> => index === all.length ? action() : withMutationBarrier(all[index]!, () => run(index + 1)); return run(0);
  };
  const drafts = createDraftOperations({ host: async () => root, dataRoot: config.paths.data, digest: editDigest, capture, revisions: async state => ({ tokens: state.tokens }), leased: action => executeAuthoringOperation(root, action), barriers, pinAsset: async () => { throw new Error("unused"); }, permission: "apply" });
  const proposer = { label: "Never called", propose: vi.fn(async () => { throw new Error("No second model inference"); }) };
  const deps: HostReviewDependencies = { config, options: async () => options, drafts, renderer: { renderDocument: ({ route }) => `<html><head></head><body>${JSON.stringify(route.composition.document)}</body></html>` }, documentCache: { put: () => "/candidate" }, assertSourcesCurrent: async () => {}, resolveOwnership: resolveHostOwnership,
    content: async () => { const content = await createFilesystemContentStore({ contentRoot: workspaceDomainRoots(config.paths, "proof").content }); const configured = { provider: { ...proposer, proposer, inference: async () => ({ available: false as const, reason: "offline" }) }, canApply: config.assistant!.permission === "apply", proposalRoot: join(config.paths.data, "content-ai"), contentFields: config.assistant!.contentFields };
      return { service: await createNativeContentAiService(content, async () => null, configured as never), ...await createNativeContentAiStager(content, async () => null, configured as never) }; },
  };
  const service = createHostReviewService(deps);
  const selection = async (nodeId: string, prop = "text") => { const snapshot = await captureAuthoringWorkspace(options), compiled = await compileAuthoringWorkspaceSnapshot({ ...options, snapshot }); const target = hostDocumentTargets(compiled.build.routes[0]!).find(target => target.nodeId === nodeId)!; return { revision: snapshot.digest, pathname: "/", target: { renderedNodeId: target.renderedNodeId, providerId: target.providerId, recordId: target.recordId, nodeId: target.nodeId }, prop }; };
  const stage = async () => { const inspected = await service.inspect({ workspaceId: "proof", selection: await selection("price") }, fence()); const request = { workspaceId: "proof", capabilityId: inspected.capabilityId, values: { "course-price": "125" }, summary: "Shared price" }; return { card: await service.stageContent(request, fence()), request }; };
  return { root, options, config, capture, drafts, deps, service, selection, stage, proposer };
}
it("stages shared Content without inference/write, renders affected routes and applies one exact acknowledged candidate with receipt recovery/Undo", async () => {
  const f = await fixture(), before = await captureAuthoringWorkspace(f.options);
  const { card, request } = await f.stage();
  expect(card.affectedUses.map(use => use.pathname).sort()).toEqual(["/", "/lessons"]);
  expect((await captureAuthoringWorkspace(f.options)).digest).toBe(before.digest);
  expect(f.proposer.propose).not.toHaveBeenCalled();
  expect(await f.service.stageContent(request, fence())).toEqual(card);
  const preview = await f.service.preview({ workspaceId: "proof", reviewId: card.id, pathname: "/" });
  const rendered = ack(preview);
  await expect(f.service.apply({ workspaceId: "proof", reviewId: card.id, rendered: { ...rendered, identity: { ...rendered.identity, rendererDigest: "d".repeat(64) } } })).rejects.toMatchObject({ code: "approval-mismatch" });
  const applied = await f.service.apply({ workspaceId: "proof", reviewId: card.id, rendered });
  expect(applied.domain).toBe("content");
  expect((await (await f.capture()).stores.content.readAll()).entries.find(entry => entry.id === "consultation")!.values["course-price"]).toBe("125");
  f.deps.options = async () => { throw new Error("Renderer unavailable"); };
  f.deps.assertSourcesCurrent = async () => { throw new Error("Source changed"); };
  expect(await f.service.apply({ workspaceId: "proof", reviewId: card.id, rendered })).toEqual({ ...applied, recovered: true });
  expect(await createHostReviewService(f.deps).stageContent(request, fence())).toEqual(card);
  expect((await f.service.undo({ workspaceId: "proof", reviewId: card.id })).domain).toBe("content");
  expect((await (await f.capture()).stores.content.readAll()).entries.find(entry => entry.id === "consultation")!.values["course-price"]).toBe("100");
});
it("stale whole-workspace Content review refuses without writes and releases the Composition read lock", async () => {
  const f = await fixture(), { card } = await f.stage(), preview = await f.service.preview({ workspaceId: "proof", reviewId: card.id, pathname: "/" });
  const state = await f.capture();
  const page = structuredClone(state.records.compositions.find(record => record.id === "home")!); page.document.root[0]!.props.text = "later human edit";
  await state.stores.compositions.put(page, "later");
  const before = await captureAuthoringWorkspace(f.options);
  await expect(f.service.apply({ workspaceId: "proof", reviewId: card.id, rendered: ack(preview) })).rejects.toMatchObject({ code: "stale-plan" });
  expect((await captureAuthoringWorkspace(f.options)).digest).toBe(before.digest);
  await expect(lstat(join(workspaceDomainRoots(f.config.paths, "proof").compositions, ".mutation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("reviews existing Composition draft candidate and runs exact guard inside its writer; committed recovery needs no runtime", async () => {
  const f = await fixture();
  const draft = (await f.drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: { actor: "assistant", conversationId: "conversation", runId: "run" }, operations: [{ kind: "updateField", page: { sitemapId: "main", pageId: "home" }, nodeId: "local", prop: "text", value: "AI local" }] })).draft!;
  const card = await f.service.reviewComposition({ workspaceId: "proof", draftId: draft.id, revision: draft.revision, candidateDigest: draft.candidateDigest! });
  const preview = await f.service.preview({ workspaceId: "proof", reviewId: card.id, pathname: "/" });
  expect((await f.capture()).records.compositions.find(record => record.id === "home")!.document.root[0]!.props.text).toBe("local");
  const result = await f.service.apply({ workspaceId: "proof", reviewId: card.id, rendered: ack(preview) });
  expect((await f.capture()).records.compositions.find(record => record.id === "home")!.document.root[0]!.props.text).toBe("AI local");
  f.deps.options = async () => { throw new Error("New pack unavailable"); };
  expect(await f.service.apply({ workspaceId: "proof", reviewId: card.id, rendered: ack(preview) })).toEqual({ ...result, recovered: true });
  expect((await f.service.undo({ workspaceId: "proof", reviewId: card.id })).domain).toBe("composition");
});
it("recovers an orphaned immutable proposal after restart and source change without preparing another operation", async () => {
  const f = await fixture();
  const inspected = await f.service.inspect({ workspaceId: "proof", selection: await f.selection("price") }, fence());
  const request = { workspaceId: "proof", capabilityId: inspected.capabilityId, values: { "course-price": "125" }, summary: "Shared price" };
  const original = f.deps.content;
  let proposalId = "";
  f.deps.content = async workspaceId => {
    const content = await original(workspaceId);
    return { ...content, stage: async (request, guard) => {
      const result = await content.stage(request, guard);
      if (result.status === "proposed") proposalId = result.proposal.id;
      throw new Error("Lost response after proposal persistence");
    } };
  };
  await expect(f.service.stageContent(request, fence())).rejects.toThrow("Lost response");
  const state = await f.capture(), page = structuredClone(state.records.compositions.find(record => record.id === "home")!);
  page.document.root[0]!.props.text = "later";
  await state.stores.compositions.put(page, "human");
  f.deps.content = original;
  const restarted = createHostReviewService(f.deps);
  const card = await restarted.stageContent(request, fence());
  expect(card.operation).toMatchObject({ domain: "content", proposalId });
  expect((await restarted.read({ workspaceId: "proof", reviewId: card.id })).status).toBe("stale");
  const preview = await restarted.preview({ workspaceId: "proof", reviewId: card.id, pathname: "/" });
  await expect(restarted.apply({ workspaceId: "proof", reviewId: card.id, rendered: ack(preview) })).rejects.toMatchObject({ code: "stale-plan" });
  expect((await (await f.capture()).stores.content.readAll()).entries.find(entry => entry.id === "consultation")!.values["course-price"]).toBe("100");
  expect(f.proposer.propose).not.toHaveBeenCalled();
});
it("trusted Composition commit guard fails before writes and is not rerun for a committed receipt", async () => {
  const f = await fixture();
  const draft = (await f.drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: { actor: "assistant", conversationId: "conversation", runId: "run" }, operations: [{ kind: "updateField", page: { sitemapId: "main", pageId: "home" }, nodeId: "local", prop: "text", value: "guarded" }] })).draft!;
  const request = { workspaceId: "proof", draftId: draft.id, revision: draft.revision, approve: draft.candidateDigest! };
  const before = await captureAuthoringWorkspace(f.options);
  const reject = vi.fn(async () => { throw new Error("Trusted guard refused"); });
  await expect(f.drafts.apply(request, reject)).rejects.toThrow("Trusted guard refused");
  expect(reject).toHaveBeenCalledOnce();
  expect((await captureAuthoringWorkspace(f.options)).digest).toBe(before.digest);
  const accepted = await f.drafts.apply(request, async guard => {
    expect(guard.compositions.mutationToken).toBe(before.tokens.compositions);
    expect(guard.candidateDigest).toBe(draft.candidateDigest);
  });
  expect(await f.drafts.apply(request, reject)).toEqual(accepted);
  expect(reject).toHaveBeenCalledOnce();
});
it("ordinary Content write after dependency guard wins; owning-domain CAS refuses AI mutation without retaining Composition lock", async () => {
  const f = await fixture(), { card } = await f.stage();
  const preview = await f.service.preview({ workspaceId: "proof", reviewId: card.id, pathname: "/" });
  const original = f.deps.content;
  f.deps.content = async workspaceId => {
    const content = await original(workspaceId);
    return { ...content, service: { ...content.service, apply: async request => {
      const store = await createFilesystemContentStore({ contentRoot: workspaceDomainRoots(f.config.paths, "proof").content });
      const snapshot = await store.readAll();
      const human = createNativeContentEditorial({ store, readPublished: async () => null, provenance: { actor: { id: "human" }, source: "test" } });
      await human.saveFields({ entry: { providerId: "content-filesystem", modelId: "course", recordId: "consultation" }, expected: String(snapshot.mutationToken), values: { "course-price": "150" }, clear: [], operationKey: "human-race" });
      return content.service.apply(request);
    } } };
  };
  await expect(f.service.apply({ workspaceId: "proof", reviewId: card.id, rendered: ack(preview) })).rejects.toMatchObject({ code: "revision-conflict" });
  expect((await (await f.capture()).stores.content.readAll()).entries.find(entry => entry.id === "consultation")!.values["course-price"]).toBe("150");
  expect((await f.service.read({ workspaceId: "proof", reviewId: card.id })).status).toBe("stale");
  await expect(lstat(join(workspaceDomainRoots(f.config.paths, "proof").compositions, ".mutation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
});
// The child is an independent kernel-lock competitor, not a second full server.
// Both parent branches exercise the actual owning-domain reviewed Apply path.
for (const domain of ["content", "composition"] as const) it(`independent process registry contention settles in both directions for ${domain} Apply`, async () => {
  const f = await fixture();
  let card;
  if (domain === "content") card = (await f.stage()).card;
  else {
    const draft = (await f.drafts.propose({ workspaceId: "proof", expected: { generation: 0, draftId: null }, provenance: { actor: "assistant", conversationId: "conversation", runId: "run" }, operations: [{ kind: "updateField", page: { sitemapId: "main", pageId: "home" }, nodeId: "local", prop: "text", value: "child contention" }] })).draft!;
    card = await f.service.reviewComposition({ workspaceId: "proof", draftId: draft.id, revision: draft.revision, candidateDigest: draft.candidateDigest! });
  }
  const preview = await f.service.preview({ workspaceId: "proof", reviewId: card.id, pathname: "/" });
  const request = { workspaceId: "proof", reviewId: card.id, rendered: ack(preview) };
  const registry = join(f.config.paths.data, "workspaces");
  const source = `import { withMutationBarrier } from ${JSON.stringify(resolve("src/shared/node-fs/mutation-barrier.ts"))};
    process.on('message', async mode => {
      if(mode==='release') return;
      try { await withMutationBarrier(${JSON.stringify(registry)}, async () => {
        process.send('held'); if(mode==='hold') await new Promise(resolve=>process.once('message',resolve));
      }); process.send('released'); } catch(error) { process.send({refused:error.code}); }
    }); process.send('ready');`;
  const child = fork("", [], { execArgv: ["--import", "tsx", "--input-type=module", "-e", source], silent: true });
  const message = () => Promise.race([once(child, "message").then(([value]) => value), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("IPC deadline: opposing writer did not settle")), 5000); timer.unref(); })]);
  try {
    expect(await message()).toBe("ready");
    const before = await captureAuthoringWorkspace(f.options);
    let next = message(); child.send("hold"); expect(await next).toBe("held");
    await expect(f.service.apply(request)).rejects.toMatchObject({ code: "conflict" });
    next = message(); child.send("release"); expect(await next).toBe("released");
    expect((await captureAuthoringWorkspace(f.options)).digest).toBe(before.digest);
    let entered!: () => void, release!: () => void;
    const held = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    if (domain === "content") {
      const original = f.deps.content;
      f.deps.content = async workspaceId => { const content = await original(workspaceId); return { ...content, service: { ...content.service, apply: async input => { entered(); await resume; return content.service.apply(input); } } }; };
    } else {
      const original = f.drafts.apply;
      f.drafts.apply = (input, guard) => original(input, async state => { await guard?.(state); entered(); await resume; });
    }
    const applying = f.service.apply(request);
    await held;
    next = message(); child.send("try"); expect(await next).toMatchObject({ refused: expect.any(String) });
    release();
    expect((await applying).domain).toBe(domain);
    expect((await f.service.apply(request)).recovered).toBe(true);
  } finally { child.kill(); await once(child, "exit"); }
}, 20_000);
it("rejects every mismatched acknowledgement identity without Content writes", async () => {
  const f = await fixture(), { card } = await f.stage(), preview = await f.service.preview({ workspaceId: "proof", reviewId: card.id, pathname: "/" });
  const exact = ack(preview), before = await (await f.capture()).stores.content.readAll();
  const invalid = [
    { ...exact, reviewId: `review-${"e".repeat(64)}` }, { ...exact, candidateDigest: "e".repeat(64) }, { ...exact, baseDigest: "e".repeat(64) },
    { ...exact, frameId: "00000000-0000-4000-8000-000000000001" },
    ...Object.entries({ workspaceId: "other", pathname: "/lessons", revision: "e".repeat(64), packId: "other", packVersion: "other", rendererId: "other", rendererVersion: "other", rendererDigest: "e".repeat(64) }).map(([key, value]) => ({ ...exact, identity: { ...exact.identity, [key]: value } })),
  ];
  for (const rendered of invalid) await expect(f.service.apply({ workspaceId: "proof", reviewId: card.id, rendered })).rejects.toMatchObject({ code: "approval-mismatch" });
  expect(await (await f.capture()).stores.content.readAll()).toEqual(before);
});
for (const changed of ["mapping", "sitemap", "assets", "publicFiles", "policy"] as const) it(`changed ${changed} refuses Content Apply before history or receipt writes`, async () => {
  const f = await fixture(), { card } = await f.stage(), preview = await f.service.preview({ workspaceId: "proof", reviewId: card.id, pathname: "/" });
  const state = await f.capture(), before = await state.stores.content.readAll();
  const history = await state.stores.content.listRevisions("consultation", { limit: 100 });
  if (changed === "mapping") { const record = structuredClone((await state.stores.mappings.snapshot()).records[0]!); record.updatedAt = "2030-01-01T00:00:00.000Z"; await state.stores.mappings.put(record); }
  if (changed === "sitemap") { const record = structuredClone((await state.stores.sitemaps.snapshot()).records[0]!); record.updatedAt = "2030-01-01T00:00:00.000Z"; await state.stores.sitemaps.put(record); }
  if (changed === "assets") await state.stores.assets.upload({ fileName: "pixel.png", declaredMimeType: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64") });
  if (changed === "publicFiles") { await writeFile(join(f.root, "new.txt"), "changed"); f.deps.options = async () => ({ ...f.options, publicFiles: [{ sourcePath: "new.txt", fileName: "new.txt" }] }); }
  if (changed === "policy") f.deps.options = async () => ({ ...f.options, composerConfig: { ...f.config, assistant: { ...f.config.assistant!, contentFields: [] } } });
  await expect(f.service.apply({ workspaceId: "proof", reviewId: card.id, rendered: ack(preview) })).rejects.toMatchObject({ code: "stale-plan" });
  expect(await state.stores.content.readAll()).toEqual(before);
  expect(await state.stores.content.listRevisions("consultation", { limit: 100 })).toEqual(history);
  expect((await (await f.deps.content("proof")).service.read({ proposalId: card.operation.domain === "content" ? card.operation.proposalId : "" })).applied).toBeFalsy();
  await expect(lstat(join(workspaceDomainRoots(f.config.paths, "proof").compositions, ".mutation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
});
