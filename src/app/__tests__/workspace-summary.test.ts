import { describe, expect, it, vi } from "vitest";
import type { CompositionRecord, CompositionSummary } from "../../composer/browser";
import { COMPOSITION_SCHEMA_VERSION } from "../../composer/browser";
import type { ComponentCatalog } from "../../composer/model/types";
import type { ContentEntryRecord, ContentModelRecord } from "../../content/model";
import type { ContentModelSummary } from "../../content/library";
import type { MappingCatalogEntry, MappingRecord } from "../../mapping";
import { MAPPING_SCHEMA_VERSION } from "../../mapping";
import type { MediaSummary } from "../../media";
import { SITEMAP_SCHEMA_VERSION, type SitemapNode } from "../../sitemapper/model";
import type { SitemapRecord } from "../../sitemapper/library";
import type { ProductionProviderIntegration } from "../provider-integration";
import { createWorkspaceSummary, type WorkspaceInitializationOutcome, type WorkspaceSource, type WorkspaceSummaryIntegration } from "../workspace-summary";

const AT = (day: number) => `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`;

function value<T>(source: WorkspaceSource<T>): T {
  expect(source.status).toBe("ok");
  return (source as { status: "ok"; value: T }).value;
}

function compositionSummary(id: string, updatedAt: string, publicationKind?: CompositionSummary["publicationKind"]): CompositionSummary {
  return { id, name: `Composition ${id}`, createdAt: AT(1), updatedAt, nodeCount: 1, ...(publicationKind ? { publicationKind } : {}) };
}

function compositionRecord(id: string): CompositionRecord {
  return { id, createdAt: AT(1), updatedAt: AT(1), document: { schemaVersion: COMPOSITION_SCHEMA_VERSION, id, name: `Composition ${id}`, root: [] } };
}

function mappingEntry(id: string, updatedAt: string): MappingCatalogEntry {
  return {
    ref: { providerId: "mapping-indexeddb", recordId: id },
    providerLabel: "Browser storage",
    summary: { id, name: `Mapping ${id}`, createdAt: AT(1), updatedAt, bindingCount: 0 },
  };
}

function mappingRecord(id: string, compositionRecordId = "hero"): MappingRecord {
  return {
    id,
    createdAt: AT(1),
    updatedAt: AT(1),
    document: {
      schemaVersion: MAPPING_SCHEMA_VERSION,
      id,
      name: `Mapping ${id}`,
      contentModel: { providerId: "content-indexeddb", recordId: "journal" },
      composition: { providerId: "indexeddb", recordId: compositionRecordId },
      bindings: [],
    },
  };
}

function contentModel(id: string, updatedAt: string): ContentModelRecord {
  return {
    id,
    createdAt: AT(1),
    updatedAt,
    document: {
      schemaVersion: 1,
      id,
      name: `Model ${id}`,
      kind: "collection",
      fields: [
        { id: "heading", key: "heading", label: "Heading", required: true, kind: "text" },
        { id: "count", key: "count", label: "Count", required: false, kind: "number" },
      ],
    },
  };
}

function contentEntry(id: string, updatedAt: string, values: ContentEntryRecord["values"]): ContentEntryRecord {
  return { schemaVersion: 1, id, modelId: "journal", createdAt: AT(1), updatedAt, values };
}

function sitemapNode(id: string, title: string, source: SitemapNode["source"], children: SitemapNode[] = []): SitemapNode {
  return { id, title, source, children };
}

function sitemapRecord(id: string, updatedAt: string, root: SitemapNode[]): SitemapRecord {
  return { id, createdAt: AT(1), updatedAt, document: { schemaVersion: SITEMAP_SCHEMA_VERSION, id, name: `Sitemap ${id}`, root } };
}

function mediaSummary(id: string, updatedAt: string, mediaType: MediaSummary["mediaType"], byteLength: number): MediaSummary {
  return { id, fileName: `${id}.file`, mediaType, byteLength, checksum: "a".repeat(64), createdAt: AT(1), updatedAt };
}

