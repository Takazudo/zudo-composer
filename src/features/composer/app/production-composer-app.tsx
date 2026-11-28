"use client";

import { computed, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
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
import { notifyRouteSelection, parseIntent } from "../../../app/route-intents";
import type { AppServices } from "../../../app/services";
import { Banner, Button, EmptyState } from "../../../components/ui";
import { Keyed } from "../../../runtime";
import { memoOn } from "../reactive/memo";
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
  /** The shell's route services: workspace session registration, the asset store and the chrome store. */
  services?: AppServices;
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
    read: () => ({ pathname: window.location.pathname, search: window.location.search, hash: window.location.hash }),
    push: (url) => { window.history.pushState(null, "", url); notifyRouteSelection("push"); },
    replace: (url) => { window.history.replaceState(null, "", url); notifyRouteSelection(); },
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
      window.addEventListener("popstate", schedule);
      return () => {
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
  return {
    resolution: parseComposerRoute(location, config),
    url: `${location.pathname}${location.search}${location.hash ?? ""}`,
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
  services,
}: ProductionComposerAppProps): Child {
  const scope = getScope();
  const workspaceIntegration = services?.workspace.integration;
  const assetStore = workspaceIntegration?.assetProvider?.store;
  const reuseManifest = componentProvider.catalog;
  const navigation = injectedNavigation ?? browserNavigation();
  // Read once per load, mirroring the Sitemapper intent's own "a re-read
  // would only ever agree with it" reasoning: the query string never changes
  // underneath a mounted app except through this component's own navigation.
  const intentOutcome = parseIntent({
    pathname: COMPOSER_DOCUMENT_PATH,
    search: (readIntentSearch ?? (() => (typeof window === "undefined" ? "" : window.location.search)))(),
  });
  const routeConfig: ComposerRouteConfig = {
    isKnownProvider: (id) => providers.some(({ descriptor }) => descriptor.id === id),
  };
  const providersById = new Map(providers.map((provider) => [provider.descriptor.id, provider]));
  // The first declared provider, not a hard-coded id: which provider backs
  // Compositions is the SiteProject's to declare, and it changed once already.
  const defaultProviderId = providers[0]?.descriptor.id ?? COMPOSITION_PROVIDERS.files.id;
  const idFactory = injectedIdFactory ?? createUuidIdFactory();
  const nodeIdFactory = injectedNodeIdFactory ?? createUuidIdFactory();
  const now = injectedNow ?? (() => new Date().toISOString());
  const preference = createComposerProviderPreference({
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  });
  const state = signal<ComposerCommittedState | null>(null);
  const transitionError = signal<ComposerTransitionError | null>(null);
  const failedTransition = signal<ComposerTransitionIntent | null>(null);
  const retryingNavigation = signal(false);
  const detailOperationError = signal<string | null>(null);
  const duplicatingComposition = signal(false);
  const bootProviderId = signal<CompositionProviderId | null>(null);
  // Consumed once for the whole app session, not once per CompositionLibrary
  // mount — a plain mount flag would reopen the dialog every time the index
  // view remounts after a detour through a detail route.
  const pendingNewIntent = signal(
    intentOutcome.status === "matched" && intentOutcome.intent.route === "composer" && "action" in intentOutcome.intent && intentOutcome.intent.action === "new",
  );
  const initializationNotice = signal<CompositionRecoveryOutcome | null>(null);
  const retryingRecovery = signal(false);
  const lifecycleChanging = signal(false);
  let locationGeneration = 0;
  let recoveryGeneration = 0;

  const activeRef = memoOn(
    () => {
      const current = state.value;
      const ref = current?.view === "detail" ? routeRef(current.route) : null;
      return [ref?.providerId ?? null, ref?.recordId ?? null] as const;
    },
    (providerId, recordId): CompositionRecordRef | null => (providerId !== null && recordId !== null ? { providerId, recordId } : null),
  );
  const activeProvider = computed(() => {
    const ref = activeRef.value;
    return ref ? providersById.get(ref.providerId) : undefined;
  });
  const editorSession = computed(() => {
    const current = state.value;
    return current?.view === "detail" ? current.session as ProductionDetailSession : null;
  });

  // One save-registry entry per mounted editor session, replaced only when the
  // session itself changes.
  let registeredSession: ProductionDetailSession | null = null;
  let releaseRegistration: (() => void) | null = null;
  scope.effect(() => {
    const session = editorSession.value;
    if (session === registeredSession) return;
    registeredSession = session;
    releaseRegistration?.();
    releaseRegistration = null;
    if (!workspaceIntegration || !session) return;
    const ref = session.queue.ref;
    const registered = workspaceIntegration.sessions.register({ feature: "Composition", ...ref, workspaceId: workspaceIntegration.workspace.id }, {
      flush: async () => { session.flushPendingProps(ref); await session.queue.flush(); },
      retry: () => session.queue.retry(),
    });
    let revision = session.queue.state.draftRevision;
    const unsubscribe = session.queue.subscribe((next) => { if (revision !== next.draftRevision) { revision = next.draftRevision; registered.changed(); } });
    releaseRegistration = () => { unsubscribe(); registered.detach(); };
  });
  scope.onCleanup(() => {
    releaseRegistration?.();
    releaseRegistration = null;
  });

  const activeReuseService = memoOn(
    () => [activeProvider.value] as const,
    (provider) => (provider ? createCompositionReuseService(provider.store, reuseManifest) : null),
  );
  const activeLifecycleService = memoOn(
    () => [activeProvider.value] as const,
    (provider) => provider
      ? createCompositionReuseLifecycleService(provider, { manifest: reuseManifest, nodeIdFactory, now: () => now() })
      : null,
  );
  const activeReuseResolution = memoOn(
    () => [activeRef.value, activeReuseService.value] as const,
    (ref, service) => (ref && service ? { ref, resolver: service } : undefined),
  );

  const coordinator = createComposerTransitionCoordinator({
    registry: {
      get: (providerId) => {
        const provider = providersById.get(providerId as CompositionProviderId);
        return provider
          ? { id: provider.descriptor.id, list: () => provider.store.list(), get: (id) => provider.store.get(id) }
          : undefined;
      },
    },
    defaultProviderId,
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
  });

  async function transition(intent: ComposerTransitionIntent) {
    recoveryGeneration += 1;
    retryingRecovery.value = false;
    transitionError.value = null;
    const result = await coordinator.transition(intent);
    if (scope.abortSignal.aborted) return result;
    if (result.status === "rolled-back") {
      transitionError.value = result.error;
      failedTransition.value = intent.history === "already-applied" ? { ...intent, history: "push" } : intent;
    } else if (result.status === "committed") {
      failedTransition.value = null;
      detailOperationError.value = null;
    }
    return result;
  }

  async function transitionLocation(location: ComposerRouteLocation, initializeDirectDetail: boolean): Promise<void> {
    const generation = ++locationGeneration;
    const isCurrentLocation = () => {
      const current = navigation.read();
      return (
        !scope.abortSignal.aborted &&
        generation === locationGeneration &&
        current.pathname === location.pathname &&
        current.search === location.search &&
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
          initializationNotice.value = null;
          bootProviderId.value = providerId;
          return;
        }
        initializationNotice.value = null;
      }
    } else {
      initializationNotice.value = null;
    }
    if (!isCurrentLocation()) return;
    bootProviderId.value = null;
    await transition({
      resolution: target.resolution,
      url: target.url,
      history: target.history,
    });
  }

  scope.onActivate(() => {
    const unsubscribeState = coordinator.subscribe((next) => { state.value = next; });
    let active = true;
    void transitionLocation(navigation.read(), true);
    const unsubscribe = navigation.subscribe(() => {
      if (active) void transitionLocation(navigation.read(), false);
    });
    return () => {
      unsubscribeState();
      active = false;
      locationGeneration += 1;
      unsubscribe();
      coordinator.cancel();
    };
  });

  async function navigate(
    route: ComposerRoute,
    history: "push" | "replace" = "push",
    indexProviderId?: CompositionProviderId,
  ) {
    initializationNotice.value = null;
    return transition({
      resolution: { status: "matched", route },
      url: formatComposerRoute(route),
      history,
      indexProviderId,
    });
  }

  function openLinkedSource(sourceRecordId: string): void {
    const ref = activeRef.value;
    if (!ref) return;
    void navigate({ kind: "detail", providerId: ref.providerId, recordId: sourceRecordId });
  }

  async function reloadLinkedConsumer(ref: CompositionRecordRef): Promise<boolean> {
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
  }

  async function runLinkedLifecycle(kind: "detach" | "remove-broken-binding"): Promise<void> {
    const current = state.value;
    const ref = activeRef.value;
    const lifecycle = activeLifecycleService.value;
    if (lifecycleChanging.value || current?.view !== "detail" || !ref || !lifecycle) return;
    const session = current.session as ProductionDetailSession;
    detailOperationError.value = null;
    lifecycleChanging.value = true;
    try {
      // The lifecycle service reads the provider's saved consumer. Flush the
      // live editor first so it never materializes an older persisted draft.
      await session.flushPendingProps(ref);
      await session.queue.flush();
      const outcome = kind === "detach"
        ? await lifecycle.detachAsSnapshot(ref)
        : await lifecycle.removeBrokenBinding(ref);
      if (scope.abortSignal.aborted) return;
      if (outcome.status !== "detached") {
        detailOperationError.value = lifecycleOutcomeMessage(outcome);
        return;
      }
      await reloadLinkedConsumer(ref);
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      detailOperationError.value = reason instanceof Error
        ? reason.message
        : "The linked Composition lifecycle change could not be completed.";
    } finally {
      if (!scope.abortSignal.aborted) lifecycleChanging.value = false;
    }
  }

  const libraryIntents = ((): CompositionLibraryIntents => {
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
          now: now,
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
          now: now,
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
          updatedAt: now(),
          document: { ...cloneJson(loaded.record.document), name },
        };
        await activeProvider.store.put(record);
        return summarizeComposition(record);
      },
      delete: async (ref) => {
        const activeProvider = provider(ref.providerId);
        const loaded = await activeProvider.store.get(ref.recordId);
        if (loaded.status === "not-found") return false;
        if (loaded.status !== "loaded") throw new Error(failedLoadMessage(loaded));
        if (loaded.record.document.publication?.kind !== "global-template") {
          return activeProvider.store.delete(ref.recordId);
        }
        const outcome = await createCompositionReuseLifecycleService(activeProvider, {
          manifest: reuseManifest,
          nodeIdFactory,
          now: () => now(),
        }).deleteSource(ref);
        if (outcome.status === "deleted") return true;
        if (outcome.status === "not-found") return false;
        if (outcome.status === "blocked") {
          throw new Error(`Cannot delete this Global template while ${outcome.dependents.length} consumer${outcome.dependents.length === 1 ? " is" : "s are"} still linked.`);
        }
        throw new Error(outcome.message);
      },
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
      resolvePreview: async (ref) => {
        const activeProvider = provider(ref.providerId);
        const loaded = await activeProvider.store.get(ref.recordId);
        if (loaded.status !== "loaded") {
          return {
            status: "not-found" as const,
            ref,
            message: failedLoadMessage(loaded),
          };
        }
        const record = cloneJson(loaded.record);
        if (!record.document.binding) {
          return {
            status: "ready" as const,
            ref,
            revision: record.updatedAt,
            snapshot: { document: record.document, localRecordId: record.id },
          };
        }
        const resolution = await createCompositionReuseService(activeProvider.store, reuseManifest).resolve(record);
        if (resolution.status !== "resolved") {
          return {
            status: "blocked" as const,
            ref,
            message: resolution.status === "incompatible-local-root"
              ? resolution.message
              : `Linked template preview is unavailable (${resolution.status.replaceAll("-", " ")}).`,
          };
        }
        return {
          status: "ready" as const,
          ref,
          revision: `${record.updatedAt}:${resolution.source.updatedAt}`,
          snapshot: {
            document: record.document,
            localRecordId: record.id,
            linked: {
              sourceRecordId: resolution.source.id,
              sourceDocument: cloneJson(resolution.source.document),
              outlet: cloneJson(resolution.outlet),
            },
          },
        };
      },
    };
  })();

  function handleInitializationApplied(providerId: CompositionProviderId, outcome: CompositionInitializationOutcome): void {
    if (outcome.status === "error" || outcome.status === "recovery-required") return;
    try {
      preference.write(providerId);
    } catch {
      // Provider preference is best-effort; the initialized collection remains active.
    }
    if (bootProviderId.value) {
      bootProviderId.value = null;
      void navigate({ kind: "index" }, "replace", providerId);
    }
  }

  async function retryInitializationRecovery(): Promise<void> {
    const current = state.value;
    if (current?.view !== "detail") return;
    const provider = providersById.get(current.providerId);
    if (!provider) return;
    const ref = routeRef(current.route);
    if (!ref) return;
    const generation = ++recoveryGeneration;
    const isCurrentRecovery = () => {
      const latest = state.value;
      const currentRef = latest?.view === "detail" ? routeRef(latest.route) : null;
      return (
        !scope.abortSignal.aborted &&
        generation === recoveryGeneration &&
        currentRef?.providerId === ref.providerId &&
        currentRef.recordId === ref.recordId
      );
    };
    detailOperationError.value = null;
    retryingRecovery.value = true;
    try {
      const outcome = await provider.initialization.retry();
      if (!isCurrentRecovery()) return;
      if (outcome.status === "error") {
        detailOperationError.value = outcome.error.message;
        return;
      }
      if (outcome.status === "recovery-required") {
        initializationNotice.value = outcome.recovery;
        detailOperationError.value =
          `${outcome.recovery.message} Return to the library after the current draft is saved to choose Start fresh.`;
        return;
      }
      detailOperationError.value = null;
      initializationNotice.value = null;
    } catch (reason) {
      if (!isCurrentRecovery()) return;
      detailOperationError.value = reason instanceof Error ? reason.message : "Composition recovery retry failed.";
    } finally {
      if (isCurrentRecovery()) retryingRecovery.value = false;
    }
  }

  async function retryFailedTransition(): Promise<void> {
    const failed = failedTransition.value;
    if (!failed) return;
    retryingNavigation.value = true;
    try {
      await transition(failed);
    } finally {
      if (!scope.abortSignal.aborted) retryingNavigation.value = false;
    }
  }

  async function duplicateMountedComposition(): Promise<void> {
    const current = state.value;
    if (current?.view !== "detail" || duplicatingComposition.value) return;
    const session = current.session as ProductionDetailSession;
    const ref = routeRef(current.route)!;
    const provider = providersById.get(ref.providerId);
    if (!provider) return;

    detailOperationError.value = null;
    duplicatingComposition.value = true;
    try {
      await session.flushPendingProps(ref);
      await session.queue.flush();
      const duplicate = duplicateCompositionRecord(session.queue.state.draft, { idFactory, nodeIdFactory, now });
      await provider.store.put(duplicate);
      if (scope.abortSignal.aborted) return;
      await navigate({ kind: "detail", providerId: ref.providerId, recordId: duplicate.id });
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      detailOperationError.value = reason instanceof Error ? reason.message : "The composition could not be duplicated.";
    } finally {
      if (!scope.abortSignal.aborted) duplicatingComposition.value = false;
    }
  }

  async function deleteMountedComposition(): Promise<void> {
    const current = state.value;
    if (current?.view !== "detail") return;
    const ref = routeRef(current.route)!;
    const provider = providersById.get(ref.providerId);
    if (!provider) return;

    detailOperationError.value = null;
    try {
      // Land anything in flight first: a debounced prop commit that resolved
      // after the delete would put the record straight back.
      const session = current.session as ProductionDetailSession;
      await session.flushPendingProps(ref);
      await session.queue.flush();
      if (session.queue.state.draft.document.publication?.kind === "global-template") {
        const lifecycle = activeLifecycleService.value;
        if (!lifecycle) throw new Error("The active provider cannot verify Global-template dependencies.");
        const outcome = await lifecycle.deleteSource(ref);
        if (outcome.status === "blocked") {
          throw new Error(`Cannot delete this Global template while ${outcome.dependents.length} consumer${outcome.dependents.length === 1 ? " is" : "s are"} still linked.`);
        }
        if (outcome.status === "unavailable" || outcome.status === "load-error") throw new Error(outcome.message);
        if (outcome.status === "not-found") throw new Error("This Composition no longer exists in the active provider.");
      } else {
        await provider.store.delete(ref.recordId);
      }
    } catch (reason) {
      if (scope.abortSignal.aborted) return;
      detailOperationError.value = reason instanceof Error ? reason.message : "The composition could not be deleted.";
      return;
    }
    if (scope.abortSignal.aborted) return;
    // Replace history: the record this entry pointed at no longer exists, so
    // Back must not return to an editor for it.
    await navigate({ kind: "index" }, "replace", ref.providerId);
  }

  const availableProviders = providers.map(({ descriptor }) => ({ descriptor, available: true }));
  const preferredProviderId = (): CompositionProviderId => {
    const current = state.value;
    const candidate = bootProviderId.value ?? (current?.view !== "not-found" ? current?.providerId : null);
    return candidate && providersById.has(candidate) ? candidate : defaultProviderId;
  };

  // The library stays mounted while a boot provider hands over to the index
  // view; every distinct editor mount is its own record-scoped session.
  const viewKey = computed(() => {
    const current = state.value;
    if (bootProviderId.value || current?.view === "index") return "library";
    if (current?.view === "detail") {
      const ref = routeRef(current.route)!;
      return `detail:${ref.providerId}:${ref.recordId}:${current.generation}`;
    }
    return current?.view === "not-found" ? "not-found" : "loading";
  });

  const navigationError = computed(() => {
    const error = transitionError.value;
    return error ? errorText(error) : detailOperationError.value;
  });
  const retryNavigation = () => void retryFailedTransition();
  const onRetryNavigation = computed(() => (transitionError.value && failedTransition.value ? retryNavigation : undefined));
  const recoveryNotice = computed(() => {
    const notice = initializationNotice.value;
    return notice ? `${notice.message} The original source has been preserved.` : null;
  });

  function DetailView(): Child {
    const current = state.value;
    if (current?.view !== "detail") return null;
    const ref = routeRef(current.route)!;
    const session = current.session as ProductionDetailSession;
    const reuseService = activeReuseService.value;
    const provider = activeProvider.value;
    return (
      <ComposerIntegration
        componentProvider={componentProvider}
        controllerOptions={{
          record: current.record,
          saveQueue: session.queue,
          now,
        }}
        reuseResolution={activeReuseResolution}
        listPatternCatalog={reuseService ? () => reuseService.listCatalog(ref) : undefined}
        loadPattern={reuseService ? (patternRef) => reuseService.loadSelection(patternRef, ref) : undefined}
        linkedActions={{
          onOpenSource: openLinkedSource,
          ...(provider && isCompositionLifecycleStore(provider.store)
            ? {
                onDetach: () => void runLinkedLifecycle("detach"),
                onRemoveBrokenBinding: () => void runLinkedLifecycle("remove-broken-binding"),
              }
            : {}),
        }}
        appChrome={services?.chrome ?? null}
        assetStore={assetStore}
        registerFlushPendingProps={session.registerFlushPendingProps}
        onDuplicateComposition={() => void duplicateMountedComposition()}
        onDeleteComposition={() => void deleteMountedComposition()}
        duplicatingComposition={duplicatingComposition}
        getPublicationDependencies={(sourceRecordId) =>
          publicationDependencies(providersById.get(ref.providerId), sourceRecordId, reuseManifest)
        }
        navigationError={navigationError}
        onRetryNavigation={onRetryNavigation}
        navigationRetrying={retryingNavigation}
        recoveryNotice={recoveryNotice}
        onRetryRecovery={() => void retryInitializationRecovery()}
        recoveryRetrying={retryingRecovery}
        {...preview}
      />
    );
  }

  function NotFoundView(): Child {
    const current = computed(() => state.value);
    const description = computed(() => {
      const latest = current.value;
      if (latest?.view !== "not-found") return "";
      return latest.error instanceof ComposerTransitionError ? errorText(latest.error) : latest.error.message;
    });
    const hasRoute = computed(() => {
      const latest = current.value;
      return latest?.view === "not-found" && Boolean(latest.route);
    });
    return (
      <main class="sg-composer-route-state" aria-label="Composition could not be opened">
        <EmptyState
          title="Composition could not be opened"
          description={description}
          action={
            <>
              <Show when={hasRoute}>
                {() => (
                  <Button
                    on:click={() => {
                      const latest = state.value;
                      void transitionLocation(navigation.read(), latest?.view === "not-found" && latest.route?.kind === "detail");
                    }}
                  >
                    Retry
                  </Button>
                )}
              </Show>
              <Button variant="primary" on:click={() => void navigate({ kind: "index" }, "replace")}>
                Back to Compositions
              </Button>
            </>
          }
        />
        <Show when={computed(() => initializationNotice.value !== null)}>
          {() => (
            <Banner tone="warn" title="Composition recovery notice">
              {computed(() => `${initializationNotice.value?.message ?? ""} The original source has been preserved.`)}
            </Banner>
          )}
        </Show>
      </main>
    );
  }

  return (
    <Keyed value={viewKey} by={(key) => key}>
      {(key) => {
        switch (key.value) {
          case "library":
            return (
              <>
                <Show when={computed(() => transitionError.value !== null)}>
                  {() => <Banner tone="err">{computed(() => (transitionError.value ? errorText(transitionError.value) : ""))}</Banner>}
                </Show>
                {intentOutcome.status === "invalid" ? <Banner tone="err">{intentOutcome.message}</Banner> : null}
                <CompositionLibrary
                  componentProvider={componentProvider}
                  providers={availableProviders}
                  initialProviderId={preferredProviderId()}
                  intents={libraryIntents}
                  onInitializationApplied={handleInitializationApplied}
                  openNewOnMount={pendingNewIntent.value}
                  onOpenNewConsumed={() => { pendingNewIntent.value = false; }}
                  assetStore={assetStore}
                />
              </>
            );
          case "not-found":
            return <NotFoundView />;
          case "loading":
            return (
              <main class="sg-composer-route-state" aria-busy="true" aria-label="Loading Composer">
                <EmptyState title="Loading Composer…" description="Opening the selected composition storage." />
              </main>
            );
          default:
            return <DetailView />;
        }
      }}
    </Keyed>
  );
}
