import { Component, type ComponentChildren, type JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
import { type SiteBuildPlan, type SiteCompiledRoute } from "../../site-project/compiler";
import { compileWithCapturedMedia } from "../../site-project/media/compile";
import { validateMediaSnapshot } from "../../media/model";
import type { WorkspaceCapture } from "../../app/workspace-snapshot";
import { validateSiteProject, type SiteProject } from "../../site-project";
import type { SitemapDocument } from "../../sitemapper/model/types";
import { breadcrumbs, footerNavigation, primaryNavigation } from "./chrome";
import { normalizeDeliveryLink, normalizeDeliveryLinks } from "./routing";
import { DeliveryRuntime, type DeliveryComponentError } from "./runtime";
import { matchDeliveryRoute } from "./routing";
import { validateActivatedDeliveryArtifact, type DeliverySourceContract } from "./source";

type DeliveryState =
  | { status: "loading" }
  | { status: "provider-error"; message: string; retryable: boolean }
  | { status: "validation-error"; message: string }
  | { status: "compiler-error"; message: string }
  | { status: "ready"; sourceKind: "activated-local" | "bundled-static" | "working-preview"; project: SiteProject; build: SiteBuildPlan; sitemap: SitemapDocument };

function activeSitemap(project: SiteProject): SitemapDocument | undefined {
  return project.providers.sitemaps
    .find(({ id }) => id === project.activeSitemap.providerId)?.records
    .find(({ id }) => id === project.activeSitemap.recordId)?.document;
}

export async function loadWorkingPreviewSnapshot(providers: ProductionProviderIntegration): Promise<DeliveryState> {
  try {
    let project: SiteProject;
    let capture: WorkspaceCapture | undefined;
    if (providers.mediaProvider) {
      const snapshot = await providers.captureWorkspace();
      if (snapshot.status !== "ready") return { status: "provider-error", message: snapshot.status === "unavailable" ? snapshot.error.message : `Workspace capture ${snapshot.status}; retry after completing pending edits.`, retryable: true };
      project = snapshot.project; capture = snapshot.capture;
    } else {
      // Static/committed assets need no authoring provider. This is explicitly
      // detached output, not proof of cross-domain release currentness.
      const snapshot = await providers.getCurrentSiteProject({ flushSessions: true });
      if (snapshot.status === "error") return { status: "provider-error", message: snapshot.error.message, retryable: snapshot.error.retryable };
      project = snapshot.project;
    }
    const validated = validateSiteProject(project, { componentPack: providers.componentProvider.manifest });
    if (!validated.ok) return { status: "validation-error", message: validated.diagnostics.map(({ message }) => message).join(" ") };
    const mediaSnapshot = capture?.values[`media:${providers.mediaProvider?.descriptor.id}`];
    if (capture && !validateMediaSnapshot(mediaSnapshot)) return { status: "compiler-error", message: "Aggregate capture has no valid Media snapshot." };
    const compilation = await compileWithCapturedMedia(validated.project, { catalog: providers.componentProvider.catalog, mediaStore: providers.mediaProvider?.store,
      ...(capture ? { snapshot: mediaSnapshot as import("../../media/model").MediaSnapshot, isCaptureCurrent: () => providers.isCaptureCurrent(capture!) } : {}),
    });
    if (compilation.status === "blocked") return { status: "compiler-error", message: compilation.diagnostics.map(({ message }) => message).join(" ") };
    const sitemap = activeSitemap(validated.project);
    return sitemap ? { status: "ready", sourceKind: "working-preview", project: validated.project, build: compilation.build, sitemap } : { status: "validation-error", message: "The active Sitemap is unavailable." };
  } catch (error) {
    return { status: "provider-error", message: error instanceof Error ? error.message : "The delivery snapshot failed.", retryable: true };
  }
}

export async function loadDeliverySnapshot(source: DeliverySourceContract): Promise<DeliveryState> {
  if (source.kind === "working-preview") return loadWorkingPreviewSnapshot(source.providers);
  const selected = source.read();
  if (selected.status === "no-active") return { status: "provider-error", message: selected.message, retryable: true };
  if (selected.status === "error") return { status: "provider-error", message: selected.message, retryable: true };
  const integrity = validateActivatedDeliveryArtifact(selected.artifact);
  if (integrity) return { status: "compiler-error", message: integrity };
  const validated = validateSiteProject(structuredClone(selected.artifact.project), { componentPack: source.componentProvider.manifest });
  if (!validated.ok) return { status: "validation-error", message: validated.diagnostics.map(({ message }) => message).join(" ") };
  const sitemap = activeSitemap(validated.project);
  return sitemap ? { status: "ready", sourceKind: selected.artifact.kind, project: validated.project, build: structuredClone(selected.artifact.build), sitemap } : { status: "validation-error", message: "The activated Sitemap is unavailable." };
}

async function retryDeliverySnapshot(source: DeliverySourceContract): Promise<DeliveryState> {
  try {
    if (source.kind === "working-preview") { const recovery = await source.providers.initialization.retry(); if (recovery.status === "error") return { status: "provider-error", message: recovery.error.message, retryable: recovery.error.retryable }; }
    return loadDeliverySnapshot(source);
  } catch (error) {
    return { status: "provider-error", message: error instanceof Error ? error.message : "The delivery snapshot retry failed.", retryable: true };
  }
}

class DeliveryGuard extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  state = { failed: false };
  componentDidCatch(error: unknown): void { console.error("Delivery page failed", error); this.setState({ failed: true }); }
  render(): ComponentChildren { return this.state.failed ? <main class="site-delivery__state"><h1>Page unavailable</h1><p>This page could not be displayed safely.</p></main> : this.props.children; }
}

