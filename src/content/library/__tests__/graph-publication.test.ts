import { describe, expect, it, vi } from "vitest";
import { applyContentInverseMutation, buildContentGraphIndex, contentEntryDigest, createContentEntryRecord, createContentModelRecord, getContentDeletionBlockers, getContentPublicationChanges, planContentInverseMutation, readContentGraph, selectContentPublicationCandidate } from "..";
import type { ContentSnapshot, ContentStore } from "..";

const timestamp = "2026-01-01T00:00:00.000Z", providerId = "content-filesystem";
const ref = (recordId: string, provider = providerId) => ({ providerId: provider, modelId: "items", recordId });
const model = createContentModelRecord({ name: "Items", kind: "collection", fields: [{ id: "title", key: "title", label: "Title", required: true, kind: "text" }, { id: "refs", key: "refs", label: "Refs", required: false, kind: "reference-list", target: { providerId, recordId: "items" }, ordered: true }] }, { id: "items", timestamp });
const entry = (id: string, title = id) => createContentEntryRecord("items", { title }, { id, timestamp });
const snapshot = (entries: ContentSnapshot["entries"]): ContentSnapshot => ({ providerId, mutationToken: 1, models: [model], entries });

describe("Complete provider-qualified Content graph", () => {
  it("finds incoming refs beyond 25 entries, preserving order and nested asset locations", () => {
    const entries = Array.from({ length: 60 }, (_, i) => entry(`entry-${i}`));
    entries[59]!.values.refs = [ref("entry-0"), ref("entry-1")];
    const graph = buildContentGraphIndex([snapshot(entries)]);
    expect(graph.complete).toBe(true);
    expect(graph.incoming(ref("entry-0"))).toMatchObject([{ owner: { entry: ref("entry-59"), path: ["refs", 0] }, ordered: true }]);
    expect(graph.incoming(ref("entry-0", "foreign"))).toEqual([]);
  });

  it("reports foreign providers as unknown rather than unused", () => {
    const foreignModel = { ...model, document: { ...model.document, fields: [{ id: "ref", key: "ref", label: "Ref", required: false, kind: "reference" as const, target: { providerId: "foreign", recordId: "items" } }] } };
    const owner = entry("owner"); owner.values = { ref: ref("target", "foreign") };
    const current = { ...snapshot([owner]), models: [foreignModel] };
    expect(buildContentGraphIndex([current])).toMatchObject({ complete: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "missing-provider" })]) });
    const target = { ...snapshot([entry("target")]), providerId: "foreign", models: [{ ...model, document: { ...model.document, fields: [model.document.fields[0]!] } }] };
    expect(buildContentGraphIndex([current, target]).complete).toBe(true);
  });

  it("plans one owning transaction and rejects multi-provider inverse writes before store calls", async () => {
    const current = snapshot([entry("a"), entry("b"), entry("target")]);
    const edits = [{ owner: ref("a"), fieldId: "refs", targets: [ref("target")] }, { owner: ref("b"), fieldId: "refs", targets: [ref("target"), ref("a")] }];
    expect(planContentInverseMutation([current], edits)).toMatchObject({ providerId, mutation: { expectedMutationToken: 1, operations: [{ kind: "put-entry", record: { id: "a" } }, { kind: "put-entry", record: { id: "b" } }] } });
    const transact = vi.fn();
    const store = { provider: { id: providerId }, transactionScope: "provider", transact } as unknown as ContentStore;
    await expect(applyContentInverseMutation(store, [current], [...edits, { owner: ref("c", "foreign"), fieldId: "refs", targets: [] }])).rejects.toMatchObject({ code: "unsupported-transaction" });
    expect(transact).not.toHaveBeenCalled();
  });

  it("distinguishes coherent reads, changing tokens, unavailable providers and unsafe deletion claims", async () => {
    const current = snapshot([entry("a")]);
    const readAll = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce({ ...current, mutationToken: 2 });
    expect(await readContentGraph([{ provider: { id: providerId, label: "Content" }, readAll }])).toMatchObject({ status: "changed", providerIds: [providerId] });
    expect(await readContentGraph([{ provider: { id: providerId, label: "Content" }, readAll: async () => current }])).toMatchObject({ status: "ready", index: { complete: true } });
    expect(await readContentGraph([{ provider: { id: providerId, label: "Content" }, readAll: async () => { throw new Error("offline"); } }])).toMatchObject({ status: "unavailable" });
    const owner = entry("owner"); owner.values.refs = [ref("a")];
    const graph = buildContentGraphIndex([snapshot([owner, entry("a")])]);
    expect(getContentDeletionBlockers(graph, { kind: "entry", ref: ref("a") })).toMatchObject([{ code: "incoming-reference" }]);
    const broken = buildContentGraphIndex([snapshot([owner])]);
    expect(getContentDeletionBlockers(broken, { kind: "entry", ref: ref("a") })).toMatchObject([{ code: "unknown" }]);
  });
});

