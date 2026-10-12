import { describe, expect, it } from "vitest";
import { CONTENT_STORAGE_CONFORMANCE_CASES, CONTENT_STORAGE_CONFORMANCE_POLICY, createContentStorageConformanceBaseline, runContentStorageConformance } from "../conformance";
import { authorizeContentMutation } from "../policy";
import { contentSnapshotId, createMemoryContentDraftStorage, projectWithContentSnapshot } from "../storage";

const actor = { subject: "editor@example.test" };

describe("memory content draft storage conformance", () => {
  runContentStorageConformance((baseline) => createMemoryContentDraftStorage(baseline), { test: it });

  it("runs the same suite sequentially without a harness and names the failing case", async () => {
    await expect(runContentStorageConformance((baseline) => createMemoryContentDraftStorage(baseline))).resolves.toBeUndefined();
    const broken = async (baseline: Parameters<typeof createMemoryContentDraftStorage>[0]) => {
      const adapter = await createMemoryContentDraftStorage(baseline);
      return { ...adapter, readReceipt: async () => ({ status: "not-found" as const }) };
    };
    await expect(runContentStorageConformance(broken)).rejects.toThrow(/records a receipt/);
    expect(CONTENT_STORAGE_CONFORMANCE_CASES.length).toBeGreaterThanOrEqual(12);
  });
});

describe("memory content draft storage", () => {
  it("keeps the receipt durable when the acknowledgement is lost after commit", async () => {
    const baseline = createContentStorageConformanceBaseline();
    let drop = true;
    const adapter = await createMemoryContentDraftStorage(baseline, { afterCommit: () => { if (drop) { drop = false; throw new Error("socket closed"); } } });
    const draft = await adapter.readDraft();
    if (draft.status !== "ok") throw new Error("draft");
    const authorized = authorizeContentMutation(CONTENT_STORAGE_CONFORMANCE_POLICY, actor, { kind: "put-entry-values", projectId: baseline.project.id, providerId: "content-filesystem", modelId: "notes", expectedRevision: draft.value.draftRevision, entryId: "first", values: { title: "Lost" } }, draft.value.snapshot);
    if (!authorized.ok) throw new Error(authorized.message);
    const input = { operationId: "lost-ack", actor, mutation: authorized.mutation, expectedDraftRevision: draft.value.draftRevision, expectedBaselineRevision: baseline.baselineRevision };
    await expect(adapter.apply(input)).rejects.toThrow("socket closed");
    const receipt = await adapter.readReceipt("lost-ack");
    expect(receipt.status).toBe("ok");
    const retry = await adapter.apply(input);
    expect(retry).toMatchObject({ status: "ok", value: { replayed: true } });
    const after = await adapter.readDraft();
    expect(after.status === "ok" && after.value.snapshot.entries.find(({ id }) => id === "first")?.values.title).toBe("Lost");
    expect(after.status === "ok" && after.value.draftRevision).toBe(receipt.status === "ok" ? receipt.value.draftRevision : -1);
  });

  it("names snapshots by the canonical project digest and preserves non-content providers", async () => {
    const baseline = createContentStorageConformanceBaseline();
    const adapter = await createMemoryContentDraftStorage(baseline);
    const draft = await adapter.readDraft();
    if (draft.status !== "ok") throw new Error("draft");
    const snapshot = await adapter.snapshot({ expectedDraftRevision: draft.value.draftRevision });
    if (snapshot.status !== "ok") throw new Error("snapshot");
    const expected = projectWithContentSnapshot(baseline.project, draft.value.snapshot);
    expect(snapshot.value.snapshotId).toBe(await contentSnapshotId(expected));
    expect(snapshot.value.project.providers.compositions).toEqual(baseline.project.providers.compositions);
    expect(snapshot.value.project.providers.sitemaps).toEqual(baseline.project.providers.sitemaps);
    expect(() => projectWithContentSnapshot(baseline.project, { ...draft.value.snapshot, providerId: "elsewhere" })).toThrow(/no Content provider/);
  });

  it("refuses a baseline whose project lacks the Content provider", async () => {
    const baseline = createContentStorageConformanceBaseline();
    baseline.project.providers.content = [];
    await expect(createMemoryContentDraftStorage(baseline)).rejects.toThrow(/no Content provider/);
  });
});