const emptyCatalog: ComponentCatalog = {
  pack: {} as ComponentCatalog["pack"],
  get: () => undefined,
  has: () => false,
  ids: () => [],
};

interface FakeOptions {
  initialize?: () => Promise<WorkspaceInitializationOutcome>;
  retry?: () => Promise<WorkspaceInitializationOutcome>;
  compositions?: readonly CompositionSummary[] | Error;
  mappings?: readonly MappingCatalogEntry[] | Error;
  mappingRecords?: Readonly<Record<string, MappingRecord>>;
  compositionRecords?: readonly string[];
  models?: readonly ContentModelRecord[] | Error;
  entries?: Readonly<Record<string, { count: number; entries: readonly ContentEntryRecord[]; diagnostics: readonly { entryId: string; message: string }[] }>>;
  sitemaps?: readonly SitemapRecord[] | Error;
  sitemapsWithoutReadAll?: boolean;
  media?: readonly MediaSummary[] | Error | null;
}

function settle<T>(source: T | Error): Promise<T> {
  return source instanceof Error ? Promise.reject(source) : Promise.resolve(source);
}

function createFakeIntegration(options: FakeOptions = {}) {
  const initialize = vi.fn(options.initialize ?? (async () => ({ status: "ready" as const })));
  const retry = vi.fn(options.retry ?? (async () => ({ status: "ready" as const })));
  const compositions = options.compositions ?? [];
  const mappings = options.mappings ?? [];
  const models = options.models ?? [];
  const sitemaps = options.sitemaps ?? [];
  const media = options.media === undefined ? [] : options.media;
  const knownCompositions = new Set(options.compositionRecords ?? ["hero"]);
  const scanEntries = vi.fn(async (modelId: string) => {
    const found = options.entries?.[modelId] ?? { count: 0, entries: [], diagnostics: [] };
    const model = (models instanceof Error ? [] : models).find(({ id }) => id === modelId) ?? contentModel(modelId, AT(1));
    return {
      model,
      count: found.count,
      entries: found.entries,
      diagnostics: found.diagnostics.map(({ entryId, message }) => ({ code: "required-value-missing" as const, modelId, entryId, fieldId: "heading", fieldKey: "heading", message })),
    };
  });

  const sitemapStore = {
    list: async () => {
      if (sitemaps instanceof Error) throw sitemaps;
      return sitemaps.map((record) => ({ id: record.id, name: record.document.name, createdAt: record.createdAt, updatedAt: record.updatedAt, pageCount: 1, unassignedCount: 0 }));
    },
    get: async (id: string) => {
      if (sitemaps instanceof Error) throw sitemaps;
      const record = sitemaps.find((entry) => entry.id === id);
      return record ? { status: "loaded" as const, record } : { status: "not-found" as const, id };
    },
    ...(options.sitemapsWithoutReadAll ? {} : { readAll: () => settle(sitemaps) }),
  };

  const integration: WorkspaceSummaryIntegration = {
    initialization: { initialize, retry },
    componentProvider: { catalog: emptyCatalog },
    compositionProviders: [{ descriptor: { id: "indexeddb", label: "Browser storage" }, store: { list: () => settle(compositions) } }],
    contentProvider: { store: { listModels: async () => (models instanceof Error ? Promise.reject(models) : models.map((model): ContentModelSummary => ({ id: model.id, name: model.document.name, kind: model.document.kind, fieldCount: model.document.fields.length, createdAt: model.createdAt, updatedAt: model.updatedAt }))), scanEntries } },
    contentCatalog: {
      listModels: async () => ({ status: "listed", entries: [], failures: [] }),
      resolveModel: async (ref) => {
        const model = (models instanceof Error ? [] : models).find(({ id }) => id === ref.recordId);
        return model ? { status: "resolved", record: model } : { status: "not-found" };
      },
    },
    mappingCatalog: {
      list: async () => (mappings instanceof Error ? Promise.reject(mappings) : { status: "listed", entries: mappings, failures: [] }),
      resolve: async (ref) => {
        const record = options.mappingRecords?.[ref.recordId];
        return record ? { status: "resolved", record } : { status: "not-found" };
      },
    },
    mappingCompositionCatalog: {
      list: async () => ({ status: "listed", entries: [], failures: [] }),
      resolve: async (ref) => (knownCompositions.has(ref.recordId) ? { status: "resolved", record: compositionRecord(ref.recordId) } : { status: "not-found" }),
    },
    sitemapProvider: { store: sitemapStore },
    mediaProvider: media === null ? undefined : { store: { list: () => settle(media) } },
  };
  return { integration, initialize, retry, scanEntries };
}

