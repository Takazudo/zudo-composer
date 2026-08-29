import { describe, expect, it } from "vitest";
import {
  COMPOSITION_PROVIDERS,
  COMPOSITION_SCHEMA_VERSION,
  CompositionPersistenceError,
  compareCompositionSummariesNewestFirst,
  compositionRecordRefKey,
  countCompositionNodes,
  createCompositionRecord,
  createSequentialIdFactory,
  duplicateCompositionRecord,
  isSafeCompositionRecordId,
  isValidCompositionTimestamp,
  loadCompositionRecord,
  resetCompositionRecord,
  summarizeComposition,
  validateCompositionRecord,
} from "../../index";
import { createFixtureDocument } from "../../__tests__/fixtures";
import type {
  CompositionInitializationOutcome,
  CompositionProviderInitializer,
  CompositionRecord,
  CompositionStore,
  CompositionSummary,
} from "../../index";

const T1 = "2026-01-02T03:04:05.000Z";
const T2 = "2026-01-02T04:04:05.000Z";

function record(id = "composition-a", timestamp = T1): CompositionRecord {
  const document = createFixtureDocument();
  document.id = id;
  return { id, createdAt: timestamp, updatedAt: timestamp, document };
}

describe("composition record validation and loading", () => {
  it("accepts a valid canonical record", () => {
    const value = record();
    const result = validateCompositionRecord(value);
    expect(result).toEqual({ ok: true, record: value });
    expect(loadCompositionRecord(value)).toEqual({ status: "loaded", record: value });
  });

  it.each([
    ["../escape"],
    ["with/slash"],
    ["encoded%2fslash"],
    ["CAPS"],
    [".hidden"],
    ["trailing-"],
    ["with space"],
    ["a".repeat(129)],
  ])("rejects unsafe id %s", (id) => {
    const value = record(id);
    expect(isSafeCompositionRecordId(id)).toBe(false);
    const result = validateCompositionRecord(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe("unsafe-id");
  });

  it("rejects a record/document identity mismatch", () => {
    const value = record();
    value.document.id = "composition-b";
    const result = validateCompositionRecord(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe("record-document-id-mismatch");
  });

  it("requires canonical valid ISO timestamps in chronological order", () => {
    expect(isValidCompositionTimestamp(T1)).toBe(true);
    expect(isValidCompositionTimestamp("2026-02-30T00:00:00.000Z")).toBe(false);
    expect(isValidCompositionTimestamp("not-a-date")).toBe(false);

    const badCreated = { ...record(), createdAt: "not-a-date" };
    const badUpdated = { ...record(), updatedAt: "2026-01-02T03:04:05Z" };
    const reversed = { ...record(), createdAt: T2, updatedAt: T1 };
    expect(validateCompositionRecord(badCreated)).toMatchObject({
      ok: false,
      issue: { code: "invalid-created-at" },
    });
    expect(validateCompositionRecord(badUpdated)).toMatchObject({
      ok: false,
      issue: { code: "invalid-updated-at" },
    });
    expect(validateCompositionRecord(reversed)).toMatchObject({
      ok: false,
      issue: { code: "invalid-timestamp-order" },
    });
  });

  it("rejects non-JSON-safe data before persistence", () => {
    const value = { ...record(), extension: undefined };
    expect(validateCompositionRecord(value)).toMatchObject({
      ok: false,
      issue: { code: "not-json-safe" },
    });
  });

  it("rejects JSON-safe extension fields instead of dropping them", () => {
    const value = { ...record(), extension: "unknown" };
    expect(validateCompositionRecord(value)).toMatchObject({
      ok: false,
      issue: { code: "invalid-record" },
    });
  });

  it("reports malformed structured documents without inventing recovery data", () => {
    const malformed = {
      ...record(),
      document: { schemaVersion: COMPOSITION_SCHEMA_VERSION, id: "composition-a", root: {} },
    };
    const outcome = loadCompositionRecord(malformed);
    expect(outcome).toMatchObject({
      status: "invalid",
      issue: { code: "malformed-document" },
      raw: malformed,
    });
  });

  it("distinguishes and preserves future-schema provider data", () => {
    const future = {
      ...record(),
      document: {
        schemaVersion: COMPOSITION_SCHEMA_VERSION + 1,
        id: "composition-a",
        name: "Future",
        root: [],
        futureData: { keep: true },
      },
    };
    expect(loadCompositionRecord(future)).toEqual({
      status: "future-schema",
      foundSchemaVersion: COMPOSITION_SCHEMA_VERSION + 1,
      raw: future,
    });
  });

  it("rejects an older schema without rewriting provider data", () => {
    const older = record();
    (older.document as { schemaVersion: number }).schemaVersion = COMPOSITION_SCHEMA_VERSION - 1;
    expect(loadCompositionRecord(older)).toMatchObject({
      status: "invalid",
      issue: { code: "malformed-document" },
      raw: older,
    });
  });
});

describe("composition record helpers", () => {
  it("creates an independent record with matching record/document identity", () => {
    const template = createFixtureDocument();
    const created = createCompositionRecord(template, {
      idFactory: createSequentialIdFactory("record"),
      now: () => T1,
    });
    expect(created).toMatchObject({
      id: "composition-1",
      createdAt: T1,
      updatedAt: T1,
      document: { id: "composition-1" },
    });
    created.document.name = "Changed";
    expect(template.name).not.toBe("Changed");
  });

  it("duplicates with fresh record, document, node identities and timestamps", () => {
    const source = record();
    const originalNodeIds = new Set<string>();
    const collect = (nodes: CompositionRecord["document"]["root"]): void => {
      for (const node of nodes) {
        originalNodeIds.add(node.id);
        for (const children of Object.values(node.slots)) collect(children);
      }
    };
    collect(source.document.root);

    const copy = duplicateCompositionRecord(source, {
      idFactory: createSequentialIdFactory("record"),
      nodeIdFactory: createSequentialIdFactory("node"),
      now: () => T2,
    });

    expect(copy.id).toBe("composition-1");
    expect(copy.document.id).toBe(copy.id);
    expect(copy.createdAt).toBe(T2);
    expect(copy.updatedAt).toBe(T2);
    expect(copy.document.name).toBe("Product overview copy");
    expect(countCompositionNodes(copy.document)).toBe(countCompositionNodes(source.document));

    const copyNodeIds = new Set<string>();
    const collectCopy = (nodes: CompositionRecord["document"]["root"]): void => {
      for (const node of nodes) {
        copyNodeIds.add(node.id);
        for (const children of Object.values(node.slots)) collectCopy(children);
      }
    };
    collectCopy(copy.document.root);
    expect([...copyNodeIds].every((id) => !originalNodeIds.has(id))).toBe(true);
    expect(copyNodeIds.size).toBe(originalNodeIds.size);
    expect(copy.document.root).not.toBe(source.document.root);
  });

  it("keeps a duplicate's Pattern role and consumer binding while giving every node a fresh identity", () => {
    const pattern = record();
    pattern.document.publication = { kind: "pattern" };
    const patternCopy = duplicateCompositionRecord(pattern, {
      idFactory: createSequentialIdFactory("record"),
      nodeIdFactory: createSequentialIdFactory("node"),
      now: () => T2,
    });
    expect(patternCopy.document.publication).toEqual({ kind: "pattern" });
    expect(patternCopy.document.root[0]!.id).not.toBe(pattern.document.root[0]!.id);

    const consumer = record();
    consumer.document.binding = { sourceRecordId: "source-template", outletId: "outlet-main" };
    const consumerCopy = duplicateCompositionRecord(consumer, {
      idFactory: createSequentialIdFactory("record"),
      nodeIdFactory: createSequentialIdFactory("node"),
      now: () => T2,
    });
    expect(consumerCopy.document.binding).toEqual(consumer.document.binding);
  });

  it("rewrites a duplicated Global template outlet owner to its cloned node", () => {
    const template = record();
    template.document.publication = {
      kind: "global-template",
      outlet: {
        id: "outlet-main",
        label: "Main",
        target: { parentId: "split-1", slotId: "right" },
      },
    };

    const copy = duplicateCompositionRecord(template, {
      idFactory: createSequentialIdFactory("record"),
      nodeIdFactory: createSequentialIdFactory("node"),
      now: () => T2,
    });

    expect(copy.document.publication).toMatchObject({
      kind: "global-template",
      outlet: { id: "outlet-main", target: { parentId: copy.document.root[0]!.id, slotId: "right" } },
    });
    expect(copy.document.publication).not.toBe(template.document.publication);
  });

  it("resets the body while preserving supported record identity", () => {
    const source = record("kept-id");
    source.document.name = "Edited";
    source.document.root = [];
    const reset = resetCompositionRecord(source, createFixtureDocument(), () => T2);
    expect(reset.id).toBe("kept-id");
    expect(reset.document.id).toBe("kept-id");
    expect(reset.createdAt).toBe(T1);
    expect(reset.updatedAt).toBe(T2);
    expect(reset.document.name).toBe("Product overview");
    expect(countCompositionNodes(reset.document)).toBe(6);
  });

  it("creates summaries and sorts newest first with a stable id tiebreaker", () => {
    const a = summarizeComposition(record("a", T1));
    const b = summarizeComposition(record("b", T2));
    const c = summarizeComposition(record("c", T2));
    expect([c, a, b].sort(compareCompositionSummariesNewestFirst).map((item) => item.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(a.nodeCount).toBe(6);
    expect(a.rootCount).toBe(record("a", T1).document.root.length);
  });

  it("includes reusable-source metadata without loading the whole record", () => {
    const global = record("global");
    global.document.publication = {
      kind: "global-template",
      outlet: {
        id: "outlet-main",
        label: "Main content",
        target: { parentId: "split-1", slotId: "right" },
      },
    };
    const pattern = record("pattern");
    pattern.document.publication = { kind: "pattern" };
    const emptyPattern = record("empty-pattern");
    emptyPattern.document.root = [];
    emptyPattern.document.publication = { kind: "pattern" };
    const invalid = record("invalid");
    invalid.document.publication = { kind: "pattern" };
    invalid.document.binding = { sourceRecordId: "source-template", outletId: "outlet-main" };

    expect(summarizeComposition(global)).toMatchObject({
      publicationKind: "global-template",
      outletId: "outlet-main",
      outletLabel: "Main content",
      rootCount: global.document.root.length,
      reuseStatus: "eligible",
    });
    expect(summarizeComposition(pattern)).toMatchObject({
      publicationKind: "pattern",
      rootCount: pattern.document.root.length,
      reuseStatus: "eligible",
    });
    expect(summarizeComposition(emptyPattern)).toMatchObject({
      publicationKind: "pattern",
      rootCount: 0,
      reuseStatus: "empty-pattern",
    });
    expect(summarizeComposition(invalid)).toMatchObject({
      publicationKind: "pattern",
      reuseStatus: "invalid",
    });
  });
});

describe("provider and store contract", () => {
  it("keeps the same record id distinct across isolated provider ids", () => {
    const indexed = compositionRecordRefKey({ providerId: "indexeddb", recordId: "same" });
    const files = compositionRecordRefKey({ providerId: "files", recordId: "same" });
    expect(indexed).not.toBe(files);
  });

  it("supports a provider-free fake store and typed initialization seam", async () => {
    class FakeStore implements CompositionStore {
      readonly provider = COMPOSITION_PROVIDERS.indexeddb;
      private readonly records = new Map<string, CompositionRecord>();

      async list(): Promise<readonly CompositionSummary[]> {
        return [...this.records.values()]
          .map(summarizeComposition)
          .sort(compareCompositionSummariesNewestFirst);
      }

      async get(id: string) {
        const value = this.records.get(id);
        return value
          ? ({ status: "loaded", record: value } as const)
          : ({ status: "not-found", id } as const);
      }

      async put(value: CompositionRecord) {
        const validation = validateCompositionRecord(value);
        if (!validation.ok) {
          throw new CompositionPersistenceError(
            "put",
            "validation",
            validation.issue.message,
            false,
          );
        }
        this.records.set(value.id, value);
        return { canonical: { status: "saved" as const }, derived: { status: "current" as const, records: [] } };
      }

      async delete(id: string): Promise<boolean> {
        return this.records.delete(id);
      }

      async clear(): Promise<void> {
        this.records.clear();
      }
    }

    const store = new FakeStore();
    await store.put(record());
    expect((await store.get("composition-a")).status).toBe("loaded");
    expect(await store.list()).toHaveLength(1);

    const ready: CompositionInitializationOutcome = {
      status: "ready",
      summaries: await store.list(),
    };
    const initializer: CompositionProviderInitializer = {
      initialize: async () => ready,
      retry: async () => ready,
      startFresh: async () => ready,
    };
    expect(await initializer.retry()).toBe(ready);
  });
});
