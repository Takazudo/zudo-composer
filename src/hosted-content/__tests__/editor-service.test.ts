import { describe, expect, it } from "vitest";
import { createContentStorageConformanceBaseline } from "../conformance";
import { applyHostContentRequest, createContentEditorStorage, readHostContentReceipt } from "../editor-service";
import type { HostContentPolicy } from "../policy";
import { createMemoryContentDraftStorage } from "../storage";

const policy: HostContentPolicy = {
  projectId: "conformance-site",
  providerId: "content-filesystem",
  models: { notes: { fields: ["title", "body"], operations: ["put-entry-values"] } },
};
const actor = { subject: "editor@example.test" };
const now = () => "2026-10-12T01:00:00.000Z";

async function open() {
  const adapter = await createMemoryContentDraftStorage(createContentStorageConformanceBaseline(), { now });
  const draft = await adapter.readDraft();
  if (draft.status !== "ok") throw new Error("seed failed");
  return { adapter, draft: draft.value };
}

const titleRequest = (expectedRevision: number, title: string) => ({ kind: "put-entry-values", projectId: policy.projectId, providerId: policy.providerId, modelId: "notes", entryId: "first", values: { title }, expectedRevision });

describe("applyHostContentRequest", () => {
  it("applies a permitted put-entry-values request against the expected revision", async () => {
    const { adapter, draft } = await open();
    const result = await applyHostContentRequest(adapter, { operationId: "op-1", request: titleRequest(draft.draftRevision, "日本語の題名"), expectedBaselineRevision: draft.baselineRevision }, { policy, actor, now });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.value.replayed).toBe(false);
    expect(result.value.receipt.previousDraftRevision).toBe(draft.draftRevision);
    expect(result.value.draft.snapshot.entries.find((entry) => entry.id === "first")?.values.title).toBe("日本語の題名");
  });

  it("recovers a committed operation before any fresh check, even after the draft moved on", async () => {
    const { adapter, draft } = await open();
    const input = { operationId: "op-lost", request: titleRequest(draft.draftRevision, "A"), expectedBaselineRevision: draft.baselineRevision };
    const first = await applyHostContentRequest(adapter, input, { policy, actor, now });
    expect(first.status).toBe("ok");
    const later = await applyHostContentRequest(adapter, { operationId: "op-later", request: titleRequest(first.status === "ok" ? first.value.draft.draftRevision : -1, "B"), expectedBaselineRevision: draft.baselineRevision }, { policy, actor, now });
    expect(later.status).toBe("ok");
    const replay = await applyHostContentRequest(adapter, input, { policy, actor, now });
    expect(replay.status).toBe("ok");
    if (replay.status !== "ok" || first.status !== "ok" || later.status !== "ok") return;
    expect(replay.value.replayed).toBe(true);
    expect(replay.value.receipt).toEqual(first.value.receipt);
    expect(replay.value.draft.draftRevision).toBe(later.value.draft.draftRevision);
    expect(replay.value.draft.snapshot.entries.find((entry) => entry.id === "first")?.values.title).toBe("B");
  });

  it("refuses to reuse an operation id for a different request without writing", async () => {
    const { adapter, draft } = await open();
    await applyHostContentRequest(adapter, { operationId: "op-1", request: titleRequest(draft.draftRevision, "A"), expectedBaselineRevision: draft.baselineRevision }, { policy, actor, now });
    const before = await adapter.readDraft();
    const reused = await applyHostContentRequest(adapter, { operationId: "op-1", request: titleRequest(draft.draftRevision, "Other"), expectedBaselineRevision: draft.baselineRevision }, { policy, actor, now });
    expect(reused).toMatchObject({ status: "conflict", reason: "operation-id" });
    expect(await adapter.readDraft()).toEqual(before);
  });

  it("turns a stale expected revision into a draft-revision conflict naming the current identity", async () => {
    const { adapter, draft } = await open();
    await applyHostContentRequest(adapter, { operationId: "op-1", request: titleRequest(draft.draftRevision, "A"), expectedBaselineRevision: draft.baselineRevision }, { policy, actor, now });
    const current = await adapter.readDraft();
    const stale = await applyHostContentRequest(adapter, { operationId: "op-2", request: titleRequest(draft.draftRevision, "B"), expectedBaselineRevision: draft.baselineRevision }, { policy, actor, now });
    expect(stale).toEqual({ status: "conflict", reason: "draft-revision", current: { draftRevision: current.status === "ok" ? current.value.draftRevision : -1, baselineRevision: draft.baselineRevision } });
    expect((await adapter.readReceipt("op-2")).status).toBe("not-found");
  });

  it("rejects a request prepared against another baseline", async () => {
    const { adapter, draft } = await open();
    const result = await applyHostContentRequest(adapter, { operationId: "op-1", request: titleRequest(draft.draftRevision, "A"), expectedBaselineRevision: "other-baseline" }, { policy, actor, now });
    expect(result).toMatchObject({ status: "conflict", reason: "baseline-revision" });
  });

  it("refuses protected fields, structural requests and smuggled privileges at the service", async () => {
    const { adapter, draft } = await open();
    const base = { operationId: "op-x", expectedBaselineRevision: draft.baselineRevision };
    const protectedField = await applyHostContentRequest(adapter, { ...base, request: { ...titleRequest(draft.draftRevision, "A"), values: { order: 9 } } }, { policy, actor, now });
    expect(protectedField).toMatchObject({ status: "refused", refusal: { code: "forbidden" } });
    const schema = await applyHostContentRequest(adapter, { ...base, request: { kind: "put-model", projectId: policy.projectId, providerId: policy.providerId, modelId: "notes", expectedRevision: draft.draftRevision } }, { policy, actor, now });
    expect(schema).toMatchObject({ status: "refused", refusal: { code: "malformed-request" } });
    const privileged = await applyHostContentRequest(adapter, { ...base, request: { ...titleRequest(draft.draftRevision, "A"), policy: { models: {} } } }, { policy, actor, now });
    expect(privileged).toMatchObject({ status: "refused", refusal: { code: "malformed-request" } });
    const deletion = await applyHostContentRequest(adapter, { ...base, request: { kind: "delete-entry", projectId: policy.projectId, providerId: policy.providerId, modelId: "notes", entryId: "first", expectedRevision: draft.draftRevision } }, { policy, actor, now });
    expect(deletion).toMatchObject({ status: "refused", refusal: { code: "forbidden" } });
    const badId = await applyHostContentRequest(adapter, { ...base, operationId: "../etc", request: titleRequest(draft.draftRevision, "A") }, { policy, actor, now });
    expect(badId).toMatchObject({ status: "refused" });
    expect(await adapter.readDraft()).toEqual({ status: "ok", value: draft });
  });

  it("clears a permitted field with null", async () => {
    const { adapter, draft } = await open();
    const result = await applyHostContentRequest(adapter, { operationId: "op-1", request: { ...titleRequest(draft.draftRevision, "A"), values: { body: null } }, expectedBaselineRevision: draft.baselineRevision }, { policy, actor, now });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(Object.hasOwn(result.value.draft.snapshot.entries.find((entry) => entry.id === "first")!.values, "body")).toBe(false);
  });

  it("returns receipts only to the actor that wrote them", async () => {
    const { adapter, draft } = await open();
    await applyHostContentRequest(adapter, { operationId: "op-1", request: titleRequest(draft.draftRevision, "A"), expectedBaselineRevision: draft.baselineRevision }, { policy, actor, now });
    expect((await readHostContentReceipt(adapter, "op-1", actor)).status).toBe("ok");
    expect((await readHostContentReceipt(adapter, "op-1", { subject: "someone-else" })).status).toBe("not-found");
    const replayByOther = await applyHostContentRequest(adapter, { operationId: "op-1", request: titleRequest(draft.draftRevision, "A"), expectedBaselineRevision: draft.baselineRevision }, { policy, actor: { subject: "someone-else" }, now });
    expect(replayByOther).toMatchObject({ status: "conflict", reason: "operation-id" });
  });

  it("binds the editor storage shape to an adapter", async () => {
    const { adapter, draft } = await open();
    const storage = createContentEditorStorage(adapter, { policy, actor, now });
    expect(await storage.read()).toEqual({ status: "ok", value: draft });
    const applied = await storage.apply({ operationId: "op-1", request: { kind: "put-entry-values", projectId: policy.projectId, providerId: policy.providerId, modelId: "notes", entryId: "first", values: { title: "A" }, expectedRevision: draft.draftRevision }, expectedBaselineRevision: draft.baselineRevision });
    expect(applied.status).toBe("ok");
    expect((await storage.readReceipt("op-1")).status).toBe("ok");
    const latest = applied.status === "ok" ? applied.value.draft.draftRevision : -1;
    expect((await storage.snapshot({ expectedDraftRevision: latest })).status).toBe("ok");
  });
});
