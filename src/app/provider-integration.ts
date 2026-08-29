import {
  COMPOSITION_SCHEMA_VERSION,
  CompositionPersistenceError,
  createFileProviderCompositionStore,
  createIndexedDbCompositionProvider,
  type CompositionDocument,
  type CompositionInitializationOutcome,
  type CompositionProvider,
  type CompositionStore,
} from "../composer/browser";
import { activeComponentProvider } from "../features/composer/active-pack";
import { createCompositionCatalog, type CompositionCatalog } from "../sitemapper/catalog";

export function createProductionSampleDocument(): CompositionDocument {
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    id: "zudo-composer-sample",
    name: "Product overview",
    root: [{
      id: "sample-container",
      componentId: "ui.container",
      componentVersion: 1,
      props: {},
      slots: { content: [
        {
          id: "sample-heading",
          componentId: "ui.section-heading",
          componentVersion: 1,
          props: { eyebrow: "Product", heading: "Build a clear product story", intro: "Compose responsive sections with the real UI provider.", as: "h1" },
          slots: {},
        },
        {
          id: "sample-prose",
          componentId: "ui.prose-md",
          componentVersion: 1,
          props: { markdown: "## A real provider composition\n\nEdit this **markdown** and keep the component contract explicit.\n\n```ts\nconst ready = true;\n```" },
          slots: {},
        },
        {
          id: "sample-split",
          componentId: "ui.split-layout",
          componentVersion: 1,
          props: { ratio: "40/60", gap: "md" },
          slots: {
            left: [{
              id: "sample-card",
              componentId: "ui.card",
              componentVersion: 1,
              props: { title: "Visual foundation", variant: "accent", padding: "md" },
              slots: { body: [{
                id: "sample-placeholder",
                componentId: "ui.placeholder-box",
                componentVersion: 1,
                props: { label: "product-preview.png", aspect: "4/3", size: "md" },
                slots: {},
              }] },
            }],
            right: [
              {
                id: "sample-cta",
                componentId: "ui.cta-button",
                componentVersion: 1,
                props: { href: "/products", variant: "primary", arrow: true, children: "Browse products" },
                slots: {},
              },
              {
                id: "sample-grid",
                componentId: "ui.auto-grid",
                componentVersion: 1,
                props: { min: "15rem", fill: false, gap: "md" },
                slots: { items: [] },
              },
            ],
          },
        },
      ] },
    }],
  };
}

function initializationError(reason: unknown): CompositionInitializationOutcome {
  return {
    status: "error",
    error: reason instanceof CompositionPersistenceError
      ? reason
      : new CompositionPersistenceError(
          "initialize",
          "unknown",
          reason instanceof Error ? reason.message : "Composition storage initialization failed.",
          true,
          { cause: reason },
        ),
  };
}

function providerFromStore(store: CompositionStore): CompositionProvider {
  const initialize = async (): Promise<CompositionInitializationOutcome> => {
    try {
      return { status: "ready", summaries: await store.list() };
    } catch (reason) {
      return initializationError(reason);
    }
  };
  return {
    descriptor: store.provider,
    store,
    initialization: { initialize, retry: initialize, startFresh: initialize },
  };
}

export function createProductionComposerProviders(): readonly CompositionProvider[] {
  const providers: CompositionProvider[] = [
    createIndexedDbCompositionProvider({ initialDocument: createProductionSampleDocument }),
  ];
  const fileStore = createFileProviderCompositionStore({ catalog: activeComponentProvider.catalog });
  if (fileStore) providers.push(providerFromStore(fileStore));
  return providers;
}

export function createInitializedCompositionCatalog(providers: readonly CompositionProvider[]): CompositionCatalog {
  const catalog = createCompositionCatalog(providers);
  let initialization: Promise<void> | null = null;
  const ensureInitialized = (): Promise<void> => {
    // Seed unopened providers before Sitemapper lists them, but preserve the
    // catalog's per-provider failure isolation: one recovery/error result must
    // never suppress entries from healthy providers.
    initialization ??= Promise.allSettled(
      providers.map((provider) => provider.initialization.initialize()),
    ).then(() => undefined);
    return initialization;
  };
  return {
    listCompositions: async () => { await ensureInitialized(); return catalog.listCompositions(); },
    resolveComposition: async (ref) => { await ensureInitialized(); return catalog.resolveComposition(ref); },
  };
}

export interface ProductionProviderIntegration {
  componentProvider: typeof activeComponentProvider;
  compositionProviders: readonly CompositionProvider[];
  compositionCatalog: CompositionCatalog;
}

export function createProductionProviderIntegration(): ProductionProviderIntegration {
  const compositionProviders = createProductionComposerProviders();
  return Object.freeze({
    componentProvider: activeComponentProvider,
    compositionProviders,
    compositionCatalog: createInitializedCompositionCatalog(compositionProviders),
  });
}
