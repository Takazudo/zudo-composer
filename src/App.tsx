import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Dashboard } from "./app/dashboard";
import { createProductionProviderIntegration, type ProductionProviderIntegration } from "./app/provider-integration";
import { WorkspaceContext, useWorkspace } from "./app/workspace-context";
import { parseIntent, formatIntent } from "./app/route-intents";
import { Button } from "./components/ui";
import { workspaceDatabaseName, type WorkspaceRecord } from "./app/workspace-storage";
import { CONTENT_DATABASE_NAME } from "./content";
import { subscribePersistenceChanges } from "./shared/persistence-generation";
import { Shell } from "./app/shell";
import { createWorkspaceSummary } from "./app/workspace-summary";
import ComposerApp from "./features/composer/chrome/composer-app";
import { ContentRouteContent } from "./features/content";
import { MappingRouteContent } from "./features/mapping";
import { MediaFieldPicker, MediaRouteContent, createMediaContentServices } from "./features/media";
import { SitemapperRouteContent } from "./features/sitemapper";
import { SiteDelivery } from "./features/delivery/site-delivery";
import { isSitePath } from "./features/delivery/routing";
import { bootstrapTheme, createThemeController, type ThemeController } from "./theme/theme";

function NotFound() { return <main class="route-placeholder"><h1>Not found</h1><p>This standalone route does not exist.</p><a href="/">Return home</a></main>; }

export interface AppProps {
  /** Main bootstrapping supplies the already-observing controller. */
  themeController?: ThemeController;
  integration?: ProductionProviderIntegration;
}

