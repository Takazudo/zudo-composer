import { describe, expect, it } from "vitest";
import {
  COMPOSITION_PROVIDERS,
  CompositionPersistenceError,
  createCompositionReuseService,
  createComponentCatalog,
  resolveGlobalTemplate,
  resolveGlobalTemplateLoad,
  type ComponentDefinition,
  type CompositionRecord,
  type CompositionSummary,
  type ReuseReadProvider,
} from "../../index";

const TIMESTAMP = "2026-07-14T00:00:00.000Z";

const entries: ComponentDefinition[] = [
  {
    id: "host",
    schemaVersion: 1,
    title: "host",
    category: "Fixture",
    description: "host",
    source: { module: "test", exportKind: "named", exportName: "Host" },
    defaults: {},
    fields: [],
    slots: [
      { id: "single", prop: "single", label: "Single", accepts: ["allowed"], cardinality: "single" },
      { id: "many", prop: "many", label: "Many", cardinality: "many" },
    ],
  },
  {
    id: "allowed",
    schemaVersion: 1,
    title: "allowed",
    category: "Fixture",
    description: "allowed",
    source: { module: "test", exportKind: "named", exportName: "Allowed" },
    defaults: {},
    fields: [],
    slots: [],
  },
  {
    id: "other",
    schemaVersion: 1,
    title: "other",
    category: "Fixture",
    description: "other",
    source: { module: "test", exportKind: "named", exportName: "Other" },
    defaults: {},
    fields: [],
    slots: [],
  },
];
const manifest = createComponentCatalog(entries);

function node(id: string, componentId = "allowed") {
  return { id, componentId, componentVersion: 1, props: {}, slots: {} };
}

function host(id = "owner", slots: Record<string, ReturnType<typeof node>[]> = { single: [], many: [] }) {
  return { id, componentId: "host", componentVersion: 1, props: {}, slots };
}

function record(id: string, document: Partial<CompositionRecord["document"]> = {}): CompositionRecord {
  return {
    id,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    document: {
      schemaVersion: 2,
      id,
      name: id,
      root: [],
      ...document,
    },
  };
}

function globalSource(
  id = "source",
  target: "single" | "many" = "single",
): CompositionRecord {
  return record(id, {
    root: [host("owner", { single: [], many: [] })],
    publication: {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "owner", slotId: target } },
    },
  });
}

function consumer(
  root: CompositionRecord["document"]["root"] = [],
  sourceRecordId = "source",
): CompositionRecord {
  return record("consumer", {
    root,
    binding: { sourceRecordId, outletId: "outlet-main" },
  });
}

function summary(
  id: string,
  overrides: Partial<CompositionSummary> = {},
): CompositionSummary {
  return {
    id,
    name: id,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    nodeCount: 1,
    rootCount: 1,
    reuseStatus: "eligible",
    ...overrides,
  };
}

function provider(
  records: readonly CompositionRecord[],
  summaries: readonly CompositionSummary[] = records.map((value) => summary(value.id)),
  providerId: "indexeddb" | "files" = "indexeddb",
): ReuseReadProvider {
  const byId = new Map(records.map((value) => [value.id, value]));
  return {
    provider: COMPOSITION_PROVIDERS[providerId],
    list: async () => summaries,
    get: async (id) => {
      const value = byId.get(id);
      return value ? { status: "loaded", record: value } : { status: "not-found", id };
    },
  };
}

describe("reuse catalog", () => {
  it("lists only eligible lightweight sources in stable order and retains provider-qualified identity", async () => {
    const current = { providerId: "indexeddb" as const, recordId: "current" };
    const active = provider([], [
      summary("same-id", { updatedAt: "2026-07-14T01:00:00.000Z", publicationKind: "pattern" }),
      summary("global", {
        updatedAt: "2026-07-14T03:00:00.000Z",
        publicationKind: "global-template",
        outletId: "outlet-main",
        outletLabel: "Main content",
      }),
      summary("empty-pattern", { publicationKind: "pattern", rootCount: 0 }),
      summary("invalid", {
        publicationKind: "global-template",
        outletId: "outlet-main",
        reuseStatus: "invalid",
      }),
      summary("local"),
      summary("current", { publicationKind: "pattern" }),
    ]);
    const service = createCompositionReuseService(active, manifest);

    await expect(service.listCatalog(current)).resolves.toEqual({
      status: "listed",
      entries: [
        {
          ref: { providerId: "indexeddb", recordId: "global" },
          summary: expect.objectContaining({ id: "global" }),
          kind: "global-template",
          outlet: { id: "outlet-main", label: "Main content" },
        },
        {
          ref: { providerId: "indexeddb", recordId: "same-id" },
          summary: expect.objectContaining({ id: "same-id" }),
          kind: "pattern",
        },
      ],
    });

    const isolated = createCompositionReuseService(
      provider([], [summary("same-id", { publicationKind: "pattern" })], "files"),
      manifest,
    );
    await expect(isolated.listCatalog()).resolves.toMatchObject({
      entries: [{ ref: { providerId: "files", recordId: "same-id" } }],
    });
  });

  it("loads a selected record only on demand and preserves typed unavailable, invalid, and empty reasons", async () => {
    const empty = record("empty", { publication: { kind: "pattern" }, root: [] });
    const local = record("local");
    const service = createCompositionReuseService(provider([empty, local]), manifest);

    await expect(
      service.loadSelection({ providerId: "indexeddb", recordId: "empty" }),
    ).resolves.toMatchObject({ status: "empty", reason: "empty-pattern" });
    await expect(
      service.loadSelection({ providerId: "indexeddb", recordId: "local" }),
    ).resolves.toMatchObject({ status: "invalid", reason: "not-reusable" });
    await expect(
      service.loadSelection({ providerId: "files", recordId: "empty" }),
    ).resolves.toMatchObject({ status: "unavailable" });

    const failing: ReuseReadProvider = {
      ...provider([]),
      get: async () => {
        throw new CompositionPersistenceError("get", "read-failed", "disk read failed", true);
      },
    };
    await expect(
      createCompositionReuseService(failing, manifest).loadSelection({
        providerId: "indexeddb",
        recordId: "anything",
      }),
    ).resolves.toMatchObject({ status: "load-error", message: "disk read failed" });
  });

  it("reports canonical bindings as stable dependents and excludes Pattern copies", async () => {
    const source = globalSource();
    const newest = record("newest", { binding: { sourceRecordId: "source", outletId: "outlet-main" } });
    const older = record("older", { binding: { sourceRecordId: "source", outletId: "outlet-main" } });
    const pattern = record("pattern", { publication: { kind: "pattern" }, root: [node("copy")] });
    const service = createCompositionReuseService(provider(
      [source, newest, older, pattern],
      [
        summary("source"),
        summary("newest", { updatedAt: "2026-07-14T03:00:00.000Z" }),
        summary("older", { updatedAt: "2026-07-14T01:00:00.000Z" }),
        summary("pattern", { updatedAt: "2026-07-14T04:00:00.000Z", publicationKind: "pattern" }),
      ],
    ), manifest);

    await expect(service.listDependents("source")).resolves.toMatchObject({
      status: "listed",
      dependents: [
        { ref: { providerId: "indexeddb", recordId: "newest" } },
        { ref: { providerId: "indexeddb", recordId: "older" } },
      ],
    });
  });
});

