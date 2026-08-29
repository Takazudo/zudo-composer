import { describe, expect, it, vi } from "vitest";
import {
  createCompositionCatalog,
  type CompositionCatalogProvider,
  type ResolveOutcome,
} from "../index";
import type { CompositionLoadOutcome, CompositionRecord, CompositionSummary } from "../../../composer/index";

const T1 = "2026-01-02T03:04:05.000Z";
const T2 = "2026-01-02T04:04:05.000Z";

function record(id: string, name = id): CompositionRecord {
  return {
    id,
    createdAt: T1,
    updatedAt: T2,
    document: {
      schemaVersion: 2,
      id,
      name,
      root: [],
    },
  };
}

function summary(id: string, name = id): CompositionSummary {
  return {
    id,
    name,
    createdAt: T1,
    updatedAt: T2,
    nodeCount: 3,
  };
}

function provider(
  id: string,
  label: string,
  summaries: readonly CompositionSummary[],
  outcomes: Record<string, CompositionLoadOutcome>,
): CompositionCatalogProvider {
  return {
    descriptor: { id, label },
    store: {
      list: vi.fn(async () => summaries),
      get: vi.fn(async (recordId: string) => outcomes[recordId] ?? { status: "not-found", id: recordId }),
    },
  };
}

describe("Composition catalog", () => {
  it("rejects duplicate provider identities instead of selecting one implicitly", () => {
    const first = provider("indexeddb", "First", [], {});
    const second = provider("indexeddb", "Second", [], {});
    expect(() => createCompositionCatalog([first, second])).toThrow(
      'Duplicate composition provider id "indexeddb".',
    );
  });

  it("retains provider-qualified identity when providers contain the same id", async () => {
    const browser = provider("indexeddb", "Browser storage", [summary("shared", "Browser")], {
      shared: { status: "loaded", record: record("shared", "Browser") },
    });
    const files = provider("files", "Local files", [summary("shared", "Files")], {
      shared: { status: "loaded", record: record("shared", "Files") },
    });
    const catalog = createCompositionCatalog([browser, files]);

    await expect(catalog.listCompositions()).resolves.toEqual({
      entries: [
        {
          ref: { providerId: "indexeddb", recordId: "shared" },
          providerLabel: "Browser storage",
          name: "Browser",
          updatedAt: T2,
          nodeCount: 3,
        },
        {
          ref: { providerId: "files", recordId: "shared" },
          providerLabel: "Local files",
          name: "Files",
          updatedAt: T2,
          nodeCount: 3,
        },
      ],
      failures: [],
    });

    await expect(catalog.resolveComposition({ providerId: "indexeddb", recordId: "shared" })).resolves.toEqual({
      status: "resolved",
      record: record("shared", "Browser"),
    });
    await expect(catalog.resolveComposition({ providerId: "files", recordId: "shared" })).resolves.toEqual({
      status: "resolved",
      record: record("shared", "Files"),
    });
  });

  it("returns surviving entries plus a per-provider failure when one list rejects", async () => {
    const surviving = provider("indexeddb", "Browser storage", [summary("good")], {
      good: { status: "loaded", record: record("good") },
    });
    const failing: CompositionCatalogProvider = {
      descriptor: { id: "files", label: "Local files" },
      store: {
        list: vi.fn(async () => {
          throw new Error("file manifest is unavailable");
        }),
        get: vi.fn(async (id: string) => ({ status: "not-found" as const, id })),
      },
    };
    const result = await createCompositionCatalog([surviving, failing]).listCompositions();

    expect(result.entries).toEqual([
      {
        ref: { providerId: "indexeddb", recordId: "good" },
        providerLabel: "Browser storage",
        name: "good",
        updatedAt: T2,
        nodeCount: 3,
      },
    ]);
    expect(result.failures).toEqual([
      {
        providerId: "files",
        providerLabel: "Local files",
        reason: "file manifest is unavailable",
      },
    ]);
  });

  it.each([
    ["not-found", { status: "not-found", id: "missing" }, { status: "not-found" }],
    [
      "invalid",
      {
        status: "invalid",
        issue: { code: "malformed-document", message: "record cannot be decoded" },
        raw: { id: "broken" },
      },
      { status: "unreadable-target", reason: "record cannot be decoded" },
    ],
    [
      "future-schema",
      { status: "future-schema", foundSchemaVersion: 99, raw: { id: "future" } },
      { status: "unreadable-target", reason: "The composition uses unsupported schema version 99." },
    ],
  ] as const)("maps a Composer %s load outcome", async (_label, load, expected) => {
    const candidate = provider("indexeddb", "Browser storage", [], { target: load });
    await expect(createCompositionCatalog([candidate]).resolveComposition({
      providerId: "indexeddb",
      recordId: "target",
    })).resolves.toEqual(expected satisfies ResolveOutcome);
  });

  it("returns provider-unavailable for a ref whose provider is absent", async () => {
    const catalog = createCompositionCatalog([provider("indexeddb", "Browser storage", [], {})]);
    await expect(catalog.resolveComposition({ providerId: "files", recordId: "target" })).resolves.toEqual({
      status: "provider-unavailable",
    });
  });

  it.each([
    [{ providerId: "", recordId: "target" }, "Composition reference providerId must be a non-empty string."],
    [{ providerId: "indexeddb", recordId: "../target" }, "Composition reference recordId is not a safe record id."],
  ] as const)("separates malformed refs from unreadable targets", async (ref, reason) => {
    const catalog = createCompositionCatalog([provider("indexeddb", "Browser storage", [], {})]);
    await expect(catalog.resolveComposition(ref)).resolves.toEqual({ status: "invalid-ref", reason });
  });

  it("does not call Composer write APIs", async () => {
    const writes = {
      put: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    };
    const readProvider = {
      ...provider("indexeddb", "Browser storage", [summary("one")], {
        one: { status: "loaded", record: record("one") },
      }),
      store: {
        ...provider("indexeddb", "Browser storage", [], {}).store,
        ...writes,
      },
    } as CompositionCatalogProvider;
    const catalog = createCompositionCatalog([readProvider]);
    await catalog.listCompositions();
    await catalog.resolveComposition({ providerId: "indexeddb", recordId: "one" });
    expect(writes.put).not.toHaveBeenCalled();
    expect(writes.delete).not.toHaveBeenCalled();
    expect(writes.clear).not.toHaveBeenCalled();
  });
});