export function App({ themeController, integration }: AppProps = {}) {
  const ownedThemeController = useMemo(
    () => (themeController ? null : createThemeController(bootstrapTheme())),
    [themeController],
  );
  const activeThemeController = themeController ?? ownedThemeController!;
  const [themeSnapshot, setThemeSnapshot] = useState(() => activeThemeController.getSnapshot());

  useEffect(() => {
    setThemeSnapshot(activeThemeController.getSnapshot());
    return activeThemeController.subscribe(setThemeSnapshot);
  }, [activeThemeController]);
  useEffect(() => () => ownedThemeController?.dispose(), [ownedThemeController]);

  const [providers, setProviders] = useState(() => integration ?? createProductionProviderIntegration());
  const [location, setLocation] = useState(() => window.location.pathname + window.location.search + window.location.hash);
  const [routeEpoch, setRouteEpoch] = useState(0);
  const locationRef = useRef(location);
  locationRef.current = location;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const navigationTicket = useRef(0);
  const replacing = useRef(false);
  const historyIndex = useRef<number>(Number.isInteger(window.history.state?.workspaceIndex) ? window.history.state.workspaceIndex : 0);
  const traversal = useRef<{ phase: "restoring" | "waiting" | "committing"; target: string; targetIndex: number; delta: number } | null>(null);
  useEffect(() => { window.history.replaceState({ ...window.history.state, workspaceIndex: historyIndex.current }, ""); }, []);
  const flush = async () => {
    const outcome = await providers.sessions.flush();
    if (outcome.status === "failed") throw new Error(outcome.failures.map((failure) => `${failure.feature} (${failure.providerId}${failure.recordId ? ` / ${failure.recordId}` : ""}): ${failure.error.message}`).join("; "));
    if (outcome.status === "changed") throw new Error("Edits changed while saving. Finish the edit and try navigation again.");
  };
  const navigate = async (href: string, replace = false): Promise<boolean> => {
    if (replacing.current || traversal.current) return false;
    const ticket = ++navigationTicket.current;
    setBusy(true); setError(null);
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) throw new Error("This is not a workspace destination.");
      await flush();
      if (ticket !== navigationTicket.current) return false;
      if (isSitePath(url.pathname) || url.pathname === "/composer/preview") { window.location.assign(url.href); return true; }
      const next = url.pathname + url.search + url.hash;
      if (next !== locationRef.current) setRouteEpoch((value) => value + 1);
      if (replace || next !== locationRef.current) {
        if (!replace) historyIndex.current++;
        window.history[replace ? "replaceState" : "pushState"]({ workspaceIndex: historyIndex.current }, "", next);
      }
      setLocation(next);
      requestAnimationFrame(() => document.getElementById("workspace-destination")?.focus());
      return true;
    } catch (cause) { if (ticket === navigationTicket.current) setError(cause instanceof Error ? cause.message : "Navigation failed."); return false; }
    finally { if (ticket === navigationTicket.current) setBusy(false); }
  };
  const replaceWorkspace = async (action: () => Promise<ProductionProviderIntegration>): Promise<boolean> => {
    if (replacing.current || traversal.current || busy) return false;
    replacing.current = true;
    setBusy(true); setError(null);
    try { await flush(); const replacement = await action(); setProviders(replacement); setReady(true); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace could not be opened. The existing workspace remains selected."); return false; }
    finally { replacing.current = false; setBusy(false); }
  };
  const retry = async () => {
    setBusy(true); setError(null);
    try { const result = await providers.initialization.retry(); if (result.status !== "ready") throw result.error; setReady(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace initialization failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let live = true;
    setReady(false);
    void providers.initialization.initialize().then((result) => {
      if (!live) return;
      if (result.status === "ready") { setReady(true); setError(null); }
      else setError(result.error.message);
    }).catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : "Workspace initialization failed."); });
    return () => { live = false; };
  }, [providers]);
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      // The shell owns browser traversal while mounted. Feature coordinators
      // must not independently transition before the workspace save barrier.
      event.stopImmediatePropagation();
      const target = window.location.pathname + window.location.search + window.location.hash;
      const transition = traversal.current;
      if (transition?.phase === "committing") {
        historyIndex.current = transition.targetIndex;
        window.history.replaceState({ ...window.history.state, workspaceIndex: historyIndex.current }, "");
        traversal.current = null;
        setRouteEpoch((value) => value + 1); setLocation(target); setBusy(false);
        requestAnimationFrame(() => document.getElementById("workspace-destination")?.focus());
        return;
      }
      if (transition?.phase === "restoring") {
        if (Number.isInteger(event.state?.workspaceIndex) && event.state.workspaceIndex !== historyIndex.current) { window.history.go(historyIndex.current - event.state.workspaceIndex); return; }
        transition.phase = "waiting";
        void flush().then(() => { if (traversal.current !== transition) return; transition.phase = "committing"; window.history.go(transition.delta); }).catch((cause: unknown) => {
          if (traversal.current !== transition) return;
          traversal.current = null; setBusy(false); setError(cause instanceof Error ? cause.message : "Navigation failed.");
        });
        return;
      }
      const targetIndex = Number.isInteger(event.state?.workspaceIndex) ? event.state.workspaceIndex as number : historyIndex.current - 1;
      const delta = targetIndex - historyIndex.current;
      if (!delta) return;
      navigationTicket.current++; // Supersede any pending link navigation before rolling back.
      // Restore the current entry by traversal, never by overwriting the
      // destination. A rejected flush leaves Back/Forward history intact.
      traversal.current = { phase: "restoring", target, targetIndex, delta };
      setBusy(true); setError(null); window.history.go(-delta);
    };
    const selection = (event: Event) => {
      const next = window.location.pathname + window.location.search + window.location.hash;
      if ((event as CustomEvent).detail === "push") historyIndex.current++;
      window.history.replaceState({ ...window.history.state, workspaceIndex: historyIndex.current }, "");
      locationRef.current = next; setLocation(next);
    };
    const click = (event: MouseEvent) => {
      if (isSitePath(new URL(locationRef.current, window.location.origin).pathname)) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target || anchor.hasAttribute("download") || anchor.getAttribute("aria-disabled") === "true") return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || !["/", "/content", "/composer", "/mapping", "/sitemapper", "/media", "/review", "/website-preview", "/site"].includes(url.pathname)) return;
      event.preventDefault(); void navigate(url.href);
    };
    window.addEventListener("popstate", pop, true);
    window.addEventListener("workspace-route-selection", selection);
    document.addEventListener("click", click);
    return () => { window.removeEventListener("popstate", pop, true); window.removeEventListener("workspace-route-selection", selection); document.removeEventListener("click", click); };
  });
  // One read model for the whole chrome; the rail's counts come from it, and
  // the Dashboard route reuses this instance rather than initializing a second.
  const workspaceSummary = useMemo(() => createWorkspaceSummary(providers), [providers]);
  const mediaContentServices = useMemo(() => createMediaContentServices(
    providers.contentProviders,
    () => providers.sessions.flush(),
    (listener) => subscribePersistenceChanges((database) => {
      const workspaceId = providers.workspace.id;
      if (workspaceId && database === workspaceDatabaseName(CONTENT_DATABASE_NAME, workspaceId)) listener();
    }),
  ), [providers]);
  const mappingAttachmentService = useMemo(() => providers.mappingAttachmentService, [providers]);
  useEffect(() => () => workspaceSummary.dispose?.(), [workspaceSummary]);
  const path = new URL(location, window.location.origin).pathname;
  useEffect(() => { if (path === "/sitemapper") void providers.compositionCatalog.listCompositions().catch(() => undefined); }, [path, providers]);
  if (isSitePath(path)) return <SiteDelivery providers={providers} pathname={path} />;
  let content: ComponentChildren;
  const intent = parseIntent(location);
  const target = intent.status === "matched" ? intent.intent : null;
  const providerKnown = !target || !("providerId" in target) || (target.route === "content" ? providers.contentProviders.some((provider) => provider.descriptor.id === target.providerId) : target.route === "composer" ? providers.compositionProviders.some((provider) => provider.descriptor.id === target.providerId) : target.route === "mapping" ? providers.mappingProviders.some((provider) => provider.descriptor.id === target.providerId) : target.route === "media" ? providers.mediaProvider?.descriptor.id === target.providerId : providers.sitemapProvider.descriptor?.id === target.providerId);
  if (!ready) content = <main class="route-placeholder"><h1>Open workspace</h1><p>{error ? "The workspace is unavailable. Retry opening it, or create a new workspace from the configured source. Existing drafts remain stored." : "Opening the selected workspace…"}</p><Button disabled={busy} onClick={() => void retry()}>Retry opening</Button><Button disabled={busy} onClick={() => void replaceWorkspace(() => providers.workspace.reset())}>Create fresh workspace</Button></main>;
  else if (intent.status === "invalid" || !providerKnown) content = <main class="route-placeholder"><h1>Invalid workspace link</h1><p role="alert">{intent.status === "invalid" ? intent.message : "The requested provider is unavailable. No other record was selected."}</p></main>;
  else if (path === "/composer") content = <ComposerApp componentProvider={providers.componentProvider} providers={providers.compositionProviders} />;
  else if (path === "/content") content = <ContentRouteContent provider={target?.route === "content" ? providers.contentProviders.find((provider) => provider.descriptor.id === target.providerId)! : providers.contentProvider} componentProvider={providers.componentProvider} createPreviewSource={providers.createContentPreviewSource} renderMediaPicker={(request) => <MediaFieldPicker provider={providers.mediaProvider} {...request} />} />;
  else if (path === "/mapping") content = <MappingRouteContent provider={target?.route === "mapping" ? providers.mappingProviders.find((provider) => provider.descriptor.id === target.providerId)! : providers.mappingProvider} contentCatalog={providers.contentCatalog} compositionCatalog={providers.mappingCompositionCatalog} contentEntries={providers.mappingContentEntries} componentProvider={providers.componentProvider} attachmentCallbacks={mappingAttachmentService} />;
  else if (path === "/sitemapper") content = <SitemapperRouteContent provider={providers.sitemapProvider} catalog={providers.compositionCatalog} mappingCatalog={providers.sitemapperMappingCatalog} />;
  else if (path === "/media") content = <MediaRouteContent provider={providers.mediaProvider} contentServices={mediaContentServices} usageHref={({ valuePath, ...location }) => formatIntent({ route: "content", ...location, ...(valuePath.length ? { valuePath } : {}) })} />;
  else if (path === "/") content = <Dashboard summary={workspaceSummary} />;
  else if (path === "/review") content = <main class="route-placeholder"><h1>Review & release</h1><p>Release checks and activation are not available in this workspace yet.</p><p>Preview does not approve or publish changes.</p></main>;
  else if (path === "/website-preview") content = <WebsitePreview />;
  else content = <NotFound />;
  return <WorkspaceContext.Provider value={{ integration: providers, navigate, reset: () => replaceWorkspace(() => providers.workspace.reset()), open: (id) => replaceWorkspace(() => providers.workspace.open(id)), busy, error }}><Shell path={location} themeController={activeThemeController} themeSnapshot={themeSnapshot} summary={workspaceSummary}><div key={`${providers.workspace.id ?? "opening"}:${routeEpoch}`} class="cms-route-content">{content}</div></Shell></WorkspaceContext.Provider>;
}

