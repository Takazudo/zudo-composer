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
import {
  createInitializedCompositionCatalog,
  createProductionProviderIntegration,
  createProductionSampleDocument,
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
          ref: { providerId: "indexeddb", recordId: expect.stringMatching(/^composition-/) },
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
