import { describe, expect, it, vi } from "vitest";
import { ContentEntryWriteConflict } from "../../content/controller";
import { createContentStorageConformanceBaseline } from "../../../hosted-content/conformance";
import { createContentEditorStorage, type ContentEditorStorage } from "../../../hosted-content/editor-service";
import { changedEntryValues, createContentEditorSession, type ContentEditorSaveState } from "../session";
import type { HostContentPolicy } from "../../../hosted-content/policy";
import { createMemoryContentDraftStorage } from "../../../hosted-content/storage";

const policy: HostContentPolicy = {
  projectId: "conformance-site",
  providerId: "content-filesystem",
  models: { notes: { fields: ["title", "body"], operations: ["put-entry-values"] } },
};
const actor = { subject: "editor@example.test" };

async function setup(fault?: (storage: ContentEditorStorage) => Partial<ContentEditorStorage>) {
  const adapter = await createMemoryContentDraftStorage(createContentStorageConformanceBaseline());
  const real = createContentEditorStorage(adapter, { policy, actor });
  const storage: ContentEditorStorage = { ...real, ...fault?.(real) };
  let counter = 0;
  const states: ContentEditorSaveState["status"][] = [];
  const session = createContentEditorSession({ storage, projectId: policy.projectId, providerId: policy.providerId, operationId: () => `op-${++counter}` });
  session.subscribe((state) => states.push(state.status));
  await session.load();
  // A second editor on the same durable draft.
  const other = createContentEditorStorage(adapter, { policy, actor: { subject: "other@example.test" } });
  return { adapter, session, states, other };
}

const entryOf = (session: Awaited<ReturnType<typeof setup>>["session"], id = "first") => structuredClone(session.draft!.snapshot.entries.find((entry) => entry.id === id)!);