function WebsitePreview() {
  const workspace = useWorkspace()!;
  const [metadata, setMetadata] = useState<WorkspaceRecord | null>(null);
  const [sitemaps, setSitemaps] = useState<readonly { id: string; document: { name: string } }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const session = useRef<ReturnType<typeof workspace.integration.sessions.register> | null>(null);
  useEffect(() => {
    const registered = workspace.integration.sessions.register({ feature: "Project metadata", providerId: "workspace", workspaceId: workspace.integration.workspace.id }, { flush: () => pending.current });
    session.current = registered;
    return () => { registered.detach(); session.current = null; };
  }, [workspace.integration]);
  useEffect(() => { let live = true; void Promise.all([workspace.integration.workspace.metadata(), workspace.integration.sitemapProvider.store.list()]).then(([value, records]) => { if (live) { setMetadata(value); setSitemaps(records.map((record) => ({ id: record.id, document: { name: record.name } }))); } }).catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : "Preview metadata unavailable."); }); return () => { live = false; }; }, [workspace.integration]);
  return <main class="route-placeholder"><h1>Website preview</h1><p>The current visitor route renders the live workspace draft. It is not an approved or activated release preview.</p>{error && <p role="alert">{error}</p>}<label>Active Sitemap<select disabled={!metadata || saving} value={metadata?.metadata.activeSitemap.recordId ?? ""} onChange={(event) => {
    if (!metadata) return;
    const recordId = event.currentTarget.value;
    setSaving(true); setError(null);
    session.current?.changed();
    pending.current = workspace.integration.workspace.updateMetadata(metadata.mutationToken, { activeSitemap: { providerId: metadata.metadata.activeSitemap.providerId, recordId } }).then(setMetadata);
    void pending.current.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Sitemap selection failed.")).finally(() => setSaving(false));
  }}><option value="" disabled>Select a Sitemap</option>{sitemaps.map((sitemap) => <option value={sitemap.id} key={sitemap.id}>{sitemap.document.name}</option>)}</select></label><p><a href="/site">Open live draft website</a></p><p>Activated release preview is unavailable until the release delivery service is connected.</p></main>;
}