describe("live Global-template resolution", () => {
  it("returns unbound, resolves a real empty source slot, and uses its exact constraints", () => {
    const unbound = record("consumer");
    expect(resolveGlobalTemplateLoad(unbound, { status: "not-found", id: "unused" }, manifest)).toMatchObject({
      status: "unbound",
      localRoot: unbound.document.root,
    });

    const resolved = resolveGlobalTemplate({ consumer: consumer([node("allowed")]), source: globalSource(), manifest });
    expect(resolved).toMatchObject({
      status: "resolved",
      outlet: { id: "outlet-main", label: "Main" },
      rootPolicy: { kind: "resolved", accepts: ["allowed"], cardinality: "single" },
    });
  });

  it("returns deterministic missing, invalid, nested, self, and incompatible outcomes without changing local roots", () => {
    const local = [node("kept", "other")];
    const bound = consumer(local);
    expect(resolveGlobalTemplateLoad(bound, { status: "not-found", id: "source" }, manifest)).toMatchObject({
      status: "missing-template",
      reason: "not-found",
      binding: bound.document.binding,
      localRoot: local,
    });
    expect(resolveGlobalTemplateLoad(bound, {
      status: "invalid",
      issue: { code: "malformed-document", message: "bad" },
      raw: null,
    }, manifest)).toMatchObject({ status: "missing-template", reason: "invalid-record" });
    expect(resolveGlobalTemplateLoad(bound, {
      status: "future-schema",
      foundSchemaVersion: 3,
      raw: null,
    }, manifest)).toMatchObject({ status: "missing-template", reason: "future-schema" });

    const source = globalSource();
    const wrongOutlet = consumer([], "source");
    wrongOutlet.document.binding!.outletId = "gone";
    expect(resolveGlobalTemplate({ consumer: wrongOutlet, source, manifest })).toMatchObject({ status: "missing-outlet" });

    const localSource = record("source");
    expect(resolveGlobalTemplate({ consumer: bound, source: localSource, manifest })).toMatchObject({
      status: "invalid-template",
      reason: "not-global-template",
    });

    const nested = globalSource();
    nested.document.binding = { sourceRecordId: "other-source", outletId: "outlet" };
    expect(resolveGlobalTemplate({ consumer: bound, source: nested, manifest })).toMatchObject({ status: "nested-template" });

    const self = consumer([], "consumer");
    expect(resolveGlobalTemplate({ consumer: self, source: globalSource("consumer"), manifest })).toMatchObject({ status: "self-reference" });

    const staleTarget = globalSource();
    (staleTarget.document.publication as { kind: "global-template"; outlet: { target: { parentId: string; slotId: string } } }).outlet.target.slotId = "gone";
    expect(resolveGlobalTemplate({ consumer: bound, source: staleTarget, manifest })).toMatchObject({
      status: "invalid-template",
      reason: "invalid-outlet-target",
    });

    expect(resolveGlobalTemplate({ consumer: bound, source, manifest })).toMatchObject({
      status: "incompatible-local-root",
      localRoot: local,
      rootPolicy: { kind: "resolved", accepts: ["allowed"], cardinality: "single" },
    });
    expect(bound.document.root).toBe(local);
    expect(bound.document.binding).toEqual({ sourceRecordId: "source", outletId: "outlet-main" });
  });

  it("re-resolves a source rename and a stable outlet reassignment from the latest saved record", async () => {
    const current = globalSource("source", "single");
    current.document.name = "Renamed source";
    const latest = globalSource("source", "many");
    latest.document.name = "Latest source name";
    const service = createCompositionReuseService(provider([latest]), manifest);

    const initial = resolveGlobalTemplate({ consumer: consumer(), source: current, manifest });
    expect(initial).toMatchObject({ status: "resolved", rootPolicy: { cardinality: "single" } });
    await expect(service.resolve(consumer())).resolves.toMatchObject({
      status: "resolved",
      source: { id: "source", document: { name: "Latest source name" } },
      outlet: { id: "outlet-main" },
      rootPolicy: { cardinality: "many" },
    });
  });
});
