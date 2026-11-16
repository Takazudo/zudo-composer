import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFilesystemContentStore } from "../../../src/content/storage/filesystem";
import { openContentAiProposalStore } from "../../../src/content/storage/filesystem/content-ai-proposals";
import { createContentAiService, createContentAiStager, type ContentAiServiceOptions, type ContentAiProposerInput, type ContentAiStageRequest } from "../../../src/content/editorial/ai";
import { createNativeContentEditorial } from "../../../src/content/editorial/native";
import { createNativeContentAiService, createNativeContentAiStager } from "../../../src/content/storage/file-provider/dev-server-entry";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(modelId = "course", key = "price", kind: "text" | "markdown" = "text") {
  const root = await mkdtemp(join(tmpdir(), "content-ai-policy-")); roots.push(root);
  const store = await createFilesystemContentStore({ contentRoot: join(root, "content") });
  const stamp = "2026-01-01T00:00:00.000Z", fieldId = `${modelId}-${key}`;
  await store.seed({ models: [{ id: modelId, createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 1, id: modelId, name: modelId, kind: "collection", description: "", fields: [
    { id: fieldId, key, label: key, required: true, kind },
    { id: "order", key: "order", label: "Order", required: false, kind: "number" },
  ] } }], entries: [{ schemaVersion: 1, id: "stable-entry", modelId, lifecycle: "published", generation: 0, createdAt: stamp, updatedAt: stamp, values: { [fieldId]: "Original", order: 1 } }] });
  const entry = { providerId: store.provider.id, modelId, recordId: "stable-entry" };
  const boundary: ContentAiServiceOptions["boundary"] = provenance => createNativeContentEditorial({ store, provenance, readPublished: async () => null });
  const proposer = { label: "Configured provider", propose: vi.fn(async (input: ContentAiProposerInput) => { void input; return { kind: "proposal" as const, values: { [key]: "Proposed" }, summary: "Requested change" }; }) };
  const options: ContentAiServiceOptions = { boundary, actor: { id: "local-owner" }, owner: `native:${store.root}`, proposer, store: await openContentAiProposalStore(join(root, "proposals")), createId: () => "proposal-ordinary", contentFields: [{ providerId: entry.providerId, modelId, fieldIds: [fieldId] }] };
  const request: ContentAiStageRequest = { entry, expected: String((await store.readAll()).mutationToken), values: { [fieldId]: "Proposed" }, summary: "Requested change", preparationKey: "run-1:tool-1" };
  return { root, store, entry, fieldId, boundary, proposer, options, request, stager: createContentAiStager({ ...options, providerLabel: proposer.label }) };
}

