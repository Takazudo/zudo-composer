import { describe, expect, it } from "vitest";
import {
  COMPOSITION_PROVIDERS,
  createCompositionReuseLifecycleService,
  createComponentCatalog,
  createSequentialIdFactory,
  summarizeComposition,
  type ComponentDefinition,
  type CompositionDeleteOutcome,
  type CompositionLifecycleStore,
  type CompositionLoadOutcome,
  type CompositionNode,
  type CompositionRecord,
  type CompositionUnpublishOutcome,
  type ReuseLifecycleProvider,
} from "../../index";

const T1 = "2026-07-14T00:00:00.000Z";
const T2 = "2026-07-14T01:00:00.000Z";

const manifest = createComponentCatalog([
  {
    id: "shell",
    schemaVersion: 1,
    title: "shell",
    category: "Fixture",
    description: "shell",
    source: { module: "test", exportKind: "named", exportName: "Shell" },
    defaults: {},
    fields: [],
    slots: [{ id: "body", prop: "body", label: "Body", accepts: ["leaf"], cardinality: "many" }],
  },
  {
    id: "leaf",
    schemaVersion: 1,
    title: "leaf",
    category: "Fixture",
    description: "leaf",
    source: { module: "test", exportKind: "named", exportName: "Leaf" },
    defaults: {},
    fields: [],
    slots: [],
  },
] satisfies ComponentDefinition[]);

function node(id: string, componentId = "leaf", slots: Record<string, CompositionNode[]> = {}): CompositionNode {
  return { id, componentId, componentVersion: 1, props: {}, slots };
}

function record(id: string, document: Partial<CompositionRecord["document"]> = {}): CompositionRecord {
  return {
    id,
    createdAt: T1,
    updatedAt: T1,
    document: { schemaVersion: 2, id, name: id, root: [], ...document },
  };
}

function source(): CompositionRecord {
  return record("source", {
    root: [node("shell", "shell", { body: [] })],
    publication: {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "shell", slotId: "body" } },
    },
  });
}

function consumer(sourceRecordId = "source"): CompositionRecord {
  return record("consumer", {
    root: [node("local")],
    binding: { sourceRecordId, outletId: "outlet-main" },
  });
}

function lifecycleProvider(
  initial: readonly CompositionRecord[],
  options: { failSave?: boolean } = {},
): { provider: ReuseLifecycleProvider; records: Map<string, CompositionRecord> } {
  const records = new Map(initial.map((value) => [value.id, structuredClone(value)]));
  const load = (id: string): CompositionLoadOutcome => {
    const value = records.get(id);
    return value ? { status: "loaded", record: structuredClone(value) } : { status: "not-found", id };
  };
  const dependents = (sourceRecordId: string) =>
    [...records.values()]
      .filter((value) => value.id !== sourceRecordId && value.document.binding?.sourceRecordId === sourceRecordId)
      .map((value) => ({ summary: summarizeComposition(value), binding: structuredClone(value.document.binding!) }));
  const store: CompositionLifecycleStore = {
    provider: COMPOSITION_PROVIDERS.indexeddb,
    list: async () => [...records.values()].map(summarizeComposition),
    get: async (id) => load(id),
    put: async (value) => void records.set(value.id, structuredClone(value)),
    delete: async (id) => records.delete(id),
    clear: async () => void records.clear(),
    deleteWithDependencyCheck: async (id): Promise<CompositionDeleteOutcome> => {
      const current = records.get(id);
      if (!current) return { status: "not-found" };
      const currentDependents = current.document.publication?.kind === "global-template" ? dependents(id) : [];
      if (currentDependents.length > 0) return { status: "blocked", dependents: currentDependents };
      records.delete(id);
      return { status: "deleted" };
    },
    unpublishWithDependencyCheck: async (id): Promise<CompositionUnpublishOutcome> => {
      const current = records.get(id);
      if (!current) return { status: "not-found" };
      if (!current.document.publication) return { status: "not-published" };
      const currentDependents = current.document.publication.kind === "global-template" ? dependents(id) : [];
      if (currentDependents.length > 0) return { status: "blocked", dependents: currentDependents };
      const document = { ...current.document };
      delete document.publication;
      records.set(id, { ...current, document });
      return { status: "unpublished" };
    },
    saveLifecycleRecord: async (value) => {
      if (options.failSave) throw new Error("injected lifecycle save failure");
      records.set(value.id, structuredClone(value));
    },
  };
  return { provider: { descriptor: COMPOSITION_PROVIDERS.indexeddb, store }, records };
}

describe("provider-safe reuse lifecycle service", () => {
  it("detaches one currently resolved consumer as a fresh standalone snapshot", async () => {
    const fake = lifecycleProvider([source(), consumer()]);
    const service = createCompositionReuseLifecycleService(fake.provider, {
      manifest,
      nodeIdFactory: createSequentialIdFactory(),
      now: () => T2,
    });

    await expect(service.detachAsSnapshot({ providerId: "indexeddb", recordId: "consumer" })).resolves.toMatchObject({
      status: "detached",
      kind: "snapshot",
      record: { updatedAt: T2, document: { id: "consumer", root: [{ componentId: "shell" }] } },
    });
    const saved = fake.records.get("consumer")!;
    expect(saved.document).not.toHaveProperty("binding");
    expect(saved.document.root[0]!.id).not.toBe("shell");
    expect(saved.document.root[0]!.slots.body[0]!.id).not.toBe("local");
  });

  it("does not alter a bound consumer when its one-record snapshot save fails", async () => {
    const original = consumer();
    const fake = lifecycleProvider([source(), original], { failSave: true });
    const service = createCompositionReuseLifecycleService(fake.provider, {
      manifest,
      nodeIdFactory: createSequentialIdFactory(),
      now: () => T2,
    });

    await expect(service.detachAsSnapshot({ providerId: "indexeddb", recordId: "consumer" })).resolves.toEqual({
      status: "save-failed",
      message: "injected lifecycle save failure",
    });
    expect(fake.records.get("consumer")).toEqual(original);
  });

  it("removes an unresolved binding without presenting it as a source snapshot", async () => {
    const original = consumer("missing-source");
    const fake = lifecycleProvider([original]);
    const service = createCompositionReuseLifecycleService(fake.provider, {
      manifest,
      nodeIdFactory: createSequentialIdFactory(),
      now: () => T2,
    });

    await expect(service.removeBrokenBinding({ providerId: "indexeddb", recordId: "consumer" })).resolves.toMatchObject({
      status: "detached",
      kind: "removed-broken-binding",
      record: { document: { root: [{ id: "local" }] } },
    });
    const saved = fake.records.get("consumer")!;
    expect(saved.document).not.toHaveProperty("binding");
    expect(saved.document.root).toEqual(original.document.root);
  });
});
