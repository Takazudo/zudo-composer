import { describe, expect, it, vi } from "vitest";
import type { CompositionRecord, CompositionSummary } from "../../composer/browser";
import { COMPOSITION_SCHEMA_VERSION } from "../../composer/browser";
import type { ComponentCatalog } from "../../composer/model/types";
import type { ContentEntryRecord, ContentModelRecord } from "../../content/model";
import { diagnoseContentEntryCompleteness, type ContentModelSummary } from "../../content/library";
import type { MappingCatalogEntry, MappingRecord } from "../../mapping";
import { MAPPING_SCHEMA_VERSION } from "../../mapping";
import type { AssetSummary } from "../../assets";
import { SITEMAP_SCHEMA_VERSION, type SitemapNode } from "../../sitemapper/model";
import type { SitemapRecord } from "../../sitemapper/library";
import type { ProductionProviderIntegration } from "../provider-integration";
import {
  createWorkspaceSummary,
  type WorkspaceCounts,
  type WorkspaceInitializationOutcome,
  type WorkspaceAssetSource,
  type WorkspaceSource,
  type WorkspaceSummaryIntegration,
} from "../workspace-summary";

const AT = (day: number) => `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`;

function value<T>(source: WorkspaceSource<T>): T {
  expect(source.status).toBe("ok");
  return (source as { status: "ok"; value: T }).value;
}

function assetValue<T>(source: WorkspaceAssetSource<T>): T {
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
    ref: { providerId: "mapping-filesystem", recordId: id },
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
      contentModel: { providerId: "content-filesystem", recordId: "journal" },
      composition: { providerId: "files", recordId: compositionRecordId },
      mode: { kind: "single" },
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
      description: "",
      kind: "collection",
      fields: [
        { id: "heading", key: "heading", label: "Heading", required: true, kind: "text" },
        { id: "count", key: "count", label: "Count", required: false, kind: "number" },
      ],
    },
  };
}

function contentEntry(id: string, updatedAt: string, values: ContentEntryRecord["values"]): ContentEntryRecord {
  return { schemaVersion: 1, lifecycle: "draft", generation: 0, id, modelId: "journal", createdAt: AT(1), updatedAt, values };
}

function sitemapNode(id: string, title: string, source: SitemapNode["source"], children: SitemapNode[] = []): SitemapNode {
  return { id, title, source, children };
}

function sitemapRecord(id: string, updatedAt: string, root: SitemapNode[]): SitemapRecord {
  return { id, createdAt: AT(1), updatedAt, document: { schemaVersion: SITEMAP_SCHEMA_VERSION, navigation: { primary: [], footer: [] }, id, name: `Sitemap ${id}`, root } };
}

function assetSummary(id: string, updatedAt: string, mimeType: AssetSummary["mimeType"], byteLength: number): AssetSummary {
  return { id, fileName: `${id}.file`, mimeType, byteLength, checksum: "a".repeat(64), createdAt: AT(1), updatedAt,
    revision: 1, folderId: null, note: "", state: "active", versionId: "a".repeat(64), url: "/uploaded-assets/fixture", authoringUrl: `/uploaded-assets/asset-${id}` };
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
  assets?: readonly AssetSummary[] | Error | null;
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
  const assets = options.assets === undefined ? [] : options.assets;
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
    compositionProviders: [{ descriptor: { id: "files", label: "Project files" }, store: { list: () => settle(compositions) } }],
    contentProvider: { descriptor: { id: "content-filesystem" }, store: { listModels: async () => (models instanceof Error ? Promise.reject(models) : models.map((model): ContentModelSummary => ({ id: model.id, name: model.document.name, kind: model.document.kind, fieldCount: model.document.fields.length, createdAt: model.createdAt, updatedAt: model.updatedAt }))), scanEntries } },
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
    sitemapProvider: { descriptor: { id: "sitemap-filesystem" }, store: sitemapStore },
    assetProvider: assets === null ? undefined : { descriptor: { id: "asset-files" }, store: { list: () => settle(assets) } },
  };
  return { integration, initialize, retry, scanEntries };
}