describe("createWorkspaceSummary — contract", () => {
  it("accepts the production provider integration", () => {
    const accept = (integration: ProductionProviderIntegration): WorkspaceSummaryIntegration => integration;
    expect(accept).toBeTypeOf("function");
  });
});

describe("createWorkspaceSummary — counts", () => {
  it("counts every authoring domain from one set of provider reads", async () => {
    const { integration } = createFakeIntegration({
      compositions: [compositionSummary("hero", AT(5)), compositionSummary("nav", AT(4), "global-template"), compositionSummary("card", AT(3), "pattern")],
      mappings: [mappingEntry("journal", AT(6)), mappingEntry("about", AT(2))],
      mappingRecords: { journal: mappingRecord("journal"), about: mappingRecord("about", "missing") },
      models: [contentModel("journal", AT(7))],
      entries: { journal: { count: 2, entries: [contentEntry("first", AT(8), { heading: "First" }), contentEntry("second", AT(9), { heading: "" })], diagnostics: [{ entryId: "second", message: "Heading is required." }] } },
      sitemaps: [sitemapRecord("studio", AT(10), [sitemapNode("home", "Home", { kind: "composition", ref: { providerId: "indexeddb", recordId: "hero" } }, [sitemapNode("drafts", "Drafts", { kind: "unassigned" })])])],
      media: [mediaSummary("hero-image", AT(11), "image/png", 2048), mediaSummary("brochure", AT(1), "application/pdf", 4096), mediaSummary("logo", AT(2), "image/png", 512)],
    });
    const summary = createWorkspaceSummary(integration);
    const counts = await summary.counts();

    expect(value(counts.compositions)).toEqual({ compositions: 3, patterns: 1, globalTemplates: 1 });
    expect(value(counts.mappings)).toEqual({ mappings: 2, blockedMappings: 1 });
    expect(value(counts.sitemaps)).toEqual({ sitemaps: 1, pages: 2, unassignedPages: 1 });
    expect(value(counts.content)).toEqual({ models: 1, entries: 2, incompleteEntries: 1 });
    expect(value(counts.media)).toEqual({ assets: 3, bytes: 6656, byType: { "image/png": 2, "application/pdf": 1 } });
  });

  it("reads sitemaps record by record when the provider is not a collection store", async () => {
    const { integration } = createFakeIntegration({
      sitemapsWithoutReadAll: true,
      sitemaps: [sitemapRecord("studio", AT(3), [sitemapNode("home", "Home", { kind: "unassigned" })])],
    });
    expect(value((await createWorkspaceSummary(integration).counts()).sitemaps)).toEqual({ sitemaps: 1, pages: 1, unassignedPages: 1 });
  });

  it("reports a missing Media provider as unavailable rather than zero assets", async () => {
    const { integration } = createFakeIntegration({ media: null });
    const counts = await createWorkspaceSummary(integration).counts();
    expect(counts.media).toEqual({ status: "unavailable", error: "No Media provider is connected." });
  });
});

