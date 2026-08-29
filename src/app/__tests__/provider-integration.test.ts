import { IDBFactory as FDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import {
  COMPOSITION_PROVIDERS,
  createIndexedDbCompositionProvider,
  diagnoseDocument,
  generateJsx,
  isStructurallyValidDocument,
  traverse,
  traversalOrder,
  type CompositionProvider,
} from "../../composer/browser";
import { activeComponentProvider } from "../../features/composer/active-pack";
import { resolveMappingDefinition } from "../../mapping";
import {
  createInitializedCompositionCatalog,
  createProductionProviderIntegration,
  createProductionSampleDocument,
  PRODUCTION_SEED_IDS,
  PRODUCTION_SEED_TIMESTAMP,
} from "../provider-integration";

describe("production provider integration", () => {
  it("shares one active provider, seeded record, and Composer store with the Sitemapper catalog", async () => {
    vi.stubGlobal("indexedDB", new FDBFactory());
    try {
      const integration = createProductionProviderIntegration();
      expect(integration.componentProvider).toBe(activeComponentProvider);
      expect(integration.compositionProviders.map(({ descriptor }) => descriptor.id)).toEqual(["indexeddb"]);

      const listed = await integration.compositionCatalog.listCompositions();
      expect(listed).toMatchObject({
        failures: [],
        entries: [{
          ref: { providerId: "indexeddb", recordId: PRODUCTION_SEED_IDS.composition },
          name: "Product overview",
        }],
      });
      const ref = listed.entries[0]!.ref;
      const [resolved, loaded] = await Promise.all([
        integration.compositionCatalog.resolveComposition(ref),
        integration.compositionProviders[0]!.store.get(ref.recordId),
      ]);
      expect(resolved.status).toBe("resolved");
      expect(loaded.status).toBe("loaded");
      if (resolved.status === "resolved" && loaded.status === "loaded") {
        expect(resolved.record).toEqual(loaded.record);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stages deterministic Content and Mapping seeds and recreates resolvable refs after every startFresh", async () => {
    const factory = new FDBFactory();
    const integration = createProductionProviderIntegration({ compositionIdbFactory: factory, contentIdbFactory: factory, mappingIdbFactory: factory });

    const [mappingInitialization, concurrentContent] = await Promise.all([integration.mappingProvider.initialization.initialize(), integration.contentCatalog.listModels()]);
    expect(mappingInitialization).toMatchObject({ status: "ready", summaries: [{ id: PRODUCTION_SEED_IDS.mapping }] });
    expect(concurrentContent).toMatchObject({ entries: [{ ref: { recordId: PRODUCTION_SEED_IDS.contentModel } }], failures: [] });
    const contentSnapshot = await integration.contentProvider.store.scanEntries(PRODUCTION_SEED_IDS.contentModel);
    expect(contentSnapshot.model).toMatchObject({ id: PRODUCTION_SEED_IDS.contentModel, createdAt: PRODUCTION_SEED_TIMESTAMP });
    expect(contentSnapshot.entries.map(({ id }) => id).sort()).toEqual([...PRODUCTION_SEED_IDS.entries].sort());
    const sitemapperMappings = await integration.sitemapperMappingCatalog.list();
    expect(sitemapperMappings).toMatchObject({
      failures: [],
      entries: [{ ref: { providerId: "mapping-indexeddb", recordId: PRODUCTION_SEED_IDS.mapping } }],
    });
    const sitemapperMapping = await integration.sitemapperMappingCatalog.routes.resolveMapping({ providerId: "mapping-indexeddb", recordId: PRODUCTION_SEED_IDS.mapping });
    expect(sitemapperMapping).toMatchObject({ status: "resolved", record: { id: PRODUCTION_SEED_IDS.mapping } });
    if (sitemapperMapping.status === "resolved") {
      const snapshot = await integration.sitemapperMappingCatalog.routes.resolveContentSnapshot(sitemapperMapping.record);
      expect(snapshot).toMatchObject({ status: "resolved", model: { id: PRODUCTION_SEED_IDS.contentModel } });
      if (snapshot.status === "resolved") expect(snapshot.snapshot.entries).toHaveLength(PRODUCTION_SEED_IDS.entries.length);
    }
    const assertResolved = async () => {
      const mapping = await integration.mappingCatalog.resolve({ providerId: "mapping-indexeddb", recordId: PRODUCTION_SEED_IDS.mapping });
      expect(mapping).toMatchObject({ status: "resolved", record: { createdAt: PRODUCTION_SEED_TIMESTAMP, document: {
        contentModel: { providerId: "content-indexeddb", recordId: PRODUCTION_SEED_IDS.contentModel },
        composition: { providerId: "indexeddb", recordId: PRODUCTION_SEED_IDS.composition },
        bindings: [
          { sourceFieldId: PRODUCTION_SEED_IDS.titleField, target: { nodeId: "sample-heading", prop: "heading" } },
          { sourceFieldId: PRODUCTION_SEED_IDS.bodyField, target: { nodeId: "sample-prose", prop: "markdown" } },
        ],
      } } });
      expect(await integration.contentCatalog.resolveModel({ providerId: "content-indexeddb", recordId: PRODUCTION_SEED_IDS.contentModel })).toMatchObject({ status: "resolved" });
      expect(await integration.mappingCompositionCatalog.resolve({ providerId: "indexeddb", recordId: PRODUCTION_SEED_IDS.composition })).toMatchObject({ status: "resolved" });
      if (mapping.status === "resolved") expect(await resolveMappingDefinition(mapping.record, { content: integration.contentCatalog, compositions: integration.mappingCompositionCatalog }, activeComponentProvider.catalog)).toMatchObject({ status: "ready", diagnostics: [] });
    };
    await assertResolved();
    expect(await integration.compositionProviders[0]!.initialization.startFresh()).toMatchObject({ status: "ready", summaries: [{ id: PRODUCTION_SEED_IDS.composition }] });
    await assertResolved();
    expect(await integration.contentProvider.initialization.startFresh()).toMatchObject({ status: "ready", models: [{ id: PRODUCTION_SEED_IDS.contentModel }] });
    await assertResolved();
    expect(await integration.mappingProvider.initialization.startFresh()).toMatchObject({ status: "ready", summaries: [{ id: PRODUCTION_SEED_IDS.mapping }] });
    await assertResolved();
  });

  it("leaves Mapping unseeded after a prerequisite failure and seeds it on retry", async () => {
    const backing = new FDBFactory();
    let failOpen = true;
    const flaky = new Proxy(backing, { get(target, property) {
      if (property === "open") return (...args: Parameters<IDBFactory["open"]>) => { if (failOpen) { failOpen = false; throw new Error("composition unavailable"); } return target.open(...args); };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    } }) as IDBFactory;
    const integration = createProductionProviderIntegration({ compositionIdbFactory: flaky, contentIdbFactory: backing, mappingIdbFactory: backing });

    expect(await integration.mappingProvider.initialization.initialize()).toMatchObject({ status: "error", error: { retryable: true } });
    expect(await integration.mappingProvider.store.get(PRODUCTION_SEED_IDS.mapping)).toMatchObject({ status: "not-found" });
    expect(await integration.mappingProvider.initialization.retry()).toMatchObject({ status: "ready", summaries: [{ id: PRODUCTION_SEED_IDS.mapping }] });
    expect(await integration.mappingProvider.store.get(PRODUCTION_SEED_IDS.mapping)).toMatchObject({ status: "loaded" });
  });

  it("builds one valid real-provider sample and deterministic public JSX", () => {
    const document = createProductionSampleDocument();
    expect(isStructurallyValidDocument(document)).toBe(true);
    const diagnostics = diagnoseDocument(document, activeComponentProvider.catalog);
    expect(diagnostics).toMatchObject({ opaqueIds: [], hasOpaque: false, canExport: true, reuseReasons: [] });
    const componentIds: string[] = [];
    traverse(document, activeComponentProvider.catalog, (node) => componentIds.push(node.componentId));
    expect(componentIds).toEqual([
      "ui.container", "ui.section-heading", "ui.prose-md", "ui.split-layout",
      "ui.card", "ui.placeholder-box", "ui.cta-button", "ui.auto-grid",
    ]);

    const split = document.root[0]!.slots.content![2]!;
    expect(split.componentId).toBe("ui.split-layout");
    expect(split.slots.left).toHaveLength(1);
    expect(split.slots.right).toHaveLength(2);

    const generated = generateJsx(document, activeComponentProvider.catalog);
    expect(generated).toMatchObject({ ok: true, blocked: false });
    expect(generated.code).toContain('from "@zudo-sg/ui"');
    expect(generated.emittedNodeOrder).toEqual(traversalOrder(document, activeComponentProvider.catalog));
  });

  it("seeds IndexedDB when Sitemapper opens first without suppressing another provider failure", async () => {
    const browser = createIndexedDbCompositionProvider({
      initialDocument: createProductionSampleDocument,
      idbFactory: new FDBFactory(),
      idFactory: () => "zudo-composer-sample",
      now: () => "2026-08-29T00:00:00.000Z",
    });
    const recoveryInitialize = vi.fn(async () => ({
      status: "recovery-required" as const,
      recovery: {
        kind: "quarantined" as const,
        reason: "malformed" as const,
        sourcePreserved: true as const,
        message: "Preserved malformed data.",
      },
    }));
    const recovery = {
      descriptor: COMPOSITION_PROVIDERS.files,
      store: {
        provider: COMPOSITION_PROVIDERS.files,
        list: async () => { throw new Error("Recovery required"); },
        get: async () => ({ status: "not-found", id: "missing" }),
      },
      initialization: {
        initialize: recoveryInitialize,
        retry: recoveryInitialize,
        startFresh: recoveryInitialize,
      },
    } as unknown as CompositionProvider;

    const catalog = createInitializedCompositionCatalog([browser, recovery]);
    const outcome = await catalog.listCompositions();
    expect(outcome.entries).toEqual([
      expect.objectContaining({
        ref: { providerId: "indexeddb", recordId: "zudo-composer-sample" },
        name: "Product overview",
      }),
    ]);
    expect(outcome.failures).toEqual([
      expect.objectContaining({ providerId: "files", reason: "Recovery required" }),
    ]);
    expect(recoveryInitialize).toHaveBeenCalledTimes(1);
  });
});
