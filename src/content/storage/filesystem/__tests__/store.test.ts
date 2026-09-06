// The filesystem analogue of `storage/indexeddb/__tests__/rich-transactions.test.ts`.
// Every assertion about transaction semantics is ported from that spec rather
// than reinvented, so the two providers are held to one behavioural contract;
// the tests that follow them cover what only a filesystem store can get wrong.

import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTENT_PROVIDERS,
  applyContentInverseMutation,
  buildContentGraphIndex,
  contentEntryDigest,
  createContentEntryRecord,
  createContentModelRecord,
} from "../../../library";
import type { ContentFieldDefinition, ContentModelRecord } from "../../../model";
import { createTransactionalRecordStore } from "../../../../shared/node-fs";
import { createFilesystemContentStore, type FilesystemContentStore } from "../store";
import { CONTENT_FILESYSTEM_LAYOUT, CONTENT_META_RECORD_ID, MAX_CONTENT_ID_LENGTH } from "../types";

const timestamp = "2026-01-01T00:00:00.000Z";
const providerId = CONTENT_PROVIDERS.filesystem.id;
const ref = (recordId: string) => ({ providerId, modelId: "items", recordId });
const title: ContentFieldDefinition = { id: "title", key: "title", label: "Title", required: true, kind: "text" };
const related: ContentFieldDefinition = { id: "related", key: "related", label: "Related", required: false, kind: "reference-list", target: { providerId, recordId: "items" }, ordered: true };
const model = () => createContentModelRecord({ name: "Items", kind: "collection", fields: [title, related] }, { id: "items", timestamp });
const entry = (id: string) => createContentEntryRecord("items", { title: id }, { id, timestamp });

const sandboxes: string[] = [];

async function sandbox(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "zudo-content-fs-")));
  sandboxes.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function setup(): Promise<{ root: string; store: FilesystemContentStore }> {
  const root = await sandbox();
  const store = await createFilesystemContentStore({ contentRoot: root });
  await store.putModel(model());
  return { root, store };
}

async function pointer(root: string): Promise<{ generation: number }> {
  return JSON.parse(await fs.readFile(join(root, "current.json"), "utf8")) as { generation: number };
}

async function liveRecordFiles(root: string): Promise<string[]> {
  return (await fs.readdir(join(root, "generations", String((await pointer(root)).generation)))).sort();
}