function StateMessage({ heading, message, children, busy, focus, onFocused }: { heading: string; message: ComponentChildren; children?: ComponentChildren; busy?: boolean; focus?: boolean; onFocused?: () => void }): JSX.Element {
  const root = useRef<HTMLElement>(null);
  useEffect(() => { if (focus) { root.current?.focus(); onFocused?.(); } }, [focus, onFocused]);
  return <main ref={root} class="site-delivery__state" data-site-delivery-state tabIndex={-1} aria-busy={busy || undefined}>
    <div role="status" aria-live="polite" aria-atomic="true"><h1>{heading}</h1><p>{message}</p></div>
    {children}
  </main>;
}

function DeliveryChrome({ project, build, sitemap, route, pack, report, focus, onFocused, basePath, label }: { project: SiteProject; build: SiteBuildPlan; sitemap: SitemapDocument; route: SiteCompiledRoute; pack: ProductionProviderIntegration["componentProvider"]["pack"]; report: (detail: DeliveryComponentError) => void; focus?: boolean; onFocused?: () => void; basePath: "/site" | "/website-preview"; label: string }): JSX.Element {
  const content = useRef<HTMLElement>(null);
  const primary = primaryNavigation(sitemap, build.routes, route.sitemapNode.id, route.pathname, basePath);
  const crumbs = breadcrumbs(sitemap, build.routes, route.sitemapNode.id, route.pathname, basePath);
  const footer = footerNavigation(sitemap, build.routes, route.sitemapNode.id, route.pathname, basePath);
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    normalizeDeliveryLinks(root, basePath);
    const observer = new MutationObserver(() => normalizeDeliveryLinks(root, basePath));
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["href"] });
    return () => { observer.disconnect(); };
  }, [route, basePath]);
  useEffect(() => { if (focus) { content.current?.focus(); onFocused?.(); } }, [focus, onFocused]);
  const guardLink = (event: JSX.TargetedMouseEvent<HTMLElement>): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a") : null;
    if (!target || !content.current?.contains(target)) return;
    if (!target.closest(".zc-prose-md")) return;
    const hadHref = target.hasAttribute("href");
    if (hadHref && normalizeDeliveryLink(target, basePath) === undefined) event.preventDefault();
  };
  return <div class="site-delivery">
    <a class="site-delivery__skip" href="#main-content">Skip to main content</a>
    <header class="site-delivery__header">
      <a class="site-delivery__brand" href={basePath}>{project.name}</a><span class="site-delivery__source-label">{label}</span>
      <nav aria-label="Primary navigation"><ul>{primary.map((item) => <li key={item.id}><a href={item.href} data-active={item.active || undefined} aria-current={item.current ? "page" : undefined}>{item.title}</a></li>)}</ul></nav>
    </header>
    {crumbs.length > 1 && <nav class="site-delivery__breadcrumbs" aria-label="Breadcrumb"><ol>{crumbs.map((item, index) => <li key={item.id}>{index < crumbs.length - 1 ? <a href={item.href}>{item.title}</a> : <span aria-current="page">{item.title}</span>}</li>)}</ol></nav>}
    <main ref={content} class="site-delivery__main" id="main-content" tabIndex={-1} onClickCapture={guardLink}><DeliveryRuntime composition={route.composition} pack={pack} onComponentError={report} basePath={basePath} /></main>
    <footer class="site-delivery__footer"><p>{project.name}</p><nav aria-label="Footer navigation"><ul>{footer.map((item) => <li key={item.id}><a href={item.href} aria-current={item.current ? "page" : undefined}>{item.title}</a></li>)}</ul></nav></footer>
  </div>;
}