describe("bounded Content-AI policy and trusted staging", () => {
  it.each([["course", "price", "text"], ["faq-item", "answer", "text"], ["note", "body", "markdown"]] as const)("stages %s.%s without inference or canonical writes, then applies and undoes through native history", async (model, key, kind) => {
    const f = await fixture(model, key, kind), before = await f.store.readAll();
    const result = await f.stager.stage(f.request);
    expect(result.status).toBe("proposed"); if (result.status !== "proposed") return;
    expect(f.proposer.propose).not.toHaveBeenCalled();
    expect(await f.store.readAll()).toEqual(before);
    const service = createContentAiService(f.options);
    await service.apply({ proposalId: result.proposal.id, renderedCandidate: result.proposal.candidateDigest });
    expect((await f.store.readAll()).entries[0]?.values[f.fieldId]).toBe("Proposed");
    await service.undo({ proposalId: result.proposal.id });
    expect((await f.store.readAll()).entries[0]?.values[f.fieldId]).toBe("Original");
  });

  it("enforces exact provider/model/field IDs and text kinds for scope and model results", async () => {
    const f = await fixture();
    for (const contentFields of [[], [{ providerId: "foreign", modelId: "course", fieldIds: [f.fieldId] }], [{ providerId: f.entry.providerId, modelId: "other", fieldIds: [f.fieldId] }], [{ providerId: f.entry.providerId, modelId: "course", fieldIds: ["price", "order"] }]]) {
      await expect(createContentAiService({ ...f.options, contentFields }).scope(f.entry)).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(f.stager.stage({ ...f.request, values: { price: "wrong-key" } })).rejects.toMatchObject({ code: "forbidden" });
    const ordinary = await createContentAiService(f.options).prepare({ entry: f.entry, instruction: "Change price" });
    expect(ordinary.status).toBe("proposed");
    expect(f.proposer.propose).toHaveBeenCalledTimes(1);
    expect(f.proposer.propose.mock.calls[0]?.[0]).toMatchObject({ fields: [{ key: "price", value: "Original" }] });
  });

  it("recovers deterministic staging across restart and a lost create response, rejecting changed payload reuse", async () => {
    const f = await fixture();
    const lost = createContentAiStager({ ...f.options, providerLabel: f.proposer.label, store: { read: f.options.store.read, create: async record => { await f.options.store.create(record); throw new Error("response lost"); } } });
    const first = await lost.stage(f.request); expect(first.status).toBe("proposed");
    const reopened = createContentAiStager({ ...f.options, store: await openContentAiProposalStore(join(f.root, "proposals")), providerLabel: f.proposer.label });
    expect(await reopened.stage(f.request)).toEqual(first);
    await expect(reopened.stage({ ...f.request, values: { [f.fieldId]: "Different" } })).rejects.toMatchObject({ code: "operation-key-reuse" });
    expect(f.proposer.propose).not.toHaveBeenCalled();
  });

  it("recovers a persisted proposal without current-source reads or writes, retaining identity and cancellation fences", async () => {
    const f = await fixture();
    expect(await f.stager.recover(f.request)).toBeNull();
    const first = await f.stager.stage(f.request);
    await f.boundary({ actor: { id: "human" }, source: "content-editor" }).saveFields({ entry: f.entry, expected: f.request.expected, values: { [f.fieldId]: "Later" }, clear: [], operationKey: "human-after-staging" });
    const before = await f.store.readAll();
    const boundary = vi.fn(() => { throw new Error("Recovery must not open current Content"); });
    const create = vi.fn(async () => { throw new Error("Recovery must not persist"); });
    const reopened = createContentAiStager({ ...f.options, boundary, contentFields: [], proposer: null, providerLabel: f.proposer.label,
      store: { read: (await openContentAiProposalStore(join(f.root, "proposals"))).read, create } });
    const fence = vi.fn(async () => undefined);
    expect(await reopened.recover(f.request, { beforePersist: fence })).toEqual(first);
    expect(fence).toHaveBeenCalledTimes(1);
    for (const changed of [{ ...f.request, expected: "changed" }, { ...f.request, values: { [f.fieldId]: "Changed" } }, { ...f.request, summary: "Changed" }]) {
      await expect(reopened.recover(changed)).rejects.toMatchObject({ code: "operation-key-reuse" });
    }
    const abort = new AbortController();
    await expect(reopened.recover(f.request, { signal: abort.signal, beforePersist: async () => abort.abort() })).rejects.toThrow();
    const foreign = createContentAiStager({ ...f.options, owner: "foreign", providerLabel: f.proposer.label });
    expect(await foreign.recover(f.request)).toBeNull();
    const tampered = createContentAiStager({ ...f.options, providerLabel: f.proposer.label, store: { create, read: async id => {
      const record = await f.options.store.read(id); return record && { ...record, actorId: "another-owner" };
    } } });
    await expect(tampered.recover(f.request)).rejects.toMatchObject({ code: "operation-key-reuse" });
    expect(boundary).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(f.proposer.propose).not.toHaveBeenCalled();
    expect(await f.store.readAll()).toEqual(before);
    if (first.status !== "proposed") throw new Error("Expected proposal");
    await expect(createContentAiService(f.options).apply({ proposalId: first.proposal.id, renderedCandidate: first.proposal.candidateDigest })).rejects.toMatchObject({ code: "revision-conflict" });
  });

  it("cancels before private persistence and refuses stale Content without canonical writes", async () => {
    const f = await fixture(), create = vi.spyOn(f.options.store, "create");
    const abort = new AbortController();
    await expect(f.stager.stage(f.request, { signal: abort.signal, beforePersist: async () => abort.abort() })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    await f.boundary({ actor: { id: "human" }, source: "content-editor" }).saveFields({ entry: f.entry, expected: f.request.expected, values: { [f.fieldId]: "Human" }, clear: [], operationKey: "human-edit" });
    const before = await f.store.readAll();
    await expect(f.stager.stage(f.request)).rejects.toMatchObject({ code: "revision-conflict" });
    expect(await f.store.readAll()).toEqual(before); expect(create).not.toHaveBeenCalled();
  });

  it("revalidates policy for fresh Apply but recovers committed Apply with policy/provider unavailable and guards Undo", async () => {
    const f = await fixture(), result = await f.stager.stage(f.request); if (result.status !== "proposed") throw new Error("Expected proposal");
    const apply = { proposalId: result.proposal.id, renderedCandidate: result.proposal.candidateDigest };
    await expect(createContentAiService({ ...f.options, contentFields: [] }).apply(apply)).rejects.toMatchObject({ code: "forbidden" });
    const first = await createContentAiService(f.options).apply(apply);
    expect(await createContentAiService({ ...f.options, contentFields: [], proposer: null, canApply: false }).apply({ proposalId: result.proposal.id })).toEqual({ ...first, recovered: true });
    await f.boundary({ actor: { id: "human" }, source: "content-editor" }).saveFields({ entry: f.entry, expected: first.receipt.expected, values: { [f.fieldId]: "Later human" }, clear: [], operationKey: "later-human" });
    await expect(createContentAiService(f.options).undo({ proposalId: result.proposal.id })).rejects.toMatchObject({ code: "revision-conflict" });
    expect((await f.store.readAll()).entries[0]?.values[f.fieldId]).toBe("Later human");
  });

  it("native adapters share owner, durable proposals and trusted field policy", async () => {
    const f = await fixture();
    const host = { provider: { ...f.proposer, proposer: f.proposer, inference: async () => ({ state: "ready" as const, detail: "test only" }) }, canApply: true, proposalRoot: join(f.root, "adapter-proposals"), contentFields: f.options.contentFields };
    const stager = await createNativeContentAiStager(f.store, async () => null, host);
    const result = await stager.stage(f.request); if (result.status !== "proposed") throw new Error("Expected proposal");
    const service = await createNativeContentAiService(f.store, async () => null, host);
    expect((await service.read({ proposalId: result.proposal.id })).proposal).toEqual(result.proposal);
    expect((await service.scope(f.entry)).map(field => field.id)).toEqual([f.fieldId]);
  });
});