describe("Rich Content transactions on the filesystem", () => {
  it("aborts a disconnected reconciliation transaction without installing its fence", async () => {
    const { root, store } = await setup();
    const before = await store.readAll();
    const generation = (await pointer(root)).generation;
    const cancellation = new AbortController();
    cancellation.abort();

    await expect(store.reconcilePublication([], 5, cancellation.signal)).rejects.toBeDefined();
    expect(await store.readAll()).toEqual(before);
    expect((await pointer(root)).generation).toBe(generation);
    expect((await store.reconcilePublication([], 5)).activationGeneration).toBe(5);
  });

  it("fences late activation A after empty B and makes equal/older generations write-free", async () => {
    const { root, store } = await setup();
    await store.putEntry(entry("a"));
    const before = await store.readAll();
    const reviewed = before.entries[0]!;
    const a = [{ ref: ref("a"), expectedGeneration: reviewed.generation, expectedDigest: contentEntryDigest(reviewed), lifecycle: "published" as const }];

    const b = await store.reconcilePublication([], 2);
    expect(b.activationGeneration).toBe(2);
    expect(b.mutationToken).toBe(before.mutationToken + 1);
    const settled = (await pointer(root)).generation;

    const late = await store.reconcilePublication(a, 1);
    const equal = await store.reconcilePublication(a, 2);
    expect(late.entries[0]!.lifecycle).toBe("draft");
    expect(equal.entries[0]!.lifecycle).toBe("draft");
    expect(late.mutationToken).toBe(b.mutationToken);
    expect(equal.mutationToken).toBe(b.mutationToken);
    // A fenced activation is write-free, not merely idempotent: no generation
    // was staged at all.
    expect((await pointer(root)).generation).toBe(settled);
  });

  it("round trips nested object/list/choice/media values and rejects schema edits invalidating existing data", async () => {
    const { store } = await setup();
    const rich: ContentFieldDefinition = { id: "details", key: "details", label: "Details", required: true, kind: "object", fields: [
      { id: "choices", key: "choices", label: "Choices", required: true, kind: "list", item: { kind: "choice", options: [{ value: "a", label: "A" }] } },
      { id: "image", key: "image", label: "Image", required: false, kind: "media-use", use: "image" },
    ] };
    const schema = model();
    schema.document.fields.push(rich);
    await store.putModel(schema);

    const saved = entry("a");
    saved.values.details = { choices: ["a", "a"], image: { kind: "image", asset: { providerId: "media-files", assetId: "asset" }, alt: "A", decorative: false, caption: "B" } };
    await store.putEntry(saved);

    const snapshot = await store.readAll();
    expect(snapshot.entries[0]!.values).toEqual(saved.values);

    const changed = structuredClone(schema);
    (changed.document.fields[2] as typeof rich).fields[0] = { id: "choices", key: "choices", label: "Choices", required: true, kind: "list", item: { kind: "choice", options: [{ value: "b", label: "B" }] } };
    await expect(store.putModel(changed)).rejects.toMatchObject({ code: "validation" });
    expect(await store.readAll()).toEqual(snapshot);

    const changedItem = structuredClone(schema);
    (changedItem.document.fields[2] as typeof rich).fields[0] = { id: "choices", key: "choices", label: "Choices", required: true, kind: "list", item: { kind: "text" } };
    await expect(store.putModel(changedItem)).rejects.toMatchObject({ code: "field-in-use" });
    expect(await store.readAll()).toEqual(snapshot);
  });

  it("guards off-page incoming references and model/field dependencies, and rolls back the entire failed batch", async () => {
    const { root, store } = await setup();
    // One commit rather than thirty: every mutation is a full fsynced
    // generation, and the assertions below are about the graph, not the writes.
    await store.seed({ models: [model()], entries: Array.from({ length: 30 }, (_, index) => entry(`entry-${index}`)) });
    const owner = entry("entry-0");
    owner.values.related = [ref("entry-29")];
    await store.putEntry(owner);
    const before = await store.readAll();
    const files = await liveRecordFiles(root);

    expect((await store.pageEntries("items", { limit: 25 })).entries).toHaveLength(25);
    await expect(store.deleteEntry("entry-29")).rejects.toMatchObject({ code: "reference-in-use" });
    await expect(store.transact({
      expectedMutationToken: before.mutationToken,
      operations: [
        { kind: "put-entry", record: { ...entry("entry-1"), values: { title: "Must roll back" } } },
        { kind: "delete-entry", id: "entry-29" },
      ],
    })).rejects.toMatchObject({ code: "reference-in-use" });
    expect(await store.readAll()).toEqual(before);
    // A failed transaction leaves the live generation byte-identical: no
    // half-written record, and no orphan file the next read could pick up.
    expect(await liveRecordFiles(root)).toEqual(files);

    const inverse = model();
    inverse.document.presentation = { groups: [], views: [], inverses: [{ id: "backlinks", label: "Backlinks", source: { providerId, recordId: "items" }, fieldId: "related" }] };
    await store.putModel(inverse);
    await expect(store.removeField("items", "related")).rejects.toMatchObject({ code: "dependency-in-use" });

    const other = createContentModelRecord({ name: "Other", kind: "collection", fields: [{ ...related, target: { providerId, recordId: "items" } }] }, { id: "other", timestamp });
    await store.putModel(other);
    await expect(store.deleteModel("items")).rejects.toMatchObject({ code: "dependency-in-use" });
  });

  it("persists ordered inverse batches once and atomically removes explicit owning edges with their target", async () => {
    const { store } = await setup();
    for (const id of ["a", "b", "c"]) await store.putEntry(entry(id));
    const before = await store.readAll();

    const after = await applyContentInverseMutation(store, [before], [
      { owner: ref("a"), fieldId: "related", targets: [ref("c"), ref("b")] },
      { owner: ref("b"), fieldId: "related", targets: [ref("c")] },
    ]);
    expect(after.mutationToken).toBe(before.mutationToken + 1);
    expect(after.entries.find((item) => item.id === "a")!.values.related).toEqual([ref("c"), ref("b")]);
    expect(after.entries.filter((item) => item.id !== "c").map((item) => item.generation)).toEqual([after.mutationToken, after.mutationToken]);

    const reordered = await applyContentInverseMutation(store, [after], [{ owner: ref("a"), fieldId: "related", targets: [ref("b"), ref("c")] }]);
    expect(reordered.entries.find((item) => item.id === "a")!.values.related).toEqual([ref("b"), ref("c")]);

    const done = await store.transact({
      expectedMutationToken: reordered.mutationToken,
      operations: [
        ...reordered.entries.filter((item) => item.id !== "c").map((item) => ({ kind: "put-entry" as const, record: { ...item, values: { title: item.id } } })),
        { kind: "delete-entry", id: "c" },
      ],
    });
    expect(done.entries.map((item) => item.id)).toEqual(["a", "b"]);
    expect(buildContentGraphIndex([done]).complete).toBe(true);
  });

  it("detects delayed observation and stale tokens across independent store handles", async () => {
    const { root, store } = await setup();
    const other = await createFilesystemContentStore({ contentRoot: root });
    const captured = await store.readAll();

    await other.putEntry(entry("new"));
    const observed = await store.readAll();
    expect(observed.mutationToken).toBeGreaterThan(captured.mutationToken);
    expect(observed.entries).toHaveLength(1);

    await expect(store.transact({ expectedMutationToken: captured.mutationToken, operations: [{ kind: "delete-model", id: "items" }] }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(await store.readAll()).toEqual(observed);

    await other.putModel({ ...model(), document: { ...model().document, description: "Edited schema" } });
    expect((await store.readAll()).mutationToken).toBeGreaterThan(observed.mutationToken);
  });

  it("rejects foreign coordination before staging anything and preserves the snapshot", async () => {
    const { root, store } = await setup();
    const before = await store.readAll();
    const generation = (await pointer(root)).generation;
    const foreign: ContentModelRecord = { ...model(), document: { ...model().document, fields: [{ ...related, target: { providerId: "foreign", recordId: "items" } }] } };

    await expect(store.transact({
      expectedMutationToken: before.mutationToken,
      operations: [{ kind: "put-entry", record: entry("a") }, { kind: "put-model", record: foreign }],
    })).rejects.toMatchObject({ code: "unsupported-transaction" });
    expect((await pointer(root)).generation).toBe(generation);
    expect(await store.readAll()).toEqual(before);
  });

  it("requires activation reconciliation to publish and preserves newer generations and published intent", async () => {
    const { store } = await setup();
    const draft = entry("a");
    await expect(store.putEntry({ ...draft, lifecycle: "published" })).rejects.toMatchObject({ code: "validation" });

    await store.putEntry(draft);
    const reviewed = (await store.readAll()).entries[0]!;
    const reconciliation = { ref: ref("a"), expectedGeneration: reviewed.generation, expectedDigest: contentEntryDigest(reviewed), lifecycle: "published" as const };

    await store.putEntry({ ...reviewed, values: { title: "Later B" } });
    await store.reconcilePublication([reconciliation], 1);
    let latest = (await store.readAll()).entries[0]!;
    expect(latest).toMatchObject({ lifecycle: "draft", values: { title: "Later B" } });

    await store.reconcilePublication([{ ...reconciliation, expectedGeneration: latest.generation, expectedDigest: "wrong" }], 2);
    expect((await store.readAll()).entries[0]!.lifecycle).toBe("draft");

    await store.reconcilePublication([{ ...reconciliation, expectedGeneration: latest.generation, expectedDigest: contentEntryDigest(latest) }], 3);
    latest = (await store.readAll()).entries[0]!;
    expect(latest.lifecycle).toBe("published");

    await store.putEntry({ ...draft, values: { title: "Pending published edit" } });
    expect((await store.readAll()).entries[0]!).toMatchObject({ lifecycle: "published", values: { title: "Pending published edit" } });

    const current = await store.readAll();
    await store.transact({ expectedMutationToken: current.mutationToken, operations: [{ kind: "unpublish-entry", id: "a" }] });
    expect((await store.readAll()).entries[0]!.lifecycle).toBe("draft");
  });

  it("rejects immutable identity changes and singleton conflicts across batch operations", async () => {
    const { store } = await setup();
    await store.putEntry(entry("a"));
    await store.putModel(createContentModelRecord({ name: "Single", kind: "single" }, { id: "single", timestamp }));
    const before = await store.readAll();

    await expect(store.transact({ expectedMutationToken: before.mutationToken, operations: [{ kind: "put-entry", record: { ...entry("a"), modelId: "single", values: {} } }] }))
      .rejects.toMatchObject({ code: "validation" });
    await expect(store.transact({ expectedMutationToken: before.mutationToken, operations: ["one", "two"].map((id) => ({ kind: "put-entry" as const, record: createContentEntryRecord("single", {}, { id, timestamp }) })) }))
      .rejects.toMatchObject({ code: "single-cardinality" });
    expect(await store.readAll()).toEqual(before);

    const changed = model();
    changed.document.fields[0] = { ...title, kind: "markdown" };
    await expect(store.transact({ expectedMutationToken: before.mutationToken, operations: [{ kind: "put-model", record: changed }] }))
      .rejects.toMatchObject({ code: "field-in-use" });
    expect(await store.readAll()).toEqual(before);
  });

  it("serializes a concurrent read against an atomic batch and rejects malformed operations before writes", async () => {
    const { root, store } = await setup();
    const before = await store.readAll();

    const pending = store.transact({ expectedMutationToken: before.mutationToken, operations: ["a", "b"].map((id) => ({ kind: "put-entry" as const, record: entry(id) })) });
    const concurrent = await store.readAll();
    const after = await pending;
    expect([JSON.stringify(before), JSON.stringify(after)]).toContain(JSON.stringify(concurrent));

    const generation = (await pointer(root)).generation;
    await expect(store.transact({ expectedMutationToken: after.mutationToken, operations: [{ kind: "unknown" }] } as never))
      .rejects.toMatchObject({ code: "validation" });
    await expect(store.reconcilePublication([
      { ref: ref("a"), expectedGeneration: after.entries[0]!.generation, expectedDigest: contentEntryDigest(after.entries[0]!), lifecycle: "published" },
      { ref: { ...ref("b"), providerId: "foreign" }, expectedGeneration: 0, expectedDigest: "", lifecycle: "published" },
    ], 1)).rejects.toMatchObject({ code: "unsupported-transaction" });
    expect((await pointer(root)).generation).toBe(generation);
  });

  it("rejects impossible saved dates and quarantines an imported invalid record without rewriting it", async () => {
    const { root, store } = await setup();
    const schema = model();
    schema.document.fields.push({ id: "date", key: "date", label: "Date", required: false, kind: "date" });
    await store.putModel(schema);
    await store.putEntry(entry("a"));
    const before = await store.readAll();

    const invalid = { ...before.entries[0]!, values: { title: "a", date: "2026-02-30" } };
    await expect(store.putEntry(invalid)).rejects.toMatchObject({ code: "validation" });
    expect(await store.readAll()).toEqual(before);

    // A foreign writer that respects the pointer protocol but not the Content
    // schema. Editing the record file alone would break its digest, which is a
    // different (and already covered) failure.
    await importRecord(root, "entry-a", invalid);

    expect(await store.initialize()).toMatchObject({
      status: "recovery-required",
      recovery: { reason: "invalid", sourcePreserved: true, affectedRecordIds: ["a"] },
    });
    expect(await store.getEntry("a")).toMatchObject({ status: "invalid", raw: invalid });
  });
});

describe("Content filesystem layout and paging", () => {
  it("refuses a store whose layout marker does not match, and re-shapes nothing", async () => {
    const { root, store } = await setup();
    const before = await store.readAll();
    await importRecord(root, CONTENT_META_RECORD_ID, {
      layout: { ...CONTENT_FILESYSTEM_LAYOUT, layoutVersion: 2 },
      mutationToken: before.mutationToken,
      activationGeneration: 0,
    });

    await expect(createFilesystemContentStore({ contentRoot: root })).rejects.toMatchObject({ code: "unsupported-version" });
    await expect(store.readAll()).rejects.toMatchObject({ code: "unsupported-version" });
    expect(await liveRecordFiles(root)).toEqual(["meta.json", "model-items.json"]);
  });

  it("refuses a record that is not part of the declared layout", async () => {
    const { root } = await setup();
    await importRecord(root, "stray", { id: "stray" });
    await expect(createFilesystemContentStore({ contentRoot: root })).rejects.toMatchObject({ code: "unsupported-version" });
  });

  it("pages a shared createdAt in one stable total order across page boundaries", async () => {
    const { store } = await setup();
    const ids = ["e1", "e2", "e3", "e4", "e5"];
    for (const id of ids) await store.putEntry(createContentEntryRecord("items", { title: id }, { id, timestamp }));

    const walked: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.pageEntries("items", { limit: 2, ...(cursor === undefined ? {} : { cursor }) });
      walked.push(...page.entries.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    // Descending on (createdAt, id): every entry appears exactly once, in the
    // order a single unpaged scan would produce.
    expect(walked).toEqual([...ids].reverse());
    expect((await store.scanEntries("items")).entries.map((item) => item.id)).toEqual(walked);
  });

  it("rejects an id too long to prefix into a path-safe record name", async () => {
    const { root, store } = await setup();
    const generation = (await pointer(root)).generation;
    const longest = "e".repeat(MAX_CONTENT_ID_LENGTH);

    await store.putEntry(createContentEntryRecord("items", { title: "ok" }, { id: longest, timestamp }));
    expect(await liveRecordFiles(root)).toContain(`entry-${longest}.json`);

    await expect(store.putEntry(createContentEntryRecord("items", { title: "too long" }, { id: `${longest}e`, timestamp })))
      .rejects.toMatchObject({ operation: "put-entry", code: "validation" });
    expect((await pointer(root)).generation).toBe(generation + 1);
  });

  it("rejects a stale mutation token and leaves the store untouched", async () => {
    const { root, store } = await setup();
    const stale = await store.readAll();
    await store.putEntry(entry("a"));
    const current = await store.readAll();
    const generation = (await pointer(root)).generation;

    await expect(store.transact({ expectedMutationToken: stale.mutationToken, operations: [{ kind: "delete-entry", id: "a" }] }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(await store.readAll()).toEqual(current);
    expect((await pointer(root)).generation).toBe(generation);
  });
});

/** Commit one record through the record store, bypassing every Content rule. */
async function importRecord(root: string, id: string, value: unknown): Promise<void> {
  const records = await createTransactionalRecordStore<"initialize" | "read-all" | "transact">({
    root,
    schemaVersion: 1,
    errors: {
      isError: (candidate: unknown) => candidate instanceof Error,
      create: (_operation, code, message) => Object.assign(new Error(message), { code }),
      rethrow: (_operation, code, message, cause): never => { throw Object.assign(new Error(message), { code, cause }); },
    },
    rootLabel: "Content records root",
    ownerLabel: "Content",
    recordLabel: "content record",
    phases: { initialize: "initialize", snapshot: "read-all", commit: "transact" },
  });
  await records.commit((before) => ({
    records: [
      ...before.records.filter((record) => record.id !== id),
      { id, json: `${JSON.stringify(value, null, 2)}\n` },
    ],
    result: null,
  }));
}