describe("createWorkspaceSummary — recent", () => {
  it("orders records across domains by updatedAt and carries a deep link", async () => {
    const { integration } = createFakeIntegration({
      compositions: [compositionSummary("hero", AT(5))],
      mappings: [mappingEntry("journal", AT(6))],
      mappingRecords: { journal: mappingRecord("journal") },
      models: [contentModel("journal", AT(7))],
      entries: { journal: { count: 1, entries: [contentEntry("first", AT(4), { heading: "  First article  " })], diagnostics: [] } },
      sitemaps: [sitemapRecord("studio", AT(9), [sitemapNode("home", "Home", { kind: "unassigned" })])],
      media: [mediaSummary("hero-image", AT(8), "image/png", 10)],
    });
    const { records, unavailable } = await createWorkspaceSummary(integration).recent();

    expect(unavailable).toEqual([]);
    expect(records.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      "sitemap:studio",
      "media:hero-image",
      "content-model:journal",
      "mapping:journal",
      "composition:hero",
      "content-entry:first",
    ]);
    expect(records.map(({ href }) => href)).toEqual([
      "/sitemapper?sitemap=studio",
      "/media?asset=hero-image",
      "/content?model=journal",
      "/mapping?provider=mapping-indexeddb&mapping=journal",
      "/composer",
      "/content?model=journal&entry=first",
    ]);
    expect(records.find(({ kind }) => kind === "content-entry")?.label).toBe("First article");
  });

  it("honours the limit and reports which sources were omitted", async () => {
    const { integration } = createFakeIntegration({
      compositions: [compositionSummary("hero", AT(5)), compositionSummary("nav", AT(4))],
      mappings: new Error("Mapping storage is unavailable."),
      media: null,
    });
    const { records, unavailable } = await createWorkspaceSummary(integration).recent(1);

    expect(records.map(({ id }) => id)).toEqual(["hero"]);
    expect(unavailable).toEqual([
      { source: "mappings", error: "Mapping storage is unavailable." },
      { source: "media", error: "No Media provider is connected." },
    ]);
  });

  it("keeps the newest record first at any limit, across sources", async () => {
    const { integration } = createFakeIntegration({
      compositions: [compositionSummary("hero", AT(5))],
      media: [mediaSummary("hero-image", AT(8), "image/png", 10)],
      sitemaps: [sitemapRecord("studio", AT(9), [])],
    });
    const summary = createWorkspaceSummary(integration);

    expect((await summary.recent(1)).records.map(({ id }) => id)).toEqual(["studio"]);
    expect((await summary.recent(2)).records.map(({ id }) => id)).toEqual(["studio", "hero-image"]);
  });

  it("labels a Composition by its publication kind", async () => {
    const { integration } = createFakeIntegration({ compositions: [compositionSummary("card", AT(3), "pattern"), compositionSummary("nav", AT(2), "global-template")] });
    const { records } = await createWorkspaceSummary(integration).recent();
    expect(records.map(({ kind }) => kind)).toEqual(["pattern", "global-template"]);
  });
});

describe("createWorkspaceSummary — attention", () => {
  it("collects blocked Mappings, source-less pages, and incomplete Entries", async () => {
    const { integration } = createFakeIntegration({
      mappings: [mappingEntry("journal", AT(6)), mappingEntry("about", AT(5)), mappingEntry("ghost", AT(4))],
      mappingRecords: { journal: mappingRecord("journal"), about: mappingRecord("about", "missing") },
      models: [contentModel("journal", AT(7))],
      entries: { journal: { count: 1, entries: [contentEntry("second", AT(9), { heading: "" })], diagnostics: [{ entryId: "second", message: "Heading is required." }, { entryId: "second", message: "A later diagnostic." }] } },
      sitemaps: [sitemapRecord("studio", AT(10), [sitemapNode("home", "Home", { kind: "unassigned" })])],
    });
    const attention = await createWorkspaceSummary(integration).attention();

    expect(value(attention.mappings)).toEqual([
      { kind: "blocked-mapping", id: "about", label: "Mapping about", detail: "The referenced Composition was not found.", href: "/mapping?provider=mapping-indexeddb&mapping=about" },
      { kind: "blocked-mapping", id: "ghost", label: "Mapping ghost", detail: "This Mapping record was not found.", href: "/mapping?provider=mapping-indexeddb&mapping=ghost" },
    ]);
    expect(value(attention.sitemaps)).toEqual([{
      kind: "unassigned-page",
      id: "home",
      label: "Home",
      detail: '"Sitemap studio" has a page with no Composition or Mapping source.',
      href: "/sitemapper?sitemap=studio&page=home",
      intent: { route: "sitemapper", sitemapId: "studio", pageId: "home" },
    }]);
    expect(value(attention.content)).toEqual([{
      kind: "incomplete-entry",
      id: "second",
      label: "second",
      detail: "Heading is required.",
      href: "/content?model=journal&entry=second",
      intent: { route: "content", modelId: "journal", entryId: "second" },
    }]);
  });

  it("falls back to the Sitemap intent when a page id cannot appear in a URL", async () => {
    const { integration } = createFakeIntegration({
      sitemaps: [sitemapRecord("studio", AT(3), [sitemapNode("Page One", "Home", { kind: "unassigned" })])],
    });
    const attention = await createWorkspaceSummary(integration).attention();
    expect(value(attention.sitemaps)[0]).toMatchObject({ href: "/sitemapper?sitemap=studio", intent: { route: "sitemapper", sitemapId: "studio" } });
  });
});

