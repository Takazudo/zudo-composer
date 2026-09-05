import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyContentInverseMutation, buildContentGraphIndex, contentEntryDigest, createContentEntryRecord, createContentModelRecord } from "../../../library";
import type { ContentFieldDefinition, ContentModelRecord } from "../../../model";
import { createIndexedDbContentProvider } from "../provider";

const timestamp = "2026-01-01T00:00:00.000Z", providerId = "content-indexeddb";
const ref = (recordId: string) => ({ providerId, modelId: "items", recordId });
const title: ContentFieldDefinition = { id: "title", key: "title", label: "Title", required: true, kind: "text" };
const related: ContentFieldDefinition = { id: "related", key: "related", label: "Related", required: false, kind: "reference-list", target: { providerId, recordId: "items" }, ordered: true };
const model = () => createContentModelRecord({ name: "Items", kind: "collection", fields: [title, related] }, { id: "items", timestamp });
const entry = (id: string) => createContentEntryRecord("items", { title: id }, { id, timestamp });
async function setup() {
  const factory = new IDBFactory(), provider = createIndexedDbContentProvider({ idbFactory: factory });
  await provider.initialization.initialize(); await provider.store.putModel(model());
  return { provider, store: provider.store, factory };
}
afterEach(() => vi.restoreAllMocks());

