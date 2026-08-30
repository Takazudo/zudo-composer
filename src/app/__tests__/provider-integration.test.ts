import { IDBFactory as FDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { COMPOSITION_PROVIDERS, createIndexedDbCompositionProvider, summarizeComposition, type CompositionProvider, type CompositionRecord } from "../../composer/browser";
import { CONTENT_DATABASE_NAME, CONTENT_DATABASE_VERSION } from "../../content/storage/indexeddb/types";
import { createIndexedDbSitemapProvider } from "../../sitemapper/storage/indexeddb/provider";
import { compileSiteProject } from "../../site-project/compiler";
import { loadSampleSiteProject } from "../../site-project/sample";
import { activeComponentProvider } from "../../features/composer/active-pack";
import { activeSiteProjectValidationContext } from "../site-project-manifest";
import { createProductionProviderIntegration } from "../provider-integration";

const sample = () => loadSampleSiteProject(activeSiteProjectValidationContext);
const integration = (factories = { composition: new FDBFactory(), content: new FDBFactory(), mapping: new FDBFactory(), sitemap: new FDBFactory() }) => createProductionProviderIntegration({
  project: sample(), compositionIdbFactory: factories.composition, contentIdbFactory: factories.content, mappingIdbFactory: factories.mapping, sitemapIdbFactory: factories.sitemap,
});

function failFirstOpen(backing: IDBFactory): IDBFactory {
  let fail = true;
  return new Proxy(backing, { get(target, property) { if (property === "open") return (...args: Parameters<IDBFactory["open"]>) => { if (fail) { fail = false; throw new Error("injected open failure"); } return target.open(...args); }; const value = Reflect.get(target, property, target) as unknown; return typeof value === "function" ? value.bind(target) : value; } }) as IDBFactory;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}

function fileProvider(records: readonly CompositionRecord[]): CompositionProvider {
  const byId = new Map(records.map((record) => [record.id, structuredClone(record)]));
  const ready = async () => ({ status: "ready" as const, summaries: [...byId.values()].map(summarizeComposition) });
  return {
    descriptor: COMPOSITION_PROVIDERS.files,
    store: {
      provider: COMPOSITION_PROVIDERS.files,
      list: async () => [...byId.values()].map(summarizeComposition),
      get: async (id) => { const record = byId.get(id); return record ? { status: "loaded" as const, record: structuredClone(record) } : { status: "not-found" as const, id }; },
      put: async (record) => { byId.set(record.id, structuredClone(record)); return { canonical: { status: "saved" as const }, derived: { status: "current" as const, records: [] } }; },
      delete: async (id) => byId.delete(id),
      clear: async () => { byId.clear(); },
    },
    initialization: { initialize: ready, retry: ready, startFresh: ready },
  };
}

describe("SiteProject provider integration", () => {
  it("seeds the exact provider graph and compiles the provider-backed snapshot to seven routes", async () => {
    const current = integration();
    expect((await current.compositionCatalog.listCompositions()).entries).toHaveLength(6);
    expect(await current.initialization.initialize()).toEqual({ status: "ready" });
    const snapshot = await current.getCurrentSiteProject();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status !== "ready") return;
    expect(snapshot.project.providers.compositions[0]!.records).toHaveLength(6);
    expect(snapshot.project.providers.content[0]!.models).toHaveLength(2);
    expect(snapshot.project.providers.content[0]!.entries).toHaveLength(4);
    expect(snapshot.project.providers.mappings[0]!.records).toHaveLength(2);
    expect(snapshot.project.providers.sitemaps[0]!.records).toHaveLength(1);
    const compiled = await compileSiteProject(snapshot.project, { componentCatalog: activeComponentProvider.catalog });
    expect(compiled.status).toBe("ready");
    if (compiled.status === "ready") expect(compiled.build.routes).toHaveLength(7);
  });

  it("is idempotent, preserves an authoring edit, and detaches snapshots from the checked-in sample", async () => {
    const current = integration(); await current.initialization.initialize(); await current.initialization.initialize();
    const before = await current.compositionProviders[0]!.store.get("services-page");
    if (before.status !== "loaded") throw new Error("missing seed");
    await current.compositionProviders[0]!.store.put({ ...before.record, updatedAt: "2026-09-01T00:00:00.000Z", document: { ...before.record.document, name: "Edited services" } });
    expect(await current.initialization.retry()).toEqual({ status: "ready" });
    const snapshot = await current.getCurrentSiteProject();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status !== "ready") return;
    expect(snapshot.project.providers.compositions[0]!.records.find(({ id }) => id === "services-page")!.document.name).toBe("Edited services");
    expect(sample().providers.compositions[0]!.records.find(({ id }) => id === "services-page")!.document.name).toBe("Services page");
  });

  it.each(["composition", "content", "mapping", "sitemap"] as const)("recovers a %s phase failure without false readiness", async (phase) => {
    const backing = { composition: new FDBFactory(), content: new FDBFactory(), mapping: new FDBFactory(), sitemap: new FDBFactory() };
    const factories = { ...backing, [phase]: failFirstOpen(backing[phase]) };
    const current = integration(factories);
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { retryable: true } });
    expect(await current.initialization.retry()).toEqual({ status: "ready" });
    expect(await current.getCurrentSiteProject()).toMatchObject({ status: "ready" });
  });

  it.each(["composer", "content", "mapping", "sitemapper"] as const)("converges when %s boots first", async (first) => {
    const current = integration();
    const outcome = first === "composer" ? await current.compositionProviders[0]!.initialization.initialize()
      : first === "content" ? await current.contentProvider.initialization.initialize()
        : first === "mapping" ? await current.mappingProvider.initialization.initialize()
          : await current.sitemapProvider.initialization.initialize();
    expect(outcome.status).toBe("ready");
    expect(await current.getCurrentSiteProject()).toMatchObject({ status: "ready" });
  });

  it("serializes destructive startFresh and recreates the complete graph", async () => {
    const current = integration(); await current.initialization.initialize();
    const [fresh, concurrent] = await Promise.all([current.initialization.startFresh(), current.initialization.initialize()]);
    expect(fresh).toEqual({ status: "ready" }); expect(concurrent).toEqual({ status: "ready" });
    const snapshot = await current.getCurrentSiteProject();
    expect(snapshot).toMatchObject({ status: "ready", project: { providers: { compositions: [{ records: expect.arrayContaining([expect.objectContaining({ id: "site-frame" })]) }], sitemaps: [{ records: [expect.objectContaining({ id: "sample-studio-sitemap" })] }] } } });
  });

  it("returns a recoverable unavailable state for a null development source", async () => {
    const current = createProductionProviderIntegration({ project: null, compositionIdbFactory: new FDBFactory(), contentIdbFactory: new FDBFactory(), mappingIdbFactory: new FDBFactory(), sitemapIdbFactory: new FDBFactory() });
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { phase: "source", retryable: true } });
  });

  it("never reaches ready when a Single model seed contains multiple Entries", async () => {
    const invalid = sample(); const content = invalid.providers.content[0]!; const entry = content.entries.find(({ modelId }) => modelId === "about-content")!;
    content.entries.push({ ...structuredClone(entry), id: "about-entry-duplicate" });
    const current = createProductionProviderIntegration({ project: invalid, compositionIdbFactory: new FDBFactory(), contentIdbFactory: new FDBFactory(), mappingIdbFactory: new FDBFactory(), sitemapIdbFactory: new FDBFactory() });
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { phase: "source", retryable: false, message: expect.stringContaining("at most one Entry") } });
  });

  it("preflights static Composition refs before seeding a fresh Sitemap store", async () => {
    const project = sample(); const compositionFactory = new FDBFactory(); const sitemapFactory = new FDBFactory();
    const prior = createIndexedDbCompositionProvider({ idbFactory: compositionFactory, seed: project.providers.compositions[0]!.records });
    expect(await prior.initialization.initialize()).toMatchObject({ status: "ready" });
    expect(await prior.store.delete("services-page")).toBe(true);

    const current = createProductionProviderIntegration({ project, compositionIdbFactory: compositionFactory, contentIdbFactory: new FDBFactory(), mappingIdbFactory: new FDBFactory(), sitemapIdbFactory: sitemapFactory });
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { phase: "sitemap", message: expect.stringContaining("indexeddb:services-page") } });
    expect(await current.sitemapProvider.store.list()).toEqual([]);
  });

  it("preflights provider-qualified Mapping refs in an existing live Sitemap", async () => {
    const project = sample(); const sitemapFactory = new FDBFactory();
    const live = structuredClone(project.providers.sitemaps[0]!.records[0]!);
    const about = live.document.root[0]!.children.find(({ id }) => id === "about-node")!;
    if (about.source.kind !== "mapping") throw new Error("expected Mapping source");
    about.source.ref.recordId = "missing-mapping";
    const prior = createIndexedDbSitemapProvider({ idbFactory: sitemapFactory, seed: [live] });
    expect(await prior.initialization.initialize()).toMatchObject({ status: "ready" });
    const current = createProductionProviderIntegration({ project, compositionIdbFactory: new FDBFactory(), contentIdbFactory: new FDBFactory(), mappingIdbFactory: new FDBFactory(), sitemapIdbFactory: sitemapFactory });
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { phase: "sitemap", message: expect.stringContaining("mapping-indexeddb:missing-mapping") } });
  });

  it("exposes and snapshots exactly the declared Composition provider set", async () => {
    const availableUndeclared = fileProvider([]);
    const ordinary = createProductionProviderIntegration({ project: sample(), fileCompositionProvider: availableUndeclared, compositionIdbFactory: new FDBFactory(), contentIdbFactory: new FDBFactory(), mappingIdbFactory: new FDBFactory(), sitemapIdbFactory: new FDBFactory() });
    expect(ordinary.compositionProviders.map(({ descriptor }) => descriptor.id)).toEqual(["indexeddb"]);

    const declared = sample();
    const fileRecord = structuredClone(declared.providers.compositions[0]!.records.find(({ id }) => id === "services-page")!);
    fileRecord.id = "file-page"; fileRecord.document.id = "file-page"; delete fileRecord.document.binding;
    declared.providers.compositions.push({ id: "files", records: [fileRecord] });
    declared.providers.sitemaps[0]!.records[0]!.document.root[0]!.children.push({ id: "file-page-node", title: "File page", slug: "file", source: { kind: "composition", ref: { providerId: "files", recordId: "file-page" } }, children: [] });
    const current = createProductionProviderIntegration({ project: declared, fileCompositionProvider: fileProvider([fileRecord]), compositionIdbFactory: new FDBFactory(), contentIdbFactory: new FDBFactory(), mappingIdbFactory: new FDBFactory(), sitemapIdbFactory: new FDBFactory() });
    expect(current.compositionProviders.map(({ descriptor }) => descriptor.id).sort()).toEqual(declared.providers.compositions.map(({ id }) => id).sort());
    const snapshot = await current.getCurrentSiteProject();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status !== "ready") return;
    expect(snapshot.project.providers.compositions.map(({ id }) => id).sort()).toEqual(declared.providers.compositions.map(({ id }) => id).sort());
    expect(snapshot.project.providers.compositions.find(({ id }) => id === "files")!.records.map(({ id }) => id)).toEqual(["file-page"]);
  });

  it("preserves non-retryable Content version failures through initialize and retry wrappers", async () => {
    const contentFactory = new FDBFactory(); const newer = await request(contentFactory.open(CONTENT_DATABASE_NAME, CONTENT_DATABASE_VERSION + 1)); newer.close();
    const current = createProductionProviderIntegration({ project: sample(), compositionIdbFactory: new FDBFactory(), contentIdbFactory: contentFactory, mappingIdbFactory: new FDBFactory(), sitemapIdbFactory: new FDBFactory() });
    expect(await current.contentProvider.initialization.initialize()).toMatchObject({ status: "error", error: { retryable: false, message: expect.stringContaining("newer") } });
    expect(await current.contentProvider.initialization.retry()).toMatchObject({ status: "error", error: { retryable: false, message: expect.stringContaining("newer") } });
  });
});