describe("createWorkspaceSummary — resilience and lifecycle", () => {
  it("keeps healthy sources readable when one provider fails", async () => {
    const { integration } = createFakeIntegration({
      compositions: new Error("Composition storage is unavailable."),
      mappings: [mappingEntry("journal", AT(6))],
      mappingRecords: { journal: mappingRecord("journal") },
      models: [contentModel("journal", AT(7))],
      sitemaps: new Error("Sitemap storage is unavailable."),
      media: [mediaSummary("hero-image", AT(8), "image/png", 10)],
    });
    const counts = await createWorkspaceSummary(integration).counts();

    expect(counts.compositions).toEqual({ status: "unavailable", error: "Compositions in Browser storage could not be listed: Composition storage is unavailable." });
    expect(counts.sitemaps).toEqual({ status: "unavailable", error: "Sitemap storage is unavailable." });
    expect(value(counts.mappings)).toEqual({ mappings: 1, blockedMappings: 0 });
    expect(value(counts.content)).toEqual({ models: 1, entries: 0, incompleteEntries: 0 });
    expect(value(counts.media)).toEqual({ assets: 1, bytes: 10, byType: { "image/png": 1 } });
  });

  it("keeps Media readable when provider initialization fails", async () => {
    const { integration, initialize } = createFakeIntegration({
      initialize: async () => ({ status: "error", error: new Error("The active SiteProject could not be initialized.") }),
      media: [mediaSummary("hero-image", AT(8), "image/png", 10)],
    });
    const counts = await createWorkspaceSummary(integration).counts();

    for (const source of [counts.compositions, counts.mappings, counts.sitemaps, counts.content]) {
      expect(source).toEqual({ status: "unavailable", error: "The active SiteProject could not be initialized." });
    }
    expect(value(counts.media)).toEqual({ assets: 1, bytes: 10, byType: { "image/png": 1 } });
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("reports a failing Mapping provider instead of an undercount", async () => {
    const { integration } = createFakeIntegration();
    const failing: WorkspaceSummaryIntegration = {
      ...integration,
      mappingCatalog: { ...integration.mappingCatalog, list: async () => ({ status: "listed", entries: [], failures: [{ providerId: "mapping-indexeddb", providerLabel: "Browser storage", reason: "The database is blocked." }] }) },
    };
    expect((await createWorkspaceSummary(failing).counts()).mappings).toEqual({ status: "unavailable", error: "Browser storage: The database is blocked." });
  });

  it("initializes once and reuses one provider read across counts, recent, and attention", async () => {
    const { integration, initialize, scanEntries } = createFakeIntegration({ models: [contentModel("journal", AT(7))] });
    const summary = createWorkspaceSummary(integration);

    await Promise.all([summary.counts(), summary.recent(), summary.attention()]);
    await summary.counts();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(scanEntries).toHaveBeenCalledTimes(1);
  });

  it("re-reads providers on refresh without re-running a fulfilled initialization", async () => {
    const { integration, initialize, retry, scanEntries } = createFakeIntegration({ models: [contentModel("journal", AT(7))] });
    const summary = createWorkspaceSummary(integration);

    await summary.counts();
    summary.refresh();
    await summary.counts();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(scanEntries).toHaveBeenCalledTimes(2);
  });

  it("re-attempts a failed initialization on refresh and recovers through retry", async () => {
    const { integration, initialize, retry } = createFakeIntegration({
      initialize: async () => ({ status: "error", error: new Error("The active SiteProject could not be initialized.") }),
      models: [contentModel("journal", AT(7))],
    });
    const summary = createWorkspaceSummary(integration);

    const failed = await summary.counts();
    for (const source of [failed.compositions, failed.mappings, failed.sitemaps, failed.content]) {
      expect(source).toEqual({ status: "unavailable", error: "The active SiteProject could not be initialized." });
    }

    summary.refresh();
    const recovered = await summary.counts();

    expect(value(recovered.compositions)).toEqual({ compositions: 0, patterns: 0, globalTemplates: 0 });
    expect(value(recovered.mappings)).toEqual({ mappings: 0, blockedMappings: 0 });
    expect(value(recovered.sitemaps)).toEqual({ sitemaps: 0, pages: 0, unassignedPages: 0 });
    expect(value(recovered.content)).toEqual({ models: 1, entries: 0, incompleteEntries: 0 });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shares one failed attempt across every loader of a single read", async () => {
    const { integration, initialize, retry } = createFakeIntegration({
      initialize: async () => ({ status: "error", error: new Error("The active SiteProject could not be initialized.") }),
    });
    const summary = createWorkspaceSummary(integration);

    await Promise.all([summary.counts(), summary.recent(), summary.attention()]);

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("does not start a second attempt when refresh lands mid-initialization", async () => {
    let release: ((outcome: WorkspaceInitializationOutcome) => void) | undefined;
    const gate = new Promise<WorkspaceInitializationOutcome>((resolve) => {
      release = resolve;
    });
    const { integration, initialize, retry } = createFakeIntegration({ initialize: () => gate });
    const summary = createWorkspaceSummary(integration);

    const inFlight = summary.counts();
    summary.refresh();
    release!({ status: "ready" });
    await inFlight;
    expect(value((await summary.counts()).sitemaps)).toEqual({ sitemaps: 0, pages: 0, unassignedPages: 0 });

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("stays failed after a retry that fails again, until the next refresh", async () => {
    let attempts = 0;
    const { integration, initialize, retry } = createFakeIntegration({
      initialize: async () => ({ status: "error", error: new Error("The active SiteProject could not be initialized.") }),
      retry: async () => (++attempts === 1 ? { status: "error", error: new Error("The retry failed too.") } : { status: "ready" }),
    });
    const summary = createWorkspaceSummary(integration);

    expect((await summary.counts()).content).toEqual({ status: "unavailable", error: "The active SiteProject could not be initialized." });
    summary.refresh();
    expect((await summary.counts()).content).toEqual({ status: "unavailable", error: "The retry failed too." });
    summary.refresh();
    expect(value((await summary.counts()).content)).toEqual({ models: 0, entries: 0, incompleteEntries: 0 });

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("treats a rejected lifecycle call as a failed initialization and re-attempts it", async () => {
    const { integration, initialize, retry } = createFakeIntegration({
      initialize: () => Promise.reject(new Error("The lifecycle threw instead of answering.")),
    });
    const summary = createWorkspaceSummary(integration);

    expect((await summary.counts()).sitemaps).toEqual({ status: "unavailable", error: "The lifecycle threw instead of answering." });
    summary.refresh();
    expect(value((await summary.counts()).sitemaps)).toEqual({ sitemaps: 0, pages: 0, unassignedPages: 0 });

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
