import { HostDocumentPage } from "./features/host-document/page";
import { hostDocumentAvailable } from "./features/native-editing/session";
import { NativePageRoute } from "./features/native-editing/page-route";
import { assistantConfig, nativeEditingAvailable } from "./features/native-editing/session";
import { AssistantRoute } from "./features/assistant/assistant-route";
import { attachNativeAuthoringState } from "./features/native-editing/session";
import { batch, computed, flush as flushUpdates, getScope, Show, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { Dashboard } from "./app/dashboard";
import { createProductionProviderIntegration, ProviderIntegrationError, type ProductionProviderIntegration } from "./app/provider-integration";
import { NewProjectDialog } from "./app/new-project-dialog";
import { createEmptySiteProject, computeSiteProjectRevision } from "./app/empty-site-project";
import type { AppServices, WorkspaceServices } from "./app/services";
import { createChromeStore } from "./app/chrome-context";
import { parseIntent, formatIntent } from "./app/route-intents";
import { Button } from "./components/ui";
import { PROJECT_USAGE_CHANNELS, subscribeAuthoringPersistenceChanges } from "./app/persistence-channels";
import { publishPendingState } from "./shared/pending-broadcast";
import { createProjectAssetUsageInspection } from "./site-project/assets/usage";
import { Shell } from "./app/shell";
import { createPageLoading } from "./app/page-loading/page-loading";
import { authoringRequestsInFlight, subscribeAuthoringActivity } from "./shared/authoring-fetch";
import { isCoordinationBusy } from "./shared/coordination-error";
import { PageLoadingOverlay } from "./app/page-loading/page-loading-overlay";
import { createWorkspaceSummary, type WorkspaceSummary } from "./app/workspace-summary";
import ComposerApp from "./features/composer/chrome/composer-app";
import { ContentRouteContent } from "./features/content";
import { MappingRouteContent } from "./features/mapping";
import { AssetFieldPicker, AssetRouteContent, createAssetContentServices, versionedAssetStore } from "./features/assets";
import { SitemapperRouteContent } from "./features/sitemapper";
import { ReleaseRoute, createReleaseController, createReleaseTransport } from "./features/release";
import { createApplicationOperationGate } from "./app/operation-gate";
import { HostedDemoNotice } from "./features/delivery/hosted-demo-notice";
import { Keyed, storeSignal } from "./runtime";
import { bootstrapTheme, createThemeController, type ThemeController } from "./theme/theme";

const OPENING_BUSY_RETRY_MS = 1000;
const OPENING_BUSY_DEADLINE_MS = 60_000;

function NotFound() { return <main class="route-placeholder"><h1>Not found</h1><p>This standalone route does not exist.</p><a href="/">Return home</a></main>; }

export interface AppProps {
  /** Main bootstrapping supplies the already-observing controller. */
  themeController?: ThemeController;
  integration?: ProductionProviderIntegration;
  hostedDemo?: boolean;
  onIntegration?: (integration: ProductionProviderIntegration) => void;
}

type OpeningReason = "absent" | "invalid" | "storage";

/** What the keyed route region shows. `key` changes exactly when the region must remount. */
type RouteView =
  | { readonly key: string; readonly kind: "opening" }
  | { readonly key: string; readonly kind: "opening-failed" }
  | { readonly key: string; readonly kind: "invalid"; readonly message: string }
  | { readonly key: string; readonly kind: "route"; readonly path: string; readonly location: string };

/**
 * The read models and services one provider graph owns. They are created with
 * the graph and disposed when it is replaced or the App unmounts.
 */
function createWorkspaceResources(providers: ProductionProviderIntegration, operationGate: ReturnType<typeof createApplicationOperationGate>) {
  // One read model for the whole chrome; the rail's counts come from it, and
  // the Dashboard route reuses this instance rather than initializing a second.
  const summary: WorkspaceSummary = createWorkspaceSummary(providers);
  const release = createReleaseController(providers, createReleaseTransport(), operationGate);
  const assetContentServices = createAssetContentServices(
    providers.contentProviders,
    () => providers.sessions.flush(),
    (listener) => subscribeAuthoringPersistenceChanges(PROJECT_USAGE_CHANNELS, listener),
    createProjectAssetUsageInspection({
      readProject: async () => { const result = await providers.getCurrentSiteProject({ flushSessions: false }); if (result.status !== "ready") throw new Error(result.error.message); return result.project; },
      catalog: providers.componentProvider.catalog,
      assetStore: providers.assetProvider?.store,
      href: (location) => {
        const path = location.selectionPath ?? location.valuePath;
        return location.domain === "content" && location.modelId
          ? formatIntent({ route: "content", providerId: location.providerId, modelId: location.modelId, entryId: location.recordId, ...(location.fieldId ? { fieldId: location.fieldId } : {}), ...(path.length ? { valuePath: path } : {}) })
          : formatIntent({ route: "composer", providerId: location.providerId, compositionId: location.sourceRecordId ?? location.recordId });
      },
    }),
  );
  const assetStore = providers.assetProvider?.store ? versionedAssetStore(providers.assetProvider) : undefined;
  const assetPickerCapabilities = { upload: assetStore?.capabilities.replace === true && typeof assetStore.upload === "function" };
  return {
    summary,
    release,
    assetContentServices,
    assetPickerCapabilities,
    mappingAttachmentService: providers.mappingAttachmentService,
    dispose() {
      release.dispose();
      summary.dispose?.();
    },
  };
}

export function App({ themeController, integration, hostedDemo = false, onIntegration }: AppProps = {}): Child {
  const scope = getScope();
  const operationGate = createApplicationOperationGate();
  const ownedThemeController = themeController ? null : createThemeController(bootstrapTheme());
  const activeThemeController = themeController ?? ownedThemeController!;
  const themeSnapshot = storeSignal(scope, {
    getSnapshot: () => activeThemeController.getSnapshot(),
    subscribe: (listener) => activeThemeController.subscribe(() => listener()),
  });
  scope.onCleanup(() => ownedThemeController?.dispose());

  const providers = signal(integration ?? createProductionProviderIntegration());
  const resources = signal(createWorkspaceResources(providers.value, operationGate));
  const location = signal(window.location.pathname + window.location.search + window.location.hash);
  const routeEpoch = signal(0);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const ready = signal(false);
  const openingReason = signal<OpeningReason | null>(null);
  const creatingProject = signal(false);
  const nativeStale = signal(false);
  const chrome = createChromeStore();
  const openingFailed = (cause: unknown) => {
    batch(() => {
      openingReason.value = cause instanceof ProviderIntegrationError ? cause.sourceReason ?? "storage" : "storage";
      error.value = cause instanceof Error ? cause.message : "Workspace initialization failed.";
    });
  };
  const pageLoading = createPageLoading({ inFlight: authoringRequestsInFlight, subscribe: subscribeAuthoringActivity });
  let navigationTicket = 0;
  let replacing = false;
  let historyIndex: number = Number.isInteger(window.history.state?.workspaceIndex) ? window.history.state.workspaceIndex : 0;
  let traversal: { phase: "restoring" | "waiting" | "committing"; target: string; targetIndex: number; delta: number; endLoading: () => void } | null = null;
  window.history.replaceState({ ...window.history.state, workspaceIndex: historyIndex }, "");
  scope.onCleanup(() => {
    traversal?.endLoading();
    operationGate.dispose();
    resources.value.dispose();
    pageLoading.dispose();
  });

  const flush = async () => {
    const outcome = await providers.value.sessions.flush();
    if (outcome.status === "failed") throw new Error(outcome.failures.map((failure) => `${failure.feature} (${failure.providerId}${failure.recordId ? ` / ${failure.recordId}` : ""}): ${failure.error.message}`).join("; "));
    if (outcome.status === "changed") throw new Error("Edits changed while saving. Finish the edit and try navigation again.");
  };
  // A best-effort head start for the working-preview tab's own session flush
  // (issue #795): fired on pointerdown/Enter of the anchor, before the browser
  // opens it. Fire-and-forget only — a synchronous flush is impossible, and
  // awaiting it before `window.open` loses the user gesture and gets
  // pop-up-blocked (ruled out in #731). The registry keeps its own failure
  // state, so a rejection here has nothing useful to do but stop.
  //
  // Deliberately NOT gated on `sessions.hasPending`, though #795 specified that
  // guard. `hasPending` only turns true once an editor has accepted a draft
  // (`registered.changed()` fires on a `draftRevision` change), while a value
  // still being typed lives in the detail session's *pending props*, which
  // `WorkspaceSaveHandle.flush` pushes via `flushPendingProps` before draining
  // the queue. So the guard read false in exactly the case this feature exists
  // for — edit a field, click "Website preview" without blurring first — and
  // skipped the flush that would have committed the edit. Confirmed on the dev
  // browser lane (#798): the preview sat on the pending indicator indefinitely.
  // An unguarded flush with nothing outstanding just settles every session once
  // and returns, so the guard bought nothing.
  const flushOnPreviewActivation = () => {
    void providers.value.sessions.flush().catch(() => undefined);
  };
  const focusDestination = () => requestAnimationFrame(() => document.getElementById("workspace-destination")?.focus());
  const navigate = async (href: string, replace = false, source?: Element | null): Promise<boolean> => {
    if (replacing || traversal) return false;
    const ticket = ++navigationTicket;
    const endLoading = pageLoading.begin(source);
    batch(() => { busy.value = true; error.value = null; });
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) throw new Error("This is not a workspace destination.");
      await flush();
      if (ticket !== navigationTicket) return false;
      if (url.pathname === "/composer/preview") { window.location.assign(url.href); return true; }
      const next = url.pathname + url.search + url.hash;
      const current = location.value;
      if (replace || next !== current) {
        if (!replace) historyIndex++;
        window.history[replace ? "replaceState" : "pushState"]({ workspaceIndex: historyIndex }, "", next);
      }
      batch(() => {
        if (next !== current) routeEpoch.value += 1;
        location.value = next;
      });
      pageLoading.settle(source);
      focusDestination();
      return true;
    } catch (cause) { if (ticket === navigationTicket) error.value = cause instanceof Error ? cause.message : "Navigation failed."; return false; }
    finally { endLoading(); if (ticket === navigationTicket) busy.value = false; }
  };
  const replaceWorkspace = async (action: () => Promise<ProductionProviderIntegration>): Promise<boolean> => {
    if (replacing || traversal || busy.value) return false;
    const releaseGate = operationGate.claim("replacement"); if (!releaseGate) return false;
    replacing = true;
    const endLoading = pageLoading.begin();
    batch(() => { busy.value = true; error.value = null; });
    try {
      await flush();
      const replacement = await action();
      if (operationGate.disposed) return false;
      if (replacement === providers.value) { ready.value = true; return true; }
      const previous = resources.value;
      batch(() => {
        providers.value = replacement;
        resources.value = createWorkspaceResources(replacement, operationGate);
        ready.value = true;
      });
      previous.dispose();
      // The swap is committed once the new graph's routes have rendered.
      await flushUpdates();
      pageLoading.settle();
      return true;
    }
    catch (cause) { error.value = cause instanceof Error ? cause.message : "Workspace could not be opened. The existing workspace remains selected."; return false; }
    finally { endLoading(); replacing = false; busy.value = false; releaseGate(); }
  };
  const retry = async () => {
    batch(() => { busy.value = true; error.value = null; });
    try { const result = await providers.value.initialization.retry(); if (result.status !== "ready") throw result.error; ready.value = true; }
    catch (cause) { openingFailed(cause); }
    finally { busy.value = false; }
  };

  scope.effect(() => {
    const current = providers.value;
    onIntegration?.(current);
  });
  scope.effect(() => {
    const current = providers.value;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    ready.value = false;
    // Another tab's coordination round refuses this tab until it settles; that
    // is a wait, not a failed open, so keep the healthy opening state meanwhile.
    const failed = (cause: unknown) => {
      if (!live) return;
      if (isCoordinationBusy(cause) && Date.now() - started < OPENING_BUSY_DEADLINE_MS) timer = setTimeout(() => attempt(() => current.initialization.retry()), OPENING_BUSY_RETRY_MS);
      else openingFailed(cause);
    };
    const attempt = (open: () => ReturnType<typeof current.initialization.initialize>) => void open().then((result) => {
      if (!live) return;
      if (result.status === "ready") batch(() => { ready.value = true; error.value = null; });
      else failed(result.error);
    }).catch(failed);
    attempt(() => current.initialization.initialize());
    return () => { live = false; clearTimeout(timer); };
  });

  scope.onActivate(() => {
    const pop = (event: PopStateEvent) => {
      // The shell owns browser traversal while mounted. Feature coordinators
      // must not independently transition before the workspace save barrier.
      event.stopImmediatePropagation();
      const target = window.location.pathname + window.location.search + window.location.hash;
      const transition = traversal;
      if (transition?.phase === "committing") {
        historyIndex = transition.targetIndex;
        window.history.replaceState({ ...window.history.state, workspaceIndex: historyIndex }, "");
        traversal = null; pageLoading.settle(); transition.endLoading();
        batch(() => { routeEpoch.value += 1; location.value = target; busy.value = false; });
        focusDestination();
        return;
      }
      if (transition?.phase === "restoring") {
        if (Number.isInteger(event.state?.workspaceIndex) && event.state.workspaceIndex !== historyIndex) { window.history.go(historyIndex - event.state.workspaceIndex); return; }
        transition.phase = "waiting";
        void flush().then(() => { if (traversal !== transition) return; transition.phase = "committing"; window.history.go(transition.delta); }).catch((cause: unknown) => {
          if (traversal !== transition) return;
          traversal = null; transition.endLoading();
          batch(() => { busy.value = false; error.value = cause instanceof Error ? cause.message : "Navigation failed."; });
        });
        return;
      }
      const targetIndex = Number.isInteger(event.state?.workspaceIndex) ? event.state.workspaceIndex as number : historyIndex - 1;
      const delta = targetIndex - historyIndex;
      if (!delta) return;
      navigationTicket++; // Supersede any pending link navigation before rolling back.
      // Restore the current entry by traversal, never by overwriting the
      // destination. A rejected flush leaves Back/Forward history intact.
      traversal?.endLoading();
      traversal = { phase: "restoring", target, targetIndex, delta, endLoading: pageLoading.begin() };
      batch(() => { busy.value = true; error.value = null; });
      window.history.go(-delta);
    };
    const selection = (event: Event) => {
      const next = window.location.pathname + window.location.search + window.location.hash;
      if ((event as CustomEvent).detail === "push") historyIndex++;
      window.history.replaceState({ ...window.history.state, workspaceIndex: historyIndex }, "");
      location.value = next; pageLoading.settle();
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target || anchor.hasAttribute("download") || anchor.getAttribute("aria-disabled") === "true") return;
      const url = new URL(anchor.href);
      // Only authoring routes. `/site*` and `/website-preview*` are separate
      // visitor documents now, so taking one over here could only push it into a
      // shell that no longer renders it.
      if (url.origin !== window.location.origin || !["/", "/content", "/composer", "/mapping", "/sitemapper", "/assets", "/review"].includes(url.pathname)) return;
      event.preventDefault(); void navigate(url.href, false, anchor);
    };
    const warn = (event: BeforeUnloadEvent) => { if (providers.value.sessions.hasPending || resources.value.release.getSnapshot().busy || operationGate.kind === "replacement") { event.preventDefault(); event.returnValue = ""; } };
    const stale = () => { nativeStale.value = true; };
    window.addEventListener("popstate", pop, true);
    window.addEventListener("workspace-route-selection", selection);
    document.addEventListener("click", click);
    window.addEventListener("beforeunload", warn);
    window.addEventListener("native-authoring-stale", stale);
    return () => {
      window.removeEventListener("popstate", pop, true);
      window.removeEventListener("workspace-route-selection", selection);
      document.removeEventListener("click", click);
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("native-authoring-stale", stale);
    };
  });
  scope.effect(() => {
    const current = providers.value;
    const { release } = resources.value;
    return attachNativeAuthoringState(() => current.sessions.hasPending || operationGate.busy || release.getSnapshot().busy, async () => !operationGate.busy && !release.getSnapshot().busy && (await current.sessions.flush()).status === "ready");
  });
  // Hint other tabs (the working preview) whether this editor has unflushed
  // writes. Editor documents only — the visitor documents mounted by
  // src/main.tsx never publish.
  // The id is undefined until `initialization.initialize()` lands, and the
  // module publishes nothing until then; `ready` turning true is where the
  // resolved id is re-read.
  const publishingWorkspaceId = computed(() => {
    void ready.value;
    return providers.value.workspace.id;
  });
  scope.effect(() => {
    const current = providers.value;
    return publishPendingState({
      workspaceId: publishingWorkspaceId.value,
      getPending: () => current.sessions.hasPending,
      subscribe: (listener) => current.sessions.subscribe(listener),
    });
  });
  const path = computed(() => new URL(location.value, window.location.origin).pathname);
  scope.effect(() => {
    const current = providers.value;
    if (path.value === "/sitemapper") void current.compositionCatalog.listCompositions().catch(() => undefined);
  });

  const workspace = computed<WorkspaceServices>(() => {
    const current = providers.value;
    return {
      integration: current,
      navigate: (href, source) => navigate(href, false, source),
      reset: () => replaceWorkspace(() => current.workspace.reset()),
      open: (id) => replaceWorkspace(() => current.workspace.open(id)),
      busy,
      error,
    };
  });

  const routeView = computed<RouteView>(() => {
    const current = providers.value;
    const prefix = `${publishingWorkspaceId.value ?? "opening"}:${routeEpoch.value}`;
    if (!ready.value && !openingReason.value) return { key: `${prefix}:opening`, kind: "opening" };
    if (!ready.value) return { key: `${prefix}:opening-failed`, kind: "opening-failed" };
    const intent = parseIntent(location.value);
    const target = intent.status === "matched" ? intent.intent : null;
    const providerKnown = !target || !("providerId" in target) || (target.route === "content" ? current.contentProviders.some((provider) => provider.descriptor.id === target.providerId) : target.route === "composer" ? current.compositionProviders.some((provider) => provider.descriptor.id === target.providerId) : target.route === "mapping" ? current.mappingProviders.some((provider) => provider.descriptor.id === target.providerId) : target.route === "assets" ? current.assetProvider?.descriptor.id === target.providerId : current.sitemapProvider.descriptor?.id === target.providerId);
    if (intent.status === "invalid" || !providerKnown) {
      const message = intent.status === "invalid" ? intent.message : "The requested provider is unavailable. No other record was selected.";
      return { key: `${prefix}:invalid:${message}`, kind: "invalid", message };
    }
    // A route's identity is its path plus what its entry component is mounted
    // with: the selected provider, or the Composer's mode.
    const routeKey = target && "providerId" in target ? String(target.providerId) : target?.route === "composer" && "mode" in target ? String(target.mode) : "";
    return { key: `${prefix}:route:${path.value}:${routeKey}`, kind: "route", path: path.value, location: location.value };
  });

  function OpeningFailed() {
    const reason = openingReason;
    return <main class="cms-opening"><h1 class="cms-opening__title">Open workspace</h1>
      <p class="cms-opening__text">{computed(() => reason.value === "absent" ? "No SiteProject is activated. Create a project to start your first workspace, or activate a source and retry opening." : reason.value === "invalid" ? "The activated SiteProject is invalid. Fix the configured source, then retry opening." : "The workspace could not be read or opened. Retry opening after resolving the storage error. Existing drafts remain stored.")}</p>
      <div class="cms-opening__actions">
        <Button disabled={busy} on:click={() => void retry()}>Retry opening</Button>
        <Button disabled={computed(() => busy.value || reason.value === "absent" || reason.value === "invalid")} on:click={() => void replaceWorkspace(() => providers.value.workspace.reset())}>Create fresh workspace</Button>
        <Show when={computed(() => reason.value === "absent")}>{() => <Button disabled={busy} on:click={() => { batch(() => { error.value = null; creatingProject.value = true; }); }}>Create project</Button>}</Show>
      </div>
      <Show when={creatingProject}>{() => <NewProjectDialog busy={busy} error={error} onClose={() => { creatingProject.value = false; }} onSubmit={(name) => {
        void replaceWorkspace(async () => {
          const project = createEmptySiteProject(name);
          return providers.value.workspace.create(project, await computeSiteProjectRevision(project));
        }).then((created) => { if (created) creatingProject.value = false; });
      }} />}</Show>
    </main>;
  }

  /** One mounted route. It reads the graph and its resources once: a change of either remounts it. */
  function RouteContent({ view }: { view: ReadonlySignal<RouteView> }): Child {
    const current = view.value;
    if (current.kind === "opening") return <main class="cms-opening" aria-busy="true"><h1 class="cms-opening__title">Open workspace</h1>
      <p class="cms-opening__status" role="status"><span class="cms-opening__spinner" aria-hidden="true" />Opening the selected workspace…</p>
    </main>;
    if (current.kind === "opening-failed") return <OpeningFailed />;
    if (current.kind === "invalid") return <main class="route-placeholder"><h1>Invalid workspace link</h1><p role="alert">{current.message}</p></main>;
    const graph = providers.value;
    const owned = resources.value;
    const services: AppServices = { workspace: workspace.value, chrome, pageLoading };
    const intent = parseIntent(current.location);
    const target = intent.status === "matched" ? intent.intent : null;
    switch (current.path) {
      case "/composer":
        if (target?.route === "composer" && "mode" in target) {
          if (target.mode === "assistant") return <AssistantRoute services={services} />;
          return hostDocumentAvailable ? <HostDocumentPage services={services} /> : <NativePageRoute services={services} />;
        }
        return <>{nativeEditingAvailable && <nav class="cms-composer-entries" aria-label="Page editing entrances"><a href="/composer?native=1">Edit page</a>{assistantConfig && <a href="/composer?assistant=1">{assistantConfig.name}</a>}</nav>}<ComposerApp services={services} componentProvider={graph.componentProvider} providers={graph.compositionProviders} /></>;
      case "/content":
        return <ContentRouteContent services={services} provider={target?.route === "content" ? graph.contentProviders.find((provider) => provider.descriptor.id === target.providerId)! : graph.contentProvider} componentProvider={graph.componentProvider} createPreviewSource={graph.createContentPreviewSource} renderAssetPicker={(request) => <AssetFieldPicker services={services} provider={graph.assetProvider} {...request} />} assetPickerCapabilities={owned.assetPickerCapabilities} />;
      case "/mapping":
        return <MappingRouteContent services={services} provider={target?.route === "mapping" ? graph.mappingProviders.find((provider) => provider.descriptor.id === target.providerId)! : graph.mappingProvider} contentCatalog={graph.contentCatalog} compositionCatalog={graph.mappingCompositionCatalog} contentEntries={graph.mappingContentEntries} componentProvider={graph.componentProvider} attachmentCallbacks={owned.mappingAttachmentService} />;
      case "/sitemapper":
        return <SitemapperRouteContent services={services} provider={graph.sitemapProvider} catalog={graph.compositionCatalog} mappingCatalog={graph.sitemapperMappingCatalog} />;
      case "/assets":
        return <AssetRouteContent services={services} provider={graph.assetProvider} contentServices={owned.assetContentServices} usageHref={({ valuePath, ...location }) => formatIntent({ route: "content", ...location, ...(valuePath.length ? { valuePath } : {}) })} />;
      case "/":
        return <Dashboard services={services} summary={owned.summary} hostedDemo={hostedDemo} />;
      case "/review": {
        const release = owned.release;
        return <ReleaseRoute services={services} hostedDemo={hostedDemo} controller={release} onBeforeNewTab={flushOnPreviewActivation} href={(item) => {
          if (!("domain" in item)) return item.path.includes("assets") ? "/assets" : item.path.includes("sitemap") ? "/sitemapper" : item.path.includes("mapping") ? "/mapping" : item.path.includes("content") ? "/content" : null;
          if (item.domain === "content-entry") { const entry = release.getSnapshot().working?.providers.content.find(({ id }) => id === item.providerId)?.entries.find(({ id }) => id === item.recordId); return entry ? formatIntent({ route: "content", providerId: item.providerId, modelId: entry.modelId, entryId: entry.id }) : "/content"; }
          if (item.domain === "content-model") return formatIntent({ route: "content", providerId: item.providerId, modelId: item.recordId });
          if (item.domain === "compositions") return formatIntent({ route: "composer", providerId: item.providerId, compositionId: item.recordId });
          return item.domain === "assets" ? "/assets" : item.domain === "mappings" ? "/mapping" : item.domain === "sitemaps" ? "/sitemapper" : null;
        }} />;
      }
      default:
        return <NotFound />;
    }
  }

  return <>
    <Shell hostedDemo={hostedDemo} path={location} themeController={activeThemeController} themeSnapshot={themeSnapshot} summary={computed(() => resources.value.summary)} workspace={workspace} chrome={chrome} onBeforeNewTab={flushOnPreviewActivation}>
      <>
        <Show when={nativeStale}>{() => <p role="alert">This tab retains edits from an older draft revision. Keep and copy/export pending values before reopening current records. Old writes are blocked; reconnecting cannot overwrite the newer draft.</p>}</Show>
        {hostedDemo && <HostedDemoNotice includeExport />}
        <Keyed value={routeView} by={(view) => view.key}>{(view) => <div class="cms-route-content"><RouteContent view={view} /></div>}</Keyed>
      </>
    </Shell>
    <PageLoadingOverlay loading={pageLoading} />
  </>;
}