export function SiteDelivery({ source, pathname = window.location.pathname, onComponentError = (detail) => console.error("Delivery component failed", detail) }: { source: DeliverySourceContract; pathname?: string; onComponentError?: (detail: DeliveryComponentError) => void }): JSX.Element {
  const [state, setState] = useState<DeliveryState>({ status: "loading" });
  const request = useRef(0);
  const focusAfterRetry = useRef(false);
  useEffect(() => {
    const current = ++request.current;
    void loadDeliverySnapshot(source).then((next) => { if (request.current === current) setState(next); });
    return () => { request.current += 1; };
  }, [source]);
  useEffect(() => source.kind === "activated" && source.subscribe ? source.subscribe(() => { const current = ++request.current; setState({ status: "loading" }); void loadDeliverySnapshot(source).then((next) => { if (request.current === current) setState(next); }); }) : undefined, [source]);
  const basePath = source.kind === "activated" ? "/site" : "/website-preview";
  const route = state.status === "ready" ? matchDeliveryRoute(state.build.routes, pathname, basePath) : undefined;
  const routeTitle = route?.displayTitle;
  const pageTitle = state.status === "ready"
    ? `${routeTitle ?? "Page not found"} — ${state.project.name}`
    : state.status === "loading"
      ? "Loading site — Site delivery"
      : state.status === "provider-error"
        ? "Site unavailable — Site delivery"
        : state.status === "validation-error"
          ? "Site data blocked — Site delivery"
          : "Site build blocked — Site delivery";
  useEffect(() => {
    const prior = document.title;
    document.title = pageTitle;
    return () => { document.title = prior; };
  }, [pageTitle]);
  const completeRetryFocus = (): void => { focusAfterRetry.current = false; };
  const retry = (): void => {
    const current = ++request.current;
    focusAfterRetry.current = true;
    setState({ status: "loading" });
    void retryDeliverySnapshot(source).then((next) => { if (request.current === current) setState(next); });
  };
  if (state.status === "loading") return <StateMessage heading="Loading site" message={source.kind === "activated" ? "Reading the completed activated local release…" : "Flushing and compiling the live working draft…"} busy />;
  if (state.status === "provider-error") return <StateMessage heading="Site unavailable" message={<>{source.kind === "activated" ? "The activated local release could not be loaded. " : "The live working draft could not be loaded. "}{state.message}</>} focus={focusAfterRetry.current} onFocused={completeRetryFocus}>{state.retryable && <button type="button" onClick={retry}>Retry loading site</button>}</StateMessage>;
  if (state.status === "validation-error") return <StateMessage heading="Site data blocked" message={<>The latest site data did not pass validation. {state.message}</>} focus={focusAfterRetry.current} onFocused={completeRetryFocus} />;
  if (state.status === "compiler-error") return <StateMessage heading="Site build blocked" message={<>This site cannot be published until its configuration is fixed. {state.message}</>} focus={focusAfterRetry.current} onFocused={completeRetryFocus} />;
  if (!route) return <StateMessage heading="Page not found" message="This page is not present in the selected delivery snapshot." focus={focusAfterRetry.current} onFocused={completeRetryFocus}><a href={basePath}>Return to site home</a></StateMessage>;
  const componentProvider = source.kind === "activated" ? source.componentProvider : source.providers.componentProvider;
  const label = state.sourceKind === "working-preview" ? "Live working preview — not activated" : state.sourceKind === "activated-local" ? "Activated local release — not deployed" : "Bundled static sample";
  return <DeliveryGuard><DeliveryChrome project={state.project} build={state.build} sitemap={state.sitemap} route={route} pack={componentProvider.pack} report={onComponentError} focus={focusAfterRetry.current} onFocused={completeRetryFocus} basePath={basePath} label={label} /></DeliveryGuard>;
}