describe("Rich Content transactions and durable snapshots", () => {
  it("round trips nested object/list/choice/media values and rejects schema edits invalidating existing data", async () => {
    const { store } = await setup();
    const rich: ContentFieldDefinition = { id: "details", key: "details", label: "Details", required: true, kind: "object", fields: [
      { id: "choices", key: "choices", label: "Choices", required: true, kind: "list", item: { kind: "choice", options: [{ value: "a", label: "A" }] } },
      { id: "image", key: "image", label: "Image", required: false, kind: "media-use", use: "image" },
    ] };
    const schema = model(); schema.document.fields.push(rich); await store.putModel(schema);
    const saved = entry("a"); saved.values.details = { choices: ["a", "a"], image: { kind: "image", asset: { providerId: "media-files", assetId: "asset" }, alt: "A", decorative: false, caption: "B" } };
    await store.putEntry(saved);
    const snapshot = await store.readAll(); expect(snapshot.entries[0]!.values).toEqual(saved.values);
    const changed = structuredClone(schema); (changed.document.fields[2] as typeof rich).fields[0] = { id: "choices", key: "choices", label: "Choices", required: true, kind: "list", item: { kind: "choice", options: [{ value: "b", label: "B" }] } };
    await expect(store.putModel(changed)).rejects.toMatchObject({ code: "validation" });
    expect(await store.readAll()).toEqual(snapshot);
    const changedItem = structuredClone(schema);
    (changedItem.document.fields[2] as typeof rich).fields[0] = { id: "choices", key: "choices", label: "Choices", required: true, kind: "list", item: { kind: "text" } };
    await expect(store.putModel(changedItem)).rejects.toMatchObject({ code: "field-in-use" });
    expect(await store.readAll()).toEqual(snapshot);
  });

  it("guards off-page incoming references and model/field dependencies, and rolls back the entire failed batch", async () => {
    const { store } = await setup();
    for (let i = 0; i < 30; i++) await store.putEntry(entry(`entry-${i}`));
    const owner = entry("entry-0"); owner.values.related = [ref("entry-29")]; await store.putEntry(owner);
    const before = await store.readAll();
    expect((await store.pageEntries("items", { limit: 25 })).entries).toHaveLength(25);
    await expect(store.deleteEntry("entry-29")).rejects.toMatchObject({ code: "reference-in-use" });
    await expect(store.transact({ expectedMutationToken: before.mutationToken, operations: [{ kind: "put-entry", record: { ...entry("entry-1"), values: { title: "Must roll back" } } }, { kind: "delete-entry", id: "entry-29" }] })).rejects.toMatchObject({ code: "reference-in-use" });
    expect(await store.readAll()).toEqual(before);
    const inverse = model(); inverse.document.presentation = { groups: [], views: [], inverses: [{ id: "backlinks", label: "Backlinks", source: { providerId, recordId: "items" }, fieldId: "related" }] };
    await store.putModel(inverse);
    await expect(store.removeField("items", "related")).rejects.toMatchObject({ code: "dependency-in-use" });
    const other = createContentModelRecord({ name: "Other", kind: "collection", fields: [{ ...related, target: { providerId, recordId: "items" } }] }, { id: "other", timestamp });
    await store.putModel(other);
    await expect(store.deleteModel("items")).rejects.toMatchObject({ code: "dependency-in-use" });
  });

  it("persists ordered inverse batches once and atomically removes explicit owning edges with their target", async () => {
    const { store } = await setup(); await store.putEntry(entry("a")); await store.putEntry(entry("b")); await store.putEntry(entry("c"));
    const before = await store.readAll();
    const after = await applyContentInverseMutation(store, [before], [
      { owner: ref("a"), fieldId: "related", targets: [ref("c"), ref("b")] },
      { owner: ref("b"), fieldId: "related", targets: [ref("c")] },
    ]);
    expect(after.mutationToken).toBe(before.mutationToken + 1);
    expect(after.entries.find((entry) => entry.id === "a")!.values.related).toEqual([ref("c"), ref("b")]);
    expect(after.entries.filter((entry) => entry.id !== "c").map((entry) => entry.generation)).toEqual([after.mutationToken, after.mutationToken]);
    const reordered = await applyContentInverseMutation(store, [after], [{ owner: ref("a"), fieldId: "related", targets: [ref("b"), ref("c")] }]);
    expect(reordered.entries.find((entry) => entry.id === "a")!.values.related).toEqual([ref("b"), ref("c")]);
    const done = await store.transact({ expectedMutationToken: reordered.mutationToken, operations: [
      ...reordered.entries.filter((entry) => entry.id !== "c").map((entry) => ({ kind: "put-entry" as const, record: { ...entry, values: { title: entry.id } } })),
      { kind: "delete-entry", id: "c" },
    ] });
    expect(done.entries.map((entry) => entry.id)).toEqual(["a", "b"]); expect(buildContentGraphIndex([done]).complete).toBe(true);
  });

  it("detects missed/delayed notifications and stale tokens across independent provider connections", async () => {
    const { factory, store } = await setup();
    const other = createIndexedDbContentProvider({ idbFactory: factory }); await other.initialization.initialize();
    const captured = await store.readAll();
    await other.store.putEntry(entry("new")); // No notification mechanism is involved.
    const observed = await store.readAll(); expect(observed.mutationToken).toBeGreaterThan(captured.mutationToken); expect(observed.entries).toHaveLength(1);
    await expect(store.transact({ expectedMutationToken: captured.mutationToken, operations: [{ kind: "delete-model", id: "items" }] })).rejects.toMatchObject({ code: "conflict" });
    expect(await store.readAll()).toEqual(observed);
    await other.store.putModel({ ...model(), document: { ...model().document, description: "Edited schema" } });
    expect((await store.readAll()).mutationToken).toBeGreaterThan(observed.mutationToken);
  });

  it("rejects foreign coordination before issuing any puts and preserves the snapshot", async () => {
    const { store } = await setup(); const before = await store.readAll();
    const foreign: ContentModelRecord = { ...model(), document: { ...model().document, fields: [{ ...related, target: { providerId: "foreign", recordId: "items" } }] } };
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await expect(store.transact({ expectedMutationToken: before.mutationToken, operations: [{ kind: "put-entry", record: entry("a") }, { kind: "put-model", record: foreign }] })).rejects.toMatchObject({ code: "unsupported-transaction" });
    expect(put).not.toHaveBeenCalled(); expect(await store.readAll()).toEqual(before);
  });

  it("requires activation reconciliation to publish and preserves newer generations and published intent", async () => {
    const { store } = await setup(); const draft = entry("a");
    await expect(store.putEntry({ ...draft, lifecycle: "published" })).rejects.toMatchObject({ code: "validation" });
    await store.putEntry(draft); const reviewed = (await store.readAll()).entries[0]!;
    const reconciliation = { ref: ref("a"), expectedGeneration: reviewed.generation, expectedDigest: contentEntryDigest(reviewed), lifecycle: "published" as const };
    await store.putEntry({ ...reviewed, values: { title: "Later B" } });
    await store.reconcilePublication([reconciliation]);
    let latest = (await store.readAll()).entries[0]!;
    expect(latest).toMatchObject({ lifecycle: "draft", values: { title: "Later B" } });
    await store.reconcilePublication([{ ...reconciliation, expectedGeneration: latest.generation, expectedDigest: "wrong" }]);
    expect((await store.readAll()).entries[0]!.lifecycle).toBe("draft");
    await store.reconcilePublication([{ ...reconciliation, expectedGeneration: latest.generation, expectedDigest: contentEntryDigest(latest) }]);
    latest = (await store.readAll()).entries[0]!; expect(latest.lifecycle).toBe("published");
    await store.putEntry({ ...draft, values: { title: "Pending published edit" } });
    expect((await store.readAll()).entries[0]!).toMatchObject({ lifecycle: "published", values: { title: "Pending published edit" } });
    const current = await store.readAll();
    await store.transact({ expectedMutationToken: current.mutationToken, operations: [{ kind: "unpublish-entry", id: "a" }] });
    expect((await store.readAll()).entries[0]!.lifecycle).toBe("draft");
  });

  it("rejects immutable identity changes and singleton conflicts across batch operations", async () => {
    const { store } = await setup(); await store.putEntry(entry("a"));
    const single = createContentModelRecord({ name: "Single", kind: "single" }, { id: "single", timestamp }); await store.putModel(single);
    const before = await store.readAll();
    await expect(store.transact({ expectedMutationToken: before.mutationToken, operations: [{ kind: "put-entry", record: { ...entry("a"), modelId: "single", values: {} } }] })).rejects.toMatchObject({ code: "validation" });
    await expect(store.transact({ expectedMutationToken: before.mutationToken, operations: ["one", "two"].map((id) => ({ kind: "put-entry", record: createContentEntryRecord("single", {}, { id, timestamp }) })) })).rejects.toMatchObject({ code: "single-cardinality" });
    expect(await store.readAll()).toEqual(before);
    const changed = model(); changed.document.fields[0] = { ...title, kind: "markdown" };
    await expect(store.transact({ expectedMutationToken: before.mutationToken, operations: [{ kind: "put-model", record: changed }] })).rejects.toMatchObject({ code: "field-in-use" });
    expect(await store.readAll()).toEqual(before);
  });

  it("reads either side of an atomic batch and rejects malformed operations before writes", async () => {
    const { store } = await setup(), before = await store.readAll();
    const pending = store.transact({ expectedMutationToken: before.mutationToken, operations: ["a", "b"].map((id) => ({ kind: "put-entry", record: entry(id) })) });
    const concurrent = await store.readAll(), after = await pending;
    expect([JSON.stringify(before), JSON.stringify(after)]).toContain(JSON.stringify(concurrent));
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await expect(store.transact({ expectedMutationToken: after.mutationToken, operations: [{ kind: "unknown" }] } as never)).rejects.toMatchObject({ code: "validation" });
    await expect(store.reconcilePublication([
      { ref: ref("a"), expectedGeneration: after.entries[0]!.generation, expectedDigest: contentEntryDigest(after.entries[0]!), lifecycle: "published" },
      { ref: { ...ref("b"), providerId: "foreign" }, expectedGeneration: 0, expectedDigest: "", lifecycle: "published" },
    ])).rejects.toMatchObject({ code: "unsupported-transaction" });
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects impossible saved dates and quarantines raw/imported invalid dates without rewriting them", async () => {
    const { store, provider, factory } = await setup(), schema = model();
    schema.document.fields.push({ id: "date", key: "date", label: "Date", required: false, kind: "date" }); await store.putModel(schema);
    await store.putEntry(entry("a")); const before = await store.readAll();
    const invalid = { ...before.entries[0]!, values: { title: "a", date: "2026-02-30" } };
    await expect(store.putEntry(invalid)).rejects.toMatchObject({ code: "validation" });
    expect(await store.readAll()).toEqual(before);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open("zudo-composer-content"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction("entries", "readwrite"); tx.objectStore("entries").put(invalid);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
    expect(await provider.initialization.retry()).toMatchObject({ status: "recovery-required", recovery: { reason: "invalid", sourcePreserved: true, affectedRecordIds: ["a"] } });
    expect(await store.getEntry("a")).toMatchObject({ status: "invalid", raw: invalid });
  });
});