describe("createWorkspaceSummary — contract", () => {
  it.each([
    ["compositions:files", ["compositions", "mappings"]],
    ["content", ["content", "mappings"]],
    ["mapping", ["mappings"]], ["sitemapper", ["sitemaps"]], ["assets", ["assets"]],
    ["workspace", ["compositions", "mappings", "sitemaps", "content", "assets"]],
    ["sessions", []],
  ] as const)("invalidates only dependent summary reads after %s", async (channel, affected) => {
    const { integration } = createFakeIntegration({ assets: [] });
    let changed!: (channel?: string) => void;
    integration.subscribeChanges = (listener) => { changed = listener; return () => {}; };
    const reads = {
      compositions: vi.spyOn(integration.compositionProviders[0]!.store, "list"),
      mappings: vi.spyOn(integration.mappingCatalog, "list"),
      sitemaps: vi.spyOn(integration.sitemapProvider.store, "readAll"),
      content: vi.spyOn(integration.contentProvider.store, "listModels"),
      assets: vi.spyOn(integration.assetProvider!.store, "list"),
    };
    const summary = createWorkspaceSummary(integration);
    await summary.counts();
    for (const read of Object.values(reads)) read.mockClear();
    changed(channel); await summary.counts();
    for (const [domain, read] of Object.entries(reads)) expect(read, domain).toHaveBeenCalledTimes((affected as readonly string[]).includes(domain) ? 1 : 0);
    summary.dispose?.();
  });

  it("does not restore an obsolete pending source after a domain hint", async () => {
    const { integration } = createFakeIntegration({ assets: [] });
    let changed!: (channel?: string) => void;
    integration.subscribeChanges = (listener) => { changed = listener; return () => {}; };
    let finish!: (value: readonly AssetSummary[]) => void;
    const list = vi.spyOn(integration.assetProvider!.store, "list")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue([assetSummary("current", AT(1), "image/png", 10)]);
    const summary = createWorkspaceSummary(integration);
    const old = summary.counts();
    changed("assets");
    expect(await summary.counts()).toMatchObject({ assets: { value: { assets: 1 } } });
    finish([]); await old;
    expect(await summary.counts()).toMatchObject({ assets: { value: { assets: 1 } } });
    expect(list).toHaveBeenCalledTimes(2); summary.dispose?.();
  });

  it("accepts the production provider integration", () => {
    const accept = (integration: ProductionProviderIntegration): WorkspaceSummaryIntegration => integration;
    expect(accept).toBeTypeOf("function");
  });

  it("keeps every domain but Asset structurally incapable of an absent status", () => {
    // Asset alone may answer "absent" (no provider configured); this is a
    // compile-time check that the other four domains cannot.
    // @ts-expect-error compositions is a plain WorkspaceSource — it has no "absent" status.
    const badCompositions: WorkspaceCounts["compositions"] = { status: "absent" };
    // @ts-expect-error mappings is a plain WorkspaceSource — it has no "absent" status.
    const badMappings: WorkspaceCounts["mappings"] = { status: "absent" };
    // @ts-expect-error sitemaps is a plain WorkspaceSource — it has no "absent" status.
    const badSitemaps: WorkspaceCounts["sitemaps"] = { status: "absent" };
    // @ts-expect-error content is a plain WorkspaceSource — it has no "absent" status.
    const badContent: WorkspaceCounts["content"] = { status: "absent" };
    const okAsset: WorkspaceCounts["assets"] = { status: "absent" };

    expect(okAsset).toEqual({ status: "absent" });
    void [badCompositions, badMappings, badSitemaps, badContent];
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
      sitemaps: [sitemapRecord("studio", AT(10), [sitemapNode("home", "Home", { kind: "composition", ref: { providerId: "files", recordId: "hero" } }, [sitemapNode("drafts", "Drafts", { kind: "unassigned" })])])],
      assets: [assetSummary("hero-image", AT(11), "image/png", 2048), assetSummary("brochure", AT(1), "application/pdf", 4096), assetSummary("logo", AT(2), "image/png", 512)],
    });
    const summary = createWorkspaceSummary(integration);
    const counts = await summary.counts();

    expect(value(counts.compositions)).toEqual({ compositions: 3, patterns: 1, globalTemplates: 1 });
    expect(value(counts.mappings)).toEqual({ mappings: 2, blockedMappings: 1 });
    expect(value(counts.sitemaps)).toEqual({ sitemaps: 1, pages: 2, unassignedPages: 1 });
    expect(value(counts.content)).toEqual({ models: 1, entries: 2, incompleteEntries: 1 });
    expect(assetValue(counts.assets)).toEqual({ assets: 3, bytes: 6656, byType: { "image/png": 2, "application/pdf": 1 } });
  });

  it("reads sitemaps record by record when the provider is not a collection store", async () => {
    const { integration } = createFakeIntegration({
      sitemapsWithoutReadAll: true,
      sitemaps: [sitemapRecord("studio", AT(3), [sitemapNode("home", "Home", { kind: "unassigned" })])],
    });
    expect(value((await createWorkspaceSummary(integration).counts()).sitemaps)).toEqual({ sitemaps: 1, pages: 1, unassignedPages: 1 });
  });

  it("reports a missing Asset provider as absent rather than zero assets or unavailable", async () => {
    const { integration } = createFakeIntegration({ assets: null });
    const counts = await createWorkspaceSummary(integration).counts();
    expect(counts.assets).toEqual({ status: "absent" });
  });

  it("reports an Assets provider whose store rejects as unavailable, not absent", async () => {
    const { integration } = createFakeIntegration({ assets: new Error("The Asset database is blocked.") });
    const counts = await createWorkspaceSummary(integration).counts();
    expect(counts.assets).toEqual({ status: "unavailable", error: "The Asset database is blocked." });
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
      assets: [assetSummary("hero-image", AT(8), "image/png", 10)],
    });
    const { records, unavailable } = await createWorkspaceSummary(integration).recent();

    expect(unavailable).toEqual([]);
    expect(records.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      "sitemap:studio",
      "asset:hero-image",
      "content-model:journal",
      "mapping:journal",
      "composition:hero",
      "content-entry:first",
    ]);
    expect(records.map(({ href }) => href)).toEqual([
      "/sitemapper?provider=sitemap-filesystem&sitemap=studio",
      "/assets?provider=asset-files&asset=hero-image",
      "/content?provider=content-filesystem&model=journal",
      "/mapping?provider=mapping-filesystem&mapping=journal",
      "/composer",
      "/content?provider=content-filesystem&model=journal&entry=first",
    ]);
    expect(records.find(({ kind }) => kind === "content-entry")?.label).toBe("First article");
  });

  it("honours the limit and reports which sources were omitted", async () => {
    const { integration } = createFakeIntegration({
      compositions: [compositionSummary("hero", AT(5)), compositionSummary("nav", AT(4))],
      mappings: new Error("Mapping storage is unavailable."),
      assets: null,
    });
    const { records, unavailable } = await createWorkspaceSummary(integration).recent(1);

    expect(records.map(({ id }) => id)).toEqual(["hero"]);
    // An absent Asset provider is skipped rather than reported: it is the
    // ordinary dev answer, not a source that failed to be read.
    expect(unavailable).toEqual([{ source: "mappings", error: "Mapping storage is unavailable." }]);
  });

  it("skips an absent Asset source instead of listing it as unavailable", async () => {
    const { integration } = createFakeIntegration({
      compositions: [compositionSummary("hero", AT(5))],
      assets: null,
    });
    const { unavailable } = await createWorkspaceSummary(integration).recent();
    expect(unavailable).toEqual([]);
  });

  it("lists the Assets source that failed to be read as unavailable, unlike an absent one", async () => {
    const { integration } = createFakeIntegration({ assets: new Error("The Asset database is blocked.") });
    const { unavailable } = await createWorkspaceSummary(integration).recent();
    expect(unavailable).toEqual([{ source: "assets", error: "The Asset database is blocked." }]);
  });

  it("keeps the newest record first at any limit, across sources", async () => {
    const { integration } = createFakeIntegration({
      compositions: [compositionSummary("hero", AT(5))],
      assets: [assetSummary("hero-image", AT(8), "image/png", 10)],
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
      { kind: "blocked-mapping", id: "about", label: "Mapping about", detail: "The referenced Composition was not found.", href: "/mapping?provider=mapping-filesystem&mapping=about" },
      { kind: "blocked-mapping", id: "ghost", label: "Mapping ghost", detail: "This Mapping record was not found.", href: "/mapping?provider=mapping-filesystem&mapping=ghost" },
    ]);
    expect(value(attention.sitemaps)).toEqual([{
      kind: "unassigned-page",
      id: "home",
      label: "Home",
      detail: '"Sitemap studio" has a page with no Composition or Mapping source.',
      href: "/sitemapper?provider=sitemap-filesystem&sitemap=studio&page=home",
      intent: { route: "sitemapper", providerId: "sitemap-filesystem", sitemapId: "studio", pageId: "home" },
    }]);
    expect(value(attention.content)).toEqual([{
      kind: "incomplete-entry",
      id: "second",
      label: "second",
      detail: "Heading is required.",
      href: "/content?provider=content-filesystem&model=journal&entry=second",
      intent: { route: "content", providerId: "content-filesystem", modelId: "journal", entryId: "second" },
    }]);
  });

  it("falls back to the Sitemap intent when a page id cannot appear in a URL", async () => {
    const { integration } = createFakeIntegration({
      sitemaps: [sitemapRecord("studio", AT(3), [sitemapNode("Page One", "Home", { kind: "unassigned" })])],
    });
    const attention = await createWorkspaceSummary(integration).attention();
    expect(value(attention.sitemaps)[0]).toMatchObject({ href: "/sitemapper?provider=sitemap-filesystem&sitemap=studio", intent: { route: "sitemapper", providerId: "sitemap-filesystem", sitemapId: "studio" } });
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
      assets: [assetSummary("hero-image", AT(8), "image/png", 10)],
    });
    const counts = await createWorkspaceSummary(integration).counts();

    expect(counts.compositions).toEqual({ status: "unavailable", error: "Compositions in Project files could not be listed: Composition storage is unavailable." });
    expect(counts.sitemaps).toEqual({ status: "unavailable", error: "Sitemap storage is unavailable." });
    expect(value(counts.mappings)).toEqual({ mappings: 1, blockedMappings: 0 });
    expect(value(counts.content)).toEqual({ models: 1, entries: 0, incompleteEntries: 0 });
    expect(assetValue(counts.assets)).toEqual({ assets: 1, bytes: 10, byType: { "image/png": 1 } });
  });

  it("keeps Asset readable when provider initialization fails", async () => {
    const { integration, initialize } = createFakeIntegration({
      initialize: async () => ({ status: "error", error: new Error("The active SiteProject could not be initialized.") }),
      assets: [assetSummary("hero-image", AT(8), "image/png", 10)],
    });
    const counts = await createWorkspaceSummary(integration).counts();

    for (const source of [counts.compositions, counts.mappings, counts.sitemaps, counts.content]) {
      expect(source).toEqual({ status: "unavailable", error: "The active SiteProject could not be initialized." });
    }
    expect(assetValue(counts.assets)).toEqual({ assets: 1, bytes: 10, byType: { "image/png": 1 } });
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("reports a failing Mapping provider instead of an undercount", async () => {
    const { integration } = createFakeIntegration();
    const failing: WorkspaceSummaryIntegration = {
      ...integration,
      mappingCatalog: { ...integration.mappingCatalog, list: async () => ({ status: "listed", entries: [], failures: [{ providerId: "mapping-filesystem", providerLabel: "Browser storage", reason: "The database is blocked." }] }) },
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


describe("canonical Composition summary inventory", () => {
  const token = "a".repeat(64);
  it("reads metadata and Mapping diagnostics without derived list/get while a preview owns admission", async () => {
    const { integration } = createFakeIntegration({ models: [contentModel("journal", AT(1))], mappings: [mappingEntry("hero-map", AT(1))], mappingRecords: { "hero-map": mappingRecord("hero-map") } });
    // The derived continuation is not safe to retry during exact preview capture.
    const busy = Object.assign(new Error("Native editing is reconciling browser state. Input is retained; retry after it settles."), { code: "authoring-busy" });
    integration.compositionProviders[0]!.store.list = vi.fn(async () => { throw busy; });
    integration.mappingCompositionCatalog.resolve = vi.fn(async () => { throw busy; });
    const snapshot = vi.fn(async () => ({ mutationToken: token, records: [compositionRecord("hero")] }));
    integration.compositionProviders[0]!.store.snapshot = snapshot;
    const summary = createWorkspaceSummary(integration);
    const counts = await summary.counts();
    expect(value(counts.compositions)).toEqual({ compositions: 1, patterns: 0, globalTemplates: 0 });
    expect(value(counts.mappings)).toEqual({ mappings: 1, blockedMappings: 0 });
    expect((await summary.recent()).records.some(r => r.id === "hero")).toBe(true);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(integration.compositionProviders[0]!.store.list).not.toHaveBeenCalled();
    expect(integration.mappingCompositionCatalog.resolve).not.toHaveBeenCalled();
    // Same stores still retain their original editor behavior; no fake JSX success.
    await expect(integration.compositionProviders[0]!.store.list()).rejects.toBe(busy);
  });

  it("uses exact provider identity for duplicate IDs and preserves missing source diagnostics", async () => {
    const mapping = mappingRecord("hero-map");
    Object.assign(mapping.document.composition, { providerId: "browser" });
    const { integration } = createFakeIntegration({ models: [contentModel("journal", AT(1))], mappings: [mappingEntry("hero-map", AT(1))], mappingRecords: { "hero-map": mapping } });
    integration.compositionProviders[0]!.store.snapshot = async () => ({ mutationToken: token, records: [compositionRecord("hero")] });
    const other = { descriptor: { id: "browser", label: "Other" }, store: { list: vi.fn(async () => []), snapshot: vi.fn(async () => ({ mutationToken: token, records: [] as CompositionRecord[] })) } };
    const scoped = { ...integration, compositionProviders: [...integration.compositionProviders, other] };
    const summary = createWorkspaceSummary(scoped);
    expect(value((await summary.counts()).mappings).blockedMappings).toBe(1);
    other.store.snapshot.mockResolvedValue({ mutationToken: "b".repeat(64), records: [compositionRecord("hero")] });
    summary.refresh();
    expect(value((await summary.counts()).mappings).blockedMappings).toBe(0);
  });

  it("surfaces invalid/failed inventory without falling back to derived work", async () => {
    const { integration } = createFakeIntegration({ models: [contentModel("journal", AT(1))], mappings: [mappingEntry("hero-map", AT(1))], mappingRecords: { "hero-map": mappingRecord("hero-map") } });
    const list = vi.spyOn(integration.compositionProviders[0]!.store, "list");
    integration.compositionProviders[0]!.store.snapshot = async () => ({ mutationToken: "", records: [] });
    const summary = createWorkspaceSummary(integration);
    expect((await summary.counts()).compositions.status).toBe("unavailable");
    expect(value((await summary.counts()).mappings).blockedMappings).toBe(1);
    expect(list).not.toHaveBeenCalled();
    integration.compositionProviders[0]!.store.snapshot = async () => { throw new Error("snapshot offline"); };
    summary.refresh();
    expect((await summary.counts()).compositions.status).toBe("unavailable");
    expect(list).not.toHaveBeenCalled();
  });

  it("does not let an old pending snapshot repopulate the refreshed cache", async () => {
    const { integration } = createFakeIntegration();
    let finish!: (value: { mutationToken: string; records: CompositionRecord[] }) => void;
    const old = new Promise<{ mutationToken: string; records: CompositionRecord[] }>(resolve => { finish = resolve; });
    const snapshot = vi.fn().mockReturnValueOnce(old).mockResolvedValue({ mutationToken: "b".repeat(64), records: [compositionRecord("fresh")] });
    integration.compositionProviders[0]!.store.snapshot = snapshot;
    const summary = createWorkspaceSummary(integration);
    const first = summary.counts();
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1));
    summary.refresh();
    expect(value((await summary.counts()).compositions).compositions).toBe(1);
    finish({ mutationToken: token, records: [] }); await first;
    expect(value((await summary.counts()).compositions).compositions).toBe(1);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("invalidates canonical inventory after a real Composition persistence notification", async () => {
    const { integration } = createFakeIntegration(); let changed!: (channel: string) => void;
    integration.subscribeChanges = listener => { changed = listener; return () => {}; };
    const snapshot = vi.fn().mockResolvedValueOnce({ mutationToken: token, records: [] }).mockResolvedValue({ mutationToken: "b".repeat(64), records: [compositionRecord("new")] });
    integration.compositionProviders[0]!.store.snapshot = snapshot;
    const summary = createWorkspaceSummary(integration);
    expect(value((await summary.counts()).compositions).compositions).toBe(0);
    changed("compositions:files");
    expect(value((await summary.counts()).compositions).compositions).toBe(1);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
});



it("canonical inventory preserves pattern/global metadata and malformed-record failures", async () => {
  const { integration } = createFakeIntegration();
  const pattern = compositionRecord("pattern"), global = compositionRecord("global");
  pattern.document.publication = { kind: "pattern" };
  global.document.root = [{ id: "stack", componentId: "demo.stack", componentVersion: 1, props: {}, slots: { children: [] } }];
  global.document.publication = { kind: "global-template", outlet: { id: "main", label: "Main", target: { parentId: "stack", slotId: "children" } } };
  const snapshot = vi.fn(async () => ({ mutationToken: "a".repeat(64), records: [pattern, global] }));
  integration.compositionProviders[0]!.store.snapshot = snapshot;
  const summary = createWorkspaceSummary(integration);
  expect(value((await summary.counts()).compositions)).toEqual({ compositions: 2, patterns: 1, globalTemplates: 1 });
  expect((await summary.recent()).records.map(record => record.kind).sort()).toEqual(["global-template", "pattern"]);
  snapshot.mockResolvedValue({ mutationToken: "b".repeat(64), records: [{ ...pattern, document: { ...pattern.document, schemaVersion: -1 } } as unknown as CompositionRecord] });
  summary.refresh(); expect((await summary.counts()).compositions.status).toBe("unavailable");
});


it.each([0, 42, "opaque-provider-token"])("accepts the existing snapshot token contract %s", async mutationToken => {
  const { integration } = createFakeIntegration();
  integration.compositionProviders[0]!.store.snapshot = async () => ({ mutationToken, records: [compositionRecord("hero")] });
  expect(value((await createWorkspaceSummary(integration).counts()).compositions).compositions).toBe(1);
});


describe("canonical Mapping summary batching", () => {
  const token = "mappings-token";
  it("summarizes163 Mappings from one snapshot and resolves each of25 qualified models once", async () => {
    const models = Array.from({ length: 25 }, (_, i) => contentModel(`model-${i}`, AT(1)));
    const records = Array.from({ length: 163 }, (_, i) => {
      const record = mappingRecord(`mapping-${i}`); record.document.contentModel.recordId = `model-${i % 25}`; return record;
    });
    const { integration } = createFakeIntegration({ models });
    const list = vi.spyOn(integration.mappingCatalog, "list");
    const resolve = vi.spyOn(integration.mappingCatalog, "resolve");
    const resolveModel = vi.spyOn(integration.contentCatalog, "resolveModel");
    const snapshot = vi.fn(async () => ({ mutationToken: token, records }));
    const summary = createWorkspaceSummary({ ...integration, mappingProviders: [{ descriptor: { id: "mapping-filesystem", label: "Mappings" }, store: { snapshot } }] });
    expect(value((await summary.counts()).mappings)).toEqual({ mappings: 163, blockedMappings: 0 });
    expect((await summary.recent(200)).records.filter(record => record.kind === "mapping")).toHaveLength(163);
    expect(snapshot).toHaveBeenCalledTimes(1); expect(list).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
    expect(resolveModel).toHaveBeenCalledTimes(25);
    summary.refresh(); await summary.counts();
    expect(snapshot).toHaveBeenCalledTimes(2); expect(resolveModel).toHaveBeenCalledTimes(50);
  });

  it("preserves missing source diagnostics and falls back only for providers without snapshots", async () => {
    const good = mappingRecord("same"), missing = mappingRecord("same", "missing");
    const { integration } = createFakeIntegration({ models: [contentModel("journal", AT(1))] });
    integration.mappingCatalog.list = vi.fn(async () => ({ status: "listed" as const, entries: [{ ...mappingEntry("same", AT(1)), ref: { providerId: "legacy", recordId: "same" } }], failures: [] }));
    integration.mappingCatalog.resolve = vi.fn(async (ref: { providerId: string; recordId: string }) => ref.providerId === "legacy" ? { status: "resolved" as const, record: missing } : { status: "not-found" as const });
    const summary = createWorkspaceSummary({ ...integration, mappingProviders: [
      { descriptor: { id: "mapping-filesystem", label: "Canonical" }, store: { snapshot: async () => ({ mutationToken: token, records: [good] }) } },
      { descriptor: { id: "legacy", label: "Legacy" }, store: {} },
    ] });
    expect(value((await summary.counts()).mappings)).toEqual({ mappings: 2, blockedMappings: 1 });
    expect(integration.mappingCatalog.resolve).toHaveBeenCalledExactlyOnceWith({ providerId: "legacy", recordId: "same" });
    expect(value((await summary.attention()).mappings)).toHaveLength(1);
  });

  it("does not silently fall back after snapshot failure, corruption or duplicate providers", async () => {
    const { integration } = createFakeIntegration(); const list = vi.spyOn(integration.mappingCatalog, "list");
    const snapshot = vi.fn(async () => { throw new Error("Mapping snapshot unavailable"); });
    const provider = { descriptor: { id: "mapping-filesystem", label: "Mappings" }, store: { snapshot } };
    const failed = createWorkspaceSummary({ ...integration, mappingProviders: [provider] });
    expect((await failed.counts()).mappings.status).toBe("unavailable"); expect(list).not.toHaveBeenCalled();
    const duplicate = createWorkspaceSummary({ ...integration, mappingProviders: [provider, provider] });
    expect((await duplicate.counts()).mappings.status).toBe("unavailable"); expect(snapshot).toHaveBeenCalledTimes(1);
    const bad = createWorkspaceSummary({ ...integration, mappingProviders: [{ ...provider, store: { snapshot: async () => ({ mutationToken: token, records: [mappingRecord("duplicate"), mappingRecord("duplicate")] }) } }] });
    expect((await bad.counts()).mappings.status).toBe("unavailable"); expect(list).not.toHaveBeenCalled();
  });

  it("retains snapshot on Content changes while recomputing model diagnostics; Mapping change refreshes inventory", async () => {
    const { integration } = createFakeIntegration({ models: [contentModel("journal", AT(1))] });
    let changed!: (channel: string) => void; integration.subscribeChanges = listener => { changed = listener; return () => {}; };
    const snapshot = vi.fn(async () => ({ mutationToken: token, records: [mappingRecord("hero-map")] }));
    const model = vi.spyOn(integration.contentCatalog, "resolveModel");
    const summary = createWorkspaceSummary({ ...integration, mappingProviders: [{ descriptor: { id: "mapping-filesystem", label: "Mappings" }, store: { snapshot } }] });
    await summary.counts(); changed("content"); await summary.counts();
    expect(snapshot).toHaveBeenCalledTimes(1); expect(model).toHaveBeenCalledTimes(2);
    changed("mapping"); await summary.counts(); expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("cannot repopulate refreshed Mapping cache from an old in-flight snapshot", async () => {
    const { integration } = createFakeIntegration(); let finish!: (snapshot: { mutationToken: string; records: MappingRecord[] }) => void;
    const pending = new Promise<{ mutationToken: string; records: MappingRecord[] }>(resolve => { finish = resolve; });
    const snapshot = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ mutationToken: "fresh", records: [] });
    const summary = createWorkspaceSummary({ ...integration, mappingProviders: [{ descriptor: { id: "mapping-filesystem", label: "Mappings" }, store: { snapshot } }] });
    const old = summary.counts(); await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1));
    summary.refresh(); expect(value((await summary.counts()).mappings).mappings).toBe(0);
    finish({ mutationToken: token, records: [mappingRecord("old")] }); await old;
    expect(value((await summary.counts()).mappings).mappings).toBe(0); expect(snapshot).toHaveBeenCalledTimes(2);
  });
});


it("Mapping model memo does not merge identical record IDs from different Content providers", async () => {
  const first = mappingRecord("first"), second = mappingRecord("second");
  Object.assign(second.document.contentModel, { providerId: "foreign-content" });
  const { integration } = createFakeIntegration({ mappings: [mappingEntry("first", AT(1)), mappingEntry("second", AT(1))], mappingRecords: { first, second } });
  integration.contentCatalog.resolveModel = vi.fn(async (ref: { providerId: string; recordId: string }) => ref.providerId === "content-filesystem" ? { status: "resolved" as const, record: contentModel("journal", AT(1)) } : { status: "not-found" as const });
  const summary = createWorkspaceSummary(integration);
  expect(value((await summary.counts()).mappings)).toEqual({ mappings: 2, blockedMappings: 1 });
  expect(integration.contentCatalog.resolveModel).toHaveBeenCalledTimes(2);
  expect(integration.contentCatalog.resolveModel).toHaveBeenCalledWith({ providerId: "foreign-content", recordId: "journal" });
});


it("preserves native Mapping date/id order and configured mixed provider attention order", async () => {
  const { integration } = createFakeIntegration({ models: [contentModel("journal", AT(1))] });
  const records = [mappingRecord("old", "missing"), mappingRecord("z-tie", "missing"), mappingRecord("a-tie", "missing")];
  records[1]!.updatedAt = AT(3); records[2]!.updatedAt = AT(3);
  const legacy = ["legacy-z", "legacy-a"].map(id => ({ ...mappingEntry(id, AT(5)), ref: { providerId: "legacy", recordId: id } }));
  integration.mappingCatalog.list = vi.fn(async () => ({ status: "listed" as const, entries: legacy, failures: [] }));
  integration.mappingCatalog.resolve = vi.fn(async () => ({ status: "not-found" as const }));
  const canonical = { descriptor: { id: "mapping-filesystem", label: "Canonical" }, store: { snapshot: async () => ({ mutationToken: "token", records }) } };
  const fallback = { descriptor: { id: "legacy", label: "Legacy" }, store: {} };
  const first = createWorkspaceSummary({ ...integration, mappingProviders: [canonical, fallback] });
  expect(value((await first.attention()).mappings).map(item => item.id)).toEqual(["a-tie", "z-tie", "old", "legacy-z", "legacy-a"]);
  const second = createWorkspaceSummary({ ...integration, mappingProviders: [fallback, canonical] });
  expect(value((await second.attention()).mappings).map(item => item.id)).toEqual(["legacy-z", "legacy-a", "a-tie", "z-tie", "old"]);
  expect(records.map(record => record.id)).toEqual(["old", "z-tie", "a-tie"]);
});

describe("Content summary coherent inventory", () => {
 it("uses one readAll per refresh and keeps exact counts, labels and completeness diagnostics",async()=>{
  const model=contentModel("journal",AT(1)),entries=[contentEntry("complete",AT(2),{heading:"Title",count:2}),contentEntry("incomplete",AT(3),{})];
  const {integration,scanEntries}=createFakeIntegration({models:[model]});const readAll=vi.fn(async()=>({providerId:"content-filesystem",mutationToken:8,models:[model],entries}));Object.assign(integration.contentProvider.store,{readAll});const list=vi.spyOn(integration.contentProvider.store,"listModels");
  const summary=createWorkspaceSummary(integration);expect(value((await summary.counts()).content)).toEqual({models:1,entries:2,incompleteEntries:1});const attention=value((await summary.attention()).content);expect(attention).toHaveLength(1);expect(attention[0]).toMatchObject({id:"incomplete",kind:"incomplete-entry"});expect((await summary.recent()).records.some(r=>r.id==="complete"&&r.label==="Title")).toBe(true);
  expect(readAll).toHaveBeenCalledTimes(1);expect(list).not.toHaveBeenCalled();expect(scanEntries).not.toHaveBeenCalled();summary.refresh();await summary.counts();expect(readAll).toHaveBeenCalledTimes(2);
 });
 it.each(["provider","token","duplicate-model","duplicate-entry","future","semantic","failure","null","undefined"])("keeps %s inventory unavailable without per-model fallback",async(problem)=>{
  const model=contentModel("journal",AT(1)),entry=contentEntry("entry",AT(2),{heading:"Title"});const captured={providerId:"content-filesystem",mutationToken:8,models:[model],entries:[entry]};
  if(problem==="provider")captured.providerId="foreign";if(problem==="token")captured.mutationToken=-1;if(problem==="duplicate-model")captured.models.push(model);if(problem==="duplicate-entry")captured.entries.push(entry);if(problem==="future")model.document.schemaVersion=999 as never;if(problem==="semantic")entry.values.count="wrong";
  const {integration,scanEntries}=createFakeIntegration({models:[model]});Object.assign(integration.contentProvider.store,{readAll:async()=>{if(problem==="failure")throw new Error("offline");if(problem==="null")return null;if(problem==="undefined")return undefined;return captured;}});const list=vi.spyOn(integration.contentProvider.store,"listModels");expect((await createWorkspaceSummary(integration).counts()).content.status).toBe("unavailable");expect(list).not.toHaveBeenCalled();expect(scanEntries).not.toHaveBeenCalled();
 });
 it("does not repopulate an invalidated cache when an earlier read settles late",async()=>{
  const model=contentModel("journal",AT(1));const old={providerId:"content-filesystem",mutationToken:1,models:[model],entries:[]},fresh={...old,mutationToken:2,entries:[contentEntry("new",AT(2),{heading:"New"})]};let release!:(snapshot:typeof fresh)=>void;const pending=new Promise<typeof fresh>(r=>{release=r;});let changed!:(channel?:string)=>void;
  const {integration}=createFakeIntegration();integration.subscribeChanges=listener=>{changed=listener;return()=>{};};const readAll=vi.fn().mockImplementationOnce(()=>pending).mockResolvedValue(fresh);Object.assign(integration.contentProvider.store,{readAll});const summary=createWorkspaceSummary(integration);const first=summary.counts();await vi.waitFor(()=>expect(readAll).toHaveBeenCalledTimes(1));changed("content");expect(value((await summary.counts()).content).entries).toBe(1);release(old);await first;expect(value((await summary.counts()).content).entries).toBe(1);expect(readAll).toHaveBeenCalledTimes(2);
 });
});

it("snapshot summary retains listed-model scope and exact fallback diagnostics/order",async()=>{
 const model=contentModel("journal",AT(1)),entries=[contentEntry("complete",AT(2),{heading:"Title"}),contentEntry("incomplete",AT(3),{})];
 const diagnostics=entries.flatMap(entry=>diagnoseContentEntryCompleteness(model,entry));
 const make=()=>createFakeIntegration({models:[model],entries:{journal:{count:2,entries:[entries[1]!,entries[0]!],diagnostics}}});
 const legacy=make(),batched=make();const orphan={...contentEntry("orphan",AT(4),{}),modelId:"absent"};Object.assign(batched.integration.contentProvider.store,{readAll:async()=>({providerId:"content-filesystem",mutationToken:2,models:[model],entries:[...entries,orphan]})});
 const expected=createWorkspaceSummary(legacy.integration),actual=createWorkspaceSummary(batched.integration);
 expect((await actual.counts()).content).toEqual((await expected.counts()).content);expect((await actual.attention()).content).toEqual((await expected.attention()).content);expect((await actual.recent()).records).toEqual((await expected.recent()).records);
});

it("retries failed Content inventory only after refresh, with no scan fallback",async()=>{
 const {integration,scanEntries}=createFakeIntegration();const readAll=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({providerId:"content-filesystem",mutationToken:1,models:[],entries:[]});Object.assign(integration.contentProvider.store,{readAll});const summary=createWorkspaceSummary(integration);
 expect((await summary.counts()).content).toEqual({status:"unavailable",error:"offline"});expect((await summary.attention()).content).toEqual({status:"unavailable",error:"offline"});expect(readAll).toHaveBeenCalledTimes(1);expect(scanEntries).not.toHaveBeenCalled();summary.refresh();expect((await summary.counts()).content.status).toBe("ok");expect(readAll).toHaveBeenCalledTimes(2);
});