describe("content editor save session", () => {
  it("sends only the changed values against the adopted revision and is saved only on a receipt", async () => {
    const { session, states, adapter } = await setup();
    expect(session.state).toMatchObject({ status: "clean" });
    const start = session.draft!.draftRevision;
    const edited = entryOf(session);
    edited.values.title = "改題";
    await session.writeEntry(edited);
    expect(states).toEqual(["loading", "loading", "clean", "saving", "saved"]);
    expect(session.state).toMatchObject({ status: "saved", revision: session.draft!.draftRevision });
    expect(session.draft!.draftRevision).not.toBe(start);
    const receipt = await adapter.readReceipt("op-1");
    expect(receipt.status === "ok" && receipt.value.previousDraftRevision).toBe(start);
    expect(session.pending).toBeNull();
  });

  it("does not write when nothing changed", async () => {
    const apply = vi.fn();
    const { session } = await setup(() => ({ apply }));
    await session.writeEntry(entryOf(session));
    expect(apply).not.toHaveBeenCalled();
    expect(session.state.status).toBe("clean");
  });

  it("encodes a cleared value as null", () => {
    const base = { schemaVersion: 1 as const, id: "a", modelId: "m", createdAt: "", updatedAt: "", lifecycle: "draft" as const, generation: 0, values: { title: "x", body: "y" } };
    expect(changedEntryValues(base, { ...base, values: { title: "x" } })).toEqual({ body: null });
  });

  it("recovers a lost acknowledgement through the receipt without applying twice", async () => {
    let calls = 0;
    const { session, adapter } = await setup((real) => ({
      async apply(input) {
        calls += 1;
        await real.apply(input);
        throw new Error("connection reset");
      },
    }));
    const edited = entryOf(session);
    edited.values.title = "Lost ack";
    await session.writeEntry(edited);
    expect(calls).toBe(1);
    expect(session.state).toMatchObject({ status: "saved" });
    const draft = await adapter.readDraft();
    expect(draft.status === "ok" && draft.value.draftRevision).toBe(session.draft!.draftRevision);
    expect(session.draft!.snapshot.entries.find((entry) => entry.id === "first")!.values.title).toBe("Lost ack");
  });

  it("keeps an unresolved operation and retries it under the same id before any newer edit", async () => {
    const sent: string[] = [];
    let offline = true;
    const { session } = await setup((real) => ({
      async apply(input) {
        sent.push(`${input.operationId}:${JSON.stringify(input.request.kind === "put-entry-values" ? input.request.values : null)}`);
        if (offline) throw new Error("offline");
        return real.apply(input);
      },
      async readReceipt(operationId) {
        if (offline) throw new Error("offline");
        return real.readReceipt(operationId);
      },
    }));
    const first = entryOf(session);
    first.values.title = "A";
    await expect(session.writeEntry(first)).rejects.toThrow(/not confirmed/);
    expect(session.state).toMatchObject({ status: "recovering", operationId: "op-1" });
    offline = false;
    const newer = { ...first, values: { ...first.values, title: "B" } };
    await session.writeEntry(newer);
    // op-1 was resolved (retried verbatim) before op-2 carried the newer value.
    expect(sent).toEqual(['op-1:{"title":"A"}', 'op-1:{"title":"A"}', 'op-2:{"title":"B"}']);
    expect(session.draft!.snapshot.entries.find((entry) => entry.id === "first")!.values.title).toBe("B");
    expect(session.state.status).toBe("saved");
  });

  it("retries the identical operation after an unavailable store", async () => {
    let unavailable = true;
    const ids: string[] = [];
    const { session } = await setup((real) => ({
      async apply(input) {
        ids.push(input.operationId);
        if (unavailable) { unavailable = false; return { status: "unavailable", message: "D1 busy" }; }
        return real.apply(input);
      },
    }));
    const edited = entryOf(session);
    edited.values.title = "Retry";
    await expect(session.writeEntry(edited)).rejects.toThrow(/unavailable/);
    expect(session.state).toMatchObject({ status: "failed", retryable: true });
    await session.writeEntry(edited);
    expect(ids).toEqual(["op-1", "op-1"]);
    expect(session.state.status).toBe("saved");
  });

  it("reports a conflict with the latest records adopted and the merge base preserved", async () => {
    const { session, other } = await setup();
    const opened = entryOf(session);
    const before = session.draft!;
    const theirs = await other.apply({ operationId: "theirs", expectedBaselineRevision: before.baselineRevision, request: { kind: "put-entry-values", projectId: policy.projectId, providerId: policy.providerId, modelId: "notes", entryId: "second", values: { title: "Theirs" }, expectedRevision: before.draftRevision } });
    expect(theirs.status).toBe("ok");
    const mine = { ...opened, values: { ...opened.values, title: "Mine" } };
    const failure = await session.writeEntry(mine).then(() => null, (cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ContentEntryWriteConflict);
    expect((failure as ContentEntryWriteConflict).base).toEqual(opened);
    expect(session.state).toMatchObject({ status: "conflict", reason: "draft-revision", authoritativeLoaded: true });
    expect(session.draft!.snapshot.entries.find((entry) => entry.id === "second")!.values.title).toBe("Theirs");
    // Reapply: a fresh operation against the adopted revision.
    await session.writeEntry(mine);
    expect(session.state.status).toBe("saved");
    expect(session.draft!.snapshot.entries.find((entry) => entry.id === "first")!.values.title).toBe("Mine");
  });

  it("blocks editing when the stored draft tracks another baseline", async () => {
    const adapter = await createMemoryContentDraftStorage(createContentStorageConformanceBaseline("baseline-2"));
    const session = createContentEditorSession({ storage: createContentEditorStorage(adapter, { policy, actor }), projectId: policy.projectId, providerId: policy.providerId, expectedBaselineRevision: "baseline-1" });
    await session.load();
    expect(session.state).toMatchObject({ status: "blocked", baselineRevision: "baseline-2" });
    await expect(session.writeEntry({} as never)).rejects.toThrow(/not loaded/);
  });

  it("surfaces a policy refusal as a definitive failure", async () => {
    const { session } = await setup();
    const edited = entryOf(session);
    edited.values.order = 42;
    await expect(session.writeEntry(edited)).rejects.toThrow(/not editable/);
    expect(session.state).toMatchObject({ status: "failed", code: "forbidden", retryable: false });
    expect(session.pending).toBeNull();
  });
});