describe("Explicit publication selection", () => {
  const publicationStates = [
    { name: "missing everywhere", baseline: false, current: undefined, allowed: [] },
    { name: "new draft", baseline: false, current: entry("a"), allowed: ["publish"] },
    { name: "published intent absent from baseline", baseline: false, current: { ...entry("a"), lifecycle: "published" }, allowed: ["publish"] },
    { name: "deleted baseline entry", baseline: true, current: undefined, allowed: ["delete"] },
    { name: "unchanged published entry", baseline: true, current: { ...entry("a"), lifecycle: "published" }, allowed: [] },
    { name: "changed published entry", baseline: true, current: { ...entry("a", "edited"), lifecycle: "published" }, allowed: ["publish"] },
    { name: "explicit unpublish intent", baseline: true, current: entry("a"), allowed: ["unpublish"] },
    { name: "edited explicit unpublish intent", baseline: true, current: entry("a", "edited"), allowed: ["unpublish"] },
  ] as const;

  for (const state of publicationStates) for (const action of ["publish", "delete", "unpublish"] as const) {
    it(`${action} validates ${state.name}`, () => {
      const baseline = snapshot(state.baseline ? [{ ...entry("a"), lifecycle: "published" }] : []);
      const working = snapshot(state.current ? [state.current] : []);
      const original = structuredClone({ baseline, working });
      const select = () => selectContentPublicationCandidate([working], [baseline], [{ ref: ref("a"), action }]);
      if ((state.allowed as readonly string[]).includes(action)) {
        const result = select();
        expect(result[0]!.entries).toEqual(action === "publish" ? [{ ...state.current, lifecycle: "published" }] : []);
      } else expect(select).toThrow();
      expect({ baseline, working }).toEqual(original);
    });
  }

  it("rejects a stale unpublish selection after published intent is restored", () => {
    const baseline = snapshot([{ ...entry("a"), lifecycle: "published" }]);
    const unpublished = snapshot([entry("a")]);
    expect(getContentPublicationChanges([unpublished], [baseline])).toEqual([{ ref: ref("a"), kind: "unpublish" }]);
    const restored = snapshot([{ ...entry("a"), lifecycle: "published" }]);
    expect(getContentPublicationChanges([restored], [baseline])).toEqual([]);
    expect(() => selectContentPublicationCandidate([restored], [baseline], [{ ref: ref("a"), action: "unpublish" }])).toThrow("does not match");
    expect(selectContentPublicationCandidate([restored], [baseline], [])[0]!.entries).toEqual(baseline.entries);
  });

  it("retains unselected published B baseline while publishing edited A and excluding new drafts", () => {
    const baseline = snapshot(["a", "b", "deleted", "unpublish"].map((id) => ({ ...entry(id, `old ${id}`), lifecycle: "published" as const })));
    const working = snapshot([{ ...entry("a", "new a"), lifecycle: "published" }, { ...entry("b", "new b"), lifecycle: "published" }, entry("unpublish"), entry("new")]);
    const changes = getContentPublicationChanges([working], [baseline]);
    expect(changes.map((item) => [item.ref.recordId, item.kind])).toEqual([["a", "changed"], ["b", "changed"], ["unpublish", "unpublish"], ["new", "new"], ["deleted", "deleted"]]);
    const [candidate] = selectContentPublicationCandidate([working], [baseline], [{ ref: ref("a"), action: "publish" }]);
    expect(candidate!.entries.map((item) => [item.id, item.values.title])).toEqual([["a", "new a"], ["b", "old b"], ["deleted", "old deleted"], ["unpublish", "old unpublish"]]);
    const [removed] = selectContentPublicationCandidate([working], [baseline], [{ ref: ref("deleted"), action: "delete" }, { ref: ref("unpublish"), action: "unpublish" }, { ref: ref("new"), action: "publish" }]);
    expect(removed!.entries.map((item) => item.id)).toEqual(["a", "b", "new"]);
    expect(working.entries[3]!.lifecycle).toBe("draft");
    expect(contentEntryDigest({ ...entry("x"), generation: 99 })).toBe(contentEntryDigest(entry("x")));
  });

  it("keeps structural working schemas so incompatible retained baseline values block graph checks", () => {
    const baseline = snapshot([{ ...entry("a"), lifecycle: "published" }]);
    const working = { ...snapshot([]), models: [{ ...model, document: { ...model.document, fields: [] } }] };
    const candidate = selectContentPublicationCandidate([working], [baseline], []);
    expect(buildContentGraphIndex(candidate)).toMatchObject({ complete: false, diagnostics: [expect.objectContaining({ code: "invalid-value" })] });
    expect(() => selectContentPublicationCandidate([working], [baseline], [{ ref: ref("missing"), action: "publish" }])).toThrow("missing");
  });

  it("never promotes drafts carried in a supplied baseline and rejects duplicate selections", () => {
    const working = snapshot([entry("a")]);
    expect(selectContentPublicationCandidate([working], [working], [])[0]!.entries).toEqual([]);
    expect(() => selectContentPublicationCandidate([working], [], [{ ref: ref("a"), action: "publish" }, { ref: ref("a"), action: "publish" }])).toThrow("Duplicate");
  });
});
