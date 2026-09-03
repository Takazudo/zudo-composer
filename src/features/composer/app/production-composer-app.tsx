"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  cloneJson,
  COMPOSITION_PROVIDERS,
  COMPOSITION_SCHEMA_VERSION,
  createCompositionRecord,
  createCompositionReuseLifecycleService,
  createSaveQueue,
  createCompositionReuseService,
  createUuidIdFactory,
  duplicateCompositionRecord,
  generateBrowserJsxExport,
  isCompositionLifecycleStore,
  resolveGlobalTemplateLoad,
  summarizeComposition,
  type CompositionDocument,
  type ComponentCatalog,
  type CompositionInitializationOutcome,
  type CompositionLoadOutcome,
  type CompositionProvider,
  type CompositionProviderId,
  type CompositionRecord,
  type CompositionRecordRef,
  type CompositionRecoveryOutcome,
  type CompositionSaveOutcome,
  type GlobalTemplateResolutionOutcome,
  type SaveQueue,
  type IdFactory,
  type ReuseConsumerLifecycleOutcome,
} from "../../../composer/browser";
import { parseIntent } from "../../../app/route-intents";
import type { ComposerComponentProvider } from "../active-pack";
import { CompositionLibrary } from "../library";
import type { CompositionLibraryIntents } from "../library";
import {
  COMPOSER_DOCUMENT_PATH,
  createComposerProviderPreference,
  createComposerTransitionCoordinator,
  ComposerTransitionError,
  formatComposerRoute,
  parseComposerRoute,
  type ComposerCommittedState,
  type ComposerDetailSession,
  type ComposerRoute,
  type ComposerRouteConfig,
  type ComposerRouteLocation,
  type ComposerTransitionHistory,
  type ComposerTransitionIntent,
} from "../routing";
import { ComposerIntegration } from "./composer-integration";
import type { ComposerIntegrationProps } from "./composer-integration";
import type { ReuseDependencyCheck } from "../ui/shared/reuse-authoring-contract";

export interface ComposerBrowserNavigation extends ComposerTransitionHistory {
  read(): ComposerRouteLocation;
  subscribe(listener: () => void): () => void;
}

export interface ProductionComposerAppProps {
  /** One validated pack view used by every controller and preview session. */
  componentProvider: ComposerComponentProvider;
  /** Provider injection is a production-integration test seam. */
  providers: readonly CompositionProvider[];
  navigation?: ComposerBrowserNavigation;
  idFactory?: IdFactory;
  nodeIdFactory?: IdFactory;
  now?: () => string;
  /** Existing preview bridge seams, forwarded for focused integration tests. */
  preview?: Pick<ComposerIntegrationProps, "createBridge" | "previewLocation" | "hostWindow">;
  /** Test seam for the `/composer?new=1` route-intent's query string. */
  readIntentSearch?: () => string;
}

interface ProductionDetailSession extends ComposerDetailSession {
  readonly queue: SaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>;
  registerFlushPendingProps(flush: (() => void) | null): void;
}

// The New-dialog adapter needs only the reuse service's catalog/selection
// reads. Its manifest is static trusted provider data; the editor still
// owns the single live manifest derivation passed to its controller.
function emptyCompositionDocument(
  name: string,
  source?: { sourceRecordId: string; outletId: string },
): CompositionDocument {
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    id: "",
    name,
    root: [],
    ...(source ? { binding: source } : {}),
  };
}

/** Translate the provider reuse service result into the editor's small UI contract. */
async function publicationDependencies(
  provider: CompositionProvider | undefined,
  sourceRecordId: string,
  manifest: ComponentCatalog,
): Promise<ReuseDependencyCheck> {
  if (!provider) {
    return {
      status: "unavailable",
      message: "The current Composition provider is unavailable.",
    };
  }
  const outcome = await createCompositionReuseService(provider.store, manifest).listDependents(sourceRecordId);
  return outcome.status === "listed"
    ? { status: "ready", dependentCount: outcome.dependents.length }
    : outcome;
}

function lifecycleOutcomeMessage(outcome: Exclude<ReuseConsumerLifecycleOutcome, { status: "detached" }>): string {
  if (outcome.status === "not-found") {
    return "This Composition no longer exists in the active provider.";
  }
  return outcome.message;
}

function browserNavigation(): ComposerBrowserNavigation {
  return {
    read: () => ({ pathname: window.location.pathname, hash: window.location.hash }),
    push: (url) => window.history.pushState(null, "", url),
    replace: (url) => window.history.replaceState(null, "", url),
    subscribe: (listener) => {
      let scheduled = false;
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          listener();
        });
      };
      window.addEventListener("hashchange", schedule);
      window.addEventListener("popstate", schedule);
      return () => {
        window.removeEventListener("hashchange", schedule);
        window.removeEventListener("popstate", schedule);
      };
    },
  };
}

function failedLoadMessage(outcome: Exclude<CompositionLoadOutcome, { status: "loaded" }>): string {
  switch (outcome.status) {
    case "not-found":
      return `Composition "${outcome.id}" was not found.`;
    case "invalid":
      return `The composition is invalid: ${outcome.issue.message}`;
    case "future-schema":
      return `The composition uses unsupported schema version ${outcome.foundSchemaVersion}.`;
  }
}

function canonicalResolution(
  location: ComposerRouteLocation,
  config: ComposerRouteConfig,
): { resolution: ReturnType<typeof parseComposerRoute>; url: string; history: ComposerTransitionIntent["history"] } {
  if (
    location.pathname === COMPOSER_DOCUMENT_PATH &&
    (location.hash === "" || location.hash === "#/")
  ) {
    const route = { kind: "index" } as const;
    const url = formatComposerRoute(route);
    return {
      resolution: { status: "matched", route },
      url,
      history:
        location.hash === "#/" ? "already-applied" : "replace",
    };
  }
  return {
    resolution: parseComposerRoute(location, config),
    url: `${location.pathname}${location.hash}`,
    history: "already-applied",
  };
}

function routeRef(route: ComposerRoute): CompositionRecordRef | null {
  return route.kind === "detail"
    ? { providerId: route.providerId, recordId: route.recordId }
    : null;
}

function errorText(error: ComposerTransitionError): string {
  const cause = error.cause;
  return cause instanceof Error && cause.message ? `${error.message} ${cause.message}` : error.message;
}

export function ProductionComposerApp({
  componentProvider,
  providers,
  navigation: injectedNavigation,
  idFactory: injectedIdFactory,
  nodeIdFactory: injectedNodeIdFactory,
  now: injectedNow,
  preview,
  readIntentSearch,
}: ProductionComposerAppProps): JSX.Element {
  const reuseManifest = componentProvider.catalog;
  const navigation = useMemo(
    () => injectedNavigation ?? browserNavigation(),
    [injectedNavigation],
  );
  // Read once per load, mirroring the Sitemapper intent's own "a re-read
  // would only ever agree with it" reasoning: the query string never changes
  // underneath a mounted app except through this component's own navigation.
  const intentOutcome = useMemo(
    () => parseIntent({
      pathname: COMPOSER_DOCUMENT_PATH,
      search: (readIntentSearch ?? (() => (typeof window === "undefined" ? "" : window.location.search)))(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const routeConfig = useMemo<ComposerRouteConfig>(
    () => ({
      isKnownProvider: (id) => providers.some(({ descriptor }) => descriptor.id === id),
    }),
    [providers],
  );
  const providersById = useMemo(
    () => new Map(providers.map((provider) => [provider.descriptor.id, provider])),
    [providers],
  );
  const idFactory = useMemo(() => injectedIdFactory ?? createUuidIdFactory(), [injectedIdFactory]);
  const nodeIdFactory = useMemo(
    () => injectedNodeIdFactory ?? createUuidIdFactory(),
    [injectedNodeIdFactory],
  );
  const now = injectedNow ?? (() => new Date().toISOString());
  const nowRef = useRef(now);
  nowRef.current = now;
  const preference = useMemo(
    () =>
      createComposerProviderPreference({
        getItem: (key) => globalThis.localStorage.getItem(key),
        setItem: (key, value) => globalThis.localStorage.setItem(key, value),
      }),
    [],
  );
  const [state, setState] = useState<ComposerCommittedState | null>(null);
  const [transitionError, setTransitionError] = useState<ComposerTransitionError | null>(null);
  const [failedTransition, setFailedTransition] =
    useState<ComposerTransitionIntent | null>(null);
  const [retryingNavigation, setRetryingNavigation] = useState(false);
  const [detailOperationError, setDetailOperationError] = useState<string | null>(null);
  const [duplicatingComposition, setDuplicatingComposition] = useState(false);
  const [bootProviderId, setBootProviderId] = useState<CompositionProviderId | null>(null);
  // Consumed once for the whole app session, not once per CompositionLibrary
  // mount — a plain mount-effect flag would reopen the dialog every time the
  // index view remounts after a detour through a detail route.
  const [pendingNewIntent, setPendingNewIntent] = useState(
    () => intentOutcome.status === "matched" && intentOutcome.intent.route === "composer" && intentOutcome.intent.action === "new",
  );
  const [initializationNotice, setInitializationNotice] =
    useState<CompositionRecoveryOutcome | null>(null);
  const [retryingRecovery, setRetryingRecovery] = useState(false);
  const [lifecycleChanging, setLifecycleChanging] = useState(false);
  const locationGenerationRef = useRef(0);
  const recoveryGenerationRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeRef = state?.view === "detail" ? routeRef(state.route) : null;
  const activeProvider = activeRef ? providersById.get(activeRef.providerId) : undefined;
  const activeReuseService = useMemo(
    () => (activeProvider ? createCompositionReuseService(activeProvider.store, reuseManifest) : null),
    [activeProvider],
  );
  const activeLifecycleService = useMemo(
    () => activeProvider
      ? createCompositionReuseLifecycleService(activeProvider, {
          manifest: reuseManifest,
          nodeIdFactory,
          now: () => nowRef.current(),
        })
      : null,
    [activeProvider, nodeIdFactory],
  );
  const activeReuseResolution = useMemo(
    () => activeRef && activeReuseService
      ? { ref: activeRef, resolver: activeReuseService }
      : undefined,
    [activeRef?.providerId, activeRef?.recordId, activeReuseService],
  );

  const coordinator = useMemo(
    () =>
      createComposerTransitionCoordinator({
        registry: {
          get: (providerId) => {
            const provider = providersById.get(providerId as CompositionProviderId);
            return provider
              ? { id: provider.descriptor.id, list: () => provider.store.list(), get: (id) => provider.store.get(id) }
              : undefined;
          },
        },
        defaultProviderId: COMPOSITION_PROVIDERS.indexeddb.id,
        preference,
        history: navigation,
        createDetailSession: (ref, record): ComposerDetailSession => {
          let flushPendingProps: (() => void) | null = null;
          const provider = providersById.get(ref.providerId);
          if (!provider) throw new Error(`Composition provider "${ref.providerId}" is unavailable.`);
          const queue = createSaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>({
            ref: { ...ref },
            initialRecord: record,
            write: (snapshot) => provider.store.put(snapshot.record),
          });
          const session: ProductionDetailSession = {
            queue,
            flushPendingProps: (boundRef) => {
              if (boundRef.providerId !== ref.providerId || boundRef.recordId !== ref.recordId) {
                throw new Error("The mounted editor is not bound to the requested composition.");
              }
              flushPendingProps?.();
            },
            registerFlushPendingProps: (flush) => {
              flushPendingProps = flush;
            },
          };
          return session;
        },
      }),
    [navigation, preference, providersById],
  );

  useEffect(() => coordinator.subscribe(setState), [coordinator]);

  const transition = useCallback(
    async (intent: ComposerTransitionIntent) => {
      recoveryGenerationRef.current += 1;
      setRetryingRecovery(false);
      setTransitionError(null);
      const result = await coordinator.transition(intent);
      if (result.status === "rolled-back") {
        setTransitionError(result.error);
        setFailedTransition(
          intent.history === "already-applied" ? { ...intent, history: "push" } : intent,
        );
      } else if (result.status === "committed") {
        setFailedTransition(null);
        setDetailOperationError(null);
      }
      return result;
    },
    [coordinator],
  );

  const transitionLocation = useCallback(
    async (location: ComposerRouteLocation, initializeDirectDetail: boolean) => {
      const locationGeneration = ++locationGenerationRef.current;
      const isCurrentLocation = () => {
        const current = navigation.read();
        return (
          locationGeneration === locationGenerationRef.current &&
          current.pathname === location.pathname &&
          current.hash === location.hash
        );
      };
      const target = canonicalResolution(location, routeConfig);
      if (
        initializeDirectDetail &&
        target.resolution.status === "matched" &&
        target.resolution.route.kind === "detail"
      ) {
        const providerId = target.resolution.route.providerId;
        const provider = providersById.get(providerId);
        if (provider) {
          const outcome = await provider.initialization.initialize();
          if (!isCurrentLocation()) return;
          if (outcome.status === "error" || outcome.status === "recovery-required") {
            setInitializationNotice(null);
            setBootProviderId(providerId);
            return;
          }
          setInitializationNotice(null);
        }
      } else {
        setInitializationNotice(null);
      }
      if (!isCurrentLocation()) return;
      setBootProviderId(null);
      await transition({
        resolution: target.resolution,
        url: target.url,
        history: target.history,
      });
    },
    [navigation, providersById, routeConfig, transition],
  );

  useEffect(() => {
    let active = true;
    void transitionLocation(navigation.read(), true);
    const unsubscribe = navigation.subscribe(() => {
      if (active) void transitionLocation(navigation.read(), false);
    });
    return () => {
      active = false;
      locationGenerationRef.current += 1;
      unsubscribe();
      coordinator.cancel();
    };
  }, [coordinator, navigation, transitionLocation]);

  const navigate = useCallback(
    async (
      route: ComposerRoute,
      history: "push" | "replace" = "push",
      indexProviderId?: CompositionProviderId,
    ) => {
      setInitializationNotice(null);
      return transition({
        resolution: { status: "matched", route },
        url: formatComposerRoute(route),
        history,
        indexProviderId,
      });
    },
    [transition],
  );

  const openLinkedSource = useCallback(
    (sourceRecordId: string) => {
      if (!activeRef) return;
      void navigate({
        kind: "detail",
        providerId: activeRef.providerId,
        recordId: sourceRecordId,
      });
    },
    [activeRef, navigate],
  );

  const reloadLinkedConsumer = useCallback(
    async (ref: CompositionRecordRef) => {
      // A detail-to-same-detail transition is intentionally a no-op in the
      // route coordinator. Move through the provider-scoped index with
      // replace history so the persisted lifecycle result receives a new
      // queue and a freshly mounted record-scoped controller.
      const exited = await navigate({ kind: "index" }, "replace", ref.providerId);
      if (exited.status !== "committed") return false;
      const reloaded = await navigate(
        { kind: "detail", providerId: ref.providerId, recordId: ref.recordId },
        "replace",
      );
      return reloaded.status === "committed";
    },
    [navigate],
  );

  const runLinkedLifecycle = useCallback(
    async (kind: "detach" | "remove-broken-binding") => {
      if (
        lifecycleChanging
        || state?.view !== "detail"
        || !activeRef
        || !activeLifecycleService
      ) return;
      const session = state.session as ProductionDetailSession;
      setDetailOperationError(null);
      setLifecycleChanging(true);
      try {
        // The lifecycle service reads the provider's saved consumer. Flush the
        // live editor first so it never materializes an older persisted draft.
        await session.flushPendingProps(activeRef);
        await session.queue.flush();
        const outcome = kind === "detach"
          ? await activeLifecycleService.detachAsSnapshot(activeRef)
          : await activeLifecycleService.removeBrokenBinding(activeRef);
        if (outcome.status !== "detached") {
          setDetailOperationError(lifecycleOutcomeMessage(outcome));
          return;
        }
        await reloadLinkedConsumer(activeRef);
      } catch (reason) {
        setDetailOperationError(
          reason instanceof Error
            ? reason.message
            : "The linked Composition lifecycle change could not be completed.",
        );
      } finally {
        setLifecycleChanging(false);
      }
    },
    [activeLifecycleService, activeRef, lifecycleChanging, reloadLinkedConsumer, state],
  );

  const libraryIntents = useMemo<CompositionLibraryIntents>(() => {
    const provider = (providerId: CompositionProviderId): CompositionProvider => {
      const found = providersById.get(providerId);
      if (!found) throw new Error(`Composition provider "${providerId}" is unavailable.`);
      return found;
    };
    return {
      initialize: (providerId) => provider(providerId).initialization.initialize(),
      retry: (providerId) => provider(providerId).initialization.retry(),
      startFresh: (providerId) => provider(providerId).initialization.startFresh(),
      listTemplates: async (providerId) =>
        createCompositionReuseService(provider(providerId).store, reuseManifest).listCatalog(),
      create: async (intent) => {
        const activeProvider = provider(intent.providerId);
        let binding: { sourceRecordId: string; outletId: string } | undefined;
        if (intent.source) {
          const selection = await createCompositionReuseService(activeProvider.store, reuseManifest).loadSelection({
            providerId: intent.providerId,
            recordId: intent.source.sourceRecordId,
          });
          const publication = selection.status === "loaded" ? selection.record.document.publication : undefined;
          if (
            selection.status !== "loaded" ||
            selection.kind !== "global-template" ||
            publication?.kind !== "global-template" ||
            publication.outlet.id !== intent.source.outletId
          ) {
            throw new Error("The selected Global template changed or is no longer available. Refresh the template list and choose it again.");
          }
          binding = { sourceRecordId: selection.record.id, outletId: publication.outlet.id };
        }
        const record = createCompositionRecord(emptyCompositionDocument(intent.name, binding), {
          idFactory,
          now: nowRef.current,
        });
        await activeProvider.store.put(record);
        return summarizeComposition(record);
      },
      open: async (ref) => {
        const result = await navigate(
          { kind: "detail", providerId: ref.providerId, recordId: ref.recordId },
          "push",
        );
        if (result.status === "rolled-back") {
          if (result.error.code === "record-not-found") return { status: "not-found" };
          throw result.error;
        }
        return { status: "opened" };
      },
      duplicate: async (ref) => {
        const source = await provider(ref.providerId).store.get(ref.recordId);
        if (source.status !== "loaded") throw new Error(failedLoadMessage(source));
        const record = duplicateCompositionRecord(source.record, {
          idFactory,
          nodeIdFactory,
          now: nowRef.current,
        });
        await provider(ref.providerId).store.put(record);
        return summarizeComposition(record);
      },
      rename: async (ref, name) => {
        const activeProvider = provider(ref.providerId);
        const loaded = await activeProvider.store.get(ref.recordId);
        if (loaded.status !== "loaded") throw new Error(failedLoadMessage(loaded));
        const record: CompositionRecord = {
          ...cloneJson(loaded.record),
          updatedAt: nowRef.current(),
          document: { ...cloneJson(loaded.record.document), name },
        };
        await activeProvider.store.put(record);
        return summarizeComposition(record);
      },
      delete: (ref) => provider(ref.providerId).store.delete(ref.recordId),
      clear: (providerId) => provider(providerId).store.clear(),
      exportJsx: async (ref) => {
        const activeProvider = provider(ref.providerId);
        const loaded = await activeProvider.store.get(ref.recordId);
        if (loaded.status !== "loaded") throw new Error(failedLoadMessage(loaded));
        const record = loaded.record;
        let resolution: GlobalTemplateResolutionOutcome | undefined;
        if (record.document.binding) {
          const sourceLoad = await activeProvider.store.get(record.document.binding.sourceRecordId);
          resolution = resolveGlobalTemplateLoad(record, sourceLoad, reuseManifest);
        }
        const outcome = generateBrowserJsxExport({ record, manifest: reuseManifest, resolution });
        return { documentName: record.document.name, outcome };
      },
    };
  }, [idFactory, navigate, nodeIdFactory, providersById, reuseManifest]);

  const handleInitializationApplied = useCallback(
    (providerId: CompositionProviderId, outcome: CompositionInitializationOutcome) => {
      if (outcome.status === "error" || outcome.status === "recovery-required") return;
      try {
        preference.write(providerId);
      } catch {
        // Provider preference is best-effort; the initialized collection remains active.
      }
      if (bootProviderId) {
        setBootProviderId(null);
        void navigate({ kind: "index" }, "replace", providerId);
      }
    },
    [bootProviderId, navigate, preference],
  );

  const retryInitializationRecovery = useCallback(async () => {
    if (state?.view !== "detail") return;
    const provider = providersById.get(state.providerId);
    if (!provider) return;
    const ref = routeRef(state.route);
    if (!ref) return;
    const recoveryGeneration = ++recoveryGenerationRef.current;
    const isCurrentRecovery = () => {
      const current = stateRef.current;
      const currentRef = current?.view === "detail" ? routeRef(current.route) : null;
      return (
        recoveryGeneration === recoveryGenerationRef.current &&
        currentRef?.providerId === ref.providerId &&
        currentRef.recordId === ref.recordId
      );
    };
    setDetailOperationError(null);
    setRetryingRecovery(true);
    try {
      const outcome = await provider.initialization.retry();
      if (!isCurrentRecovery()) return;
      if (outcome.status === "error") {
        setDetailOperationError(outcome.error.message);
        return;
      }
      if (outcome.status === "recovery-required") {
        setInitializationNotice(outcome.recovery);
        setDetailOperationError(
          `${outcome.recovery.message} Return to the library after the current draft is saved to choose Start fresh.`,
        );
        return;
      }
      setDetailOperationError(null);
      setInitializationNotice(null);
    } catch (reason) {
      if (!isCurrentRecovery()) return;
      setDetailOperationError(
        reason instanceof Error
          ? reason.message
          : "Composition recovery retry failed.",
      );
    } finally {
      if (isCurrentRecovery()) setRetryingRecovery(false);
    }
  }, [providersById, state]);

  const retryFailedTransition = useCallback(async () => {
    if (!failedTransition) return;
    setRetryingNavigation(true);
    try {
      await transition(failedTransition);
    } finally {
      setRetryingNavigation(false);
    }
  }, [failedTransition, transition]);

  const duplicateMountedComposition = useCallback(async () => {
    if (state?.view !== "detail" || duplicatingComposition) return;
    const session = state.session as ProductionDetailSession;
    const ref = routeRef(state.route)!;
    const provider = providersById.get(ref.providerId);
    if (!provider) return;

    setDetailOperationError(null);
    setDuplicatingComposition(true);
    try {
      await session.flushPendingProps(ref);
      await session.queue.flush();
      const duplicate = duplicateCompositionRecord(session.queue.state.draft, {
        idFactory,
        nodeIdFactory,
        now: nowRef.current,
      });
      await provider.store.put(duplicate);
      await navigate({
        kind: "detail",
        providerId: ref.providerId,
        recordId: duplicate.id,
      });
    } catch (reason) {
      setDetailOperationError(
        reason instanceof Error
          ? reason.message
          : "The composition could not be duplicated.",
      );
    } finally {
      setDuplicatingComposition(false);
    }
  }, [duplicatingComposition, idFactory, navigate, nodeIdFactory, providersById, state]);

  const availableProviders = useMemo(
    () => providers.map(({ descriptor }) => ({ descriptor, available: true })),
    [providers],
  );
  const preferredProviderId = (() => {
    const candidate = bootProviderId ?? (state?.view !== "not-found" ? state?.providerId : null);
    return candidate && providersById.has(candidate)
      ? candidate
      : COMPOSITION_PROVIDERS.indexeddb.id;
  })();

  if (bootProviderId || state?.view === "index") {
    return (
      <>
        {transitionError && (
          <div class="sg-composer-library-alert sg-composer-library-alert-error" role="alert">
            <p>{errorText(transitionError)}</p>
          </div>
        )}
        {intentOutcome.status === "invalid" && (
          <div class="sg-composer-library-alert sg-composer-library-alert-error" role="alert">
            <p>{intentOutcome.message}</p>
          </div>
        )}
        <CompositionLibrary
          providers={availableProviders}
          initialProviderId={preferredProviderId}
          intents={libraryIntents}
          onInitializationApplied={handleInitializationApplied}
          openNewOnMount={pendingNewIntent}
          onOpenNewConsumed={() => setPendingNewIntent(false)}
        />
      </>
    );
  }

  if (state?.view === "detail") {
    const ref = routeRef(state.route)!;
    const session = state.session as ProductionDetailSession;
    return (
      <ComposerIntegration
        key={`${ref.providerId}:${ref.recordId}:${state.generation}`}
          componentProvider={componentProvider}
        controllerOptions={{
          record: state.record,
          saveQueue: session.queue,
          now: nowRef.current,
        }}
        reuseResolution={activeReuseResolution}
        listPatternCatalog={
          activeReuseService
            ? () => activeReuseService.listCatalog(ref)
            : undefined
        }
        loadPattern={
          activeReuseService
            ? (patternRef) => activeReuseService.loadSelection(patternRef, ref)
            : undefined
        }
        linkedActions={{
          onOpenSource: openLinkedSource,
          ...(activeProvider && isCompositionLifecycleStore(activeProvider.store)
            ? {
                onDetach: () => void runLinkedLifecycle("detach"),
                onRemoveBrokenBinding: () => void runLinkedLifecycle("remove-broken-binding"),
              }
            : {}),
        }}
        registerFlushPendingProps={session.registerFlushPendingProps}
        onNavigateToLibrary={() => void navigate({ kind: "index" })}
        onDuplicateComposition={() => void duplicateMountedComposition()}
        duplicatingComposition={duplicatingComposition}
        getPublicationDependencies={(sourceRecordId) =>
          publicationDependencies(providersById.get(ref.providerId), sourceRecordId, reuseManifest)
        }
        navigationError={
          transitionError
            ? errorText(transitionError)
            : detailOperationError
        }
        onRetryNavigation={
          transitionError && failedTransition
            ? () => void retryFailedTransition()
            : undefined
        }
        navigationRetrying={retryingNavigation}
        recoveryNotice={
          initializationNotice
            ? `${initializationNotice.message} The original source has been preserved.`
            : null
        }
        onRetryRecovery={() => void retryInitializationRecovery()}
        recoveryRetrying={retryingRecovery}
        {...preview}
      />
    );
  }

  if (state?.view === "not-found") {
    return (
      <main class="sg-composer-library" aria-labelledby="sg-composer-route-error-title">
        <section class="sg-composer-library-alert sg-composer-library-alert-error" role="alert">
          <div>
            <h1 id="sg-composer-route-error-title">Composition could not be opened</h1>
            <p>
              {state.error instanceof ComposerTransitionError
                ? errorText(state.error)
                : state.error.message}
            </p>
          </div>
          <div class="sg-composer-library-actions">
            {state.route && (
              <button
                type="button"
                class="sg-composer-library-button"
                onClick={() =>
                  void transitionLocation(navigation.read(), state.route?.kind === "detail")
                }
              >
                Retry
              </button>
            )}
            <button
              type="button"
              class="sg-composer-library-button"
              onClick={() => void navigate({ kind: "index" }, "replace")}
            >
              Back to library
            </button>
          </div>
        </section>
        {initializationNotice && (
          <section class="sg-composer-library-alert" aria-label="Composition recovery notice">
            <p>{initializationNotice.message}</p>
            <p>The original source has been preserved.</p>
          </section>
        )}
      </main>
    );
  }

  return (
    <main class="sg-composer-library" aria-busy="true" aria-label="Loading Composer">
      <section class="sg-composer-library-state">
        <h1>Loading Composer…</h1>
        <p>Opening the selected composition storage.</p>
      </section>
    </main>
  );
}
