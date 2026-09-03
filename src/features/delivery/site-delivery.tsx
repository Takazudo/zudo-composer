import { Component, type ComponentChildren, type JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
import { compileSiteProject, type SiteBuildPlan, type SiteCompiledRoute } from "../../site-project/compiler";
import { validateSiteProject, type SiteProject } from "../../site-project";
import type { SitemapDocument } from "../../sitemapper/model/types";
import { breadcrumbs, footerNavigation, primaryNavigation } from "./chrome";
import { matchSiteRoute, normalizeDeliveryLink, normalizeDeliveryLinks } from "./routing";
import { DeliveryRuntime, type DeliveryComponentError } from "./runtime";

type DeliveryState =
  | { status: "loading" }
  | { status: "provider-error"; message: string; retryable: boolean }
  | { status: "validation-error"; message: string }
  | { status: "compiler-error"; message: string }
  | { status: "ready"; project: SiteProject; build: SiteBuildPlan; sitemap: SitemapDocument };

function activeSitemap(project: SiteProject): SitemapDocument | undefined {
  return project.providers.sitemaps
    .find(({ id }) => id === project.activeSitemap.providerId)?.records
    .find(({ id }) => id === project.activeSitemap.recordId)?.document;
}

export async function loadDeliverySnapshot(providers: ProductionProviderIntegration): Promise<DeliveryState> {
  try {
    const snapshot = await providers.getCurrentSiteProject();
    if (snapshot.status === "error") return { status: "provider-error", message: snapshot.error.message, retryable: snapshot.error.retryable };
    const validated = validateSiteProject(snapshot.project, { componentPack: providers.componentProvider.manifest });
    if (!validated.ok) return { status: "validation-error", message: validated.diagnostics.map(({ message }) => message).join(" ") };
    const compilation = await compileSiteProject(validated.project, { componentCatalog: providers.componentProvider.catalog });
    if (compilation.status === "blocked") return { status: "compiler-error", message: compilation.diagnostics.map(({ message }) => message).join(" ") };
    const sitemap = activeSitemap(validated.project);
    return sitemap ? { status: "ready", project: validated.project, build: compilation.build, sitemap } : { status: "validation-error", message: "The active Sitemap is unavailable." };
  } catch (error) {
    return { status: "provider-error", message: error instanceof Error ? error.message : "The delivery snapshot failed.", retryable: true };
  }
}

async function retryDeliverySnapshot(providers: ProductionProviderIntegration): Promise<DeliveryState> {
  try {
    const recovery = await providers.initialization.retry();
    if (recovery.status === "error") return { status: "provider-error", message: recovery.error.message, retryable: recovery.error.retryable };
    return loadDeliverySnapshot(providers);
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

function DeliveryChrome({ project, build, sitemap, route, pack, report, focus, onFocused }: { project: SiteProject; build: SiteBuildPlan; sitemap: SitemapDocument; route: SiteCompiledRoute; pack: ProductionProviderIntegration["componentProvider"]["pack"]; report: (detail: DeliveryComponentError) => void; focus?: boolean; onFocused?: () => void }): JSX.Element {
  const content = useRef<HTMLElement>(null);
  const primary = primaryNavigation(sitemap, build.routes, route.sitemapNode.id, route.pathname);
  const crumbs = breadcrumbs(sitemap, build.routes, route.sitemapNode.id, route.pathname);
  const footer = footerNavigation(sitemap, build.routes, route.sitemapNode.id, route.pathname);
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    normalizeDeliveryLinks(root);
    const observer = new MutationObserver(() => normalizeDeliveryLinks(root));
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["href"] });
    return () => { observer.disconnect(); };
  }, [route]);
  useEffect(() => { if (focus) { content.current?.focus(); onFocused?.(); } }, [focus, onFocused]);
  const guardLink = (event: JSX.TargetedMouseEvent<HTMLElement>): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a") : null;
    if (!target || !content.current?.contains(target)) return;
    if (!target.closest(".zc-prose-md")) return;
    const hadHref = target.hasAttribute("href");
    if (hadHref && normalizeDeliveryLink(target) === undefined) event.preventDefault();
  };
  return <div class="site-delivery">
    <a class="site-delivery__skip" href="#main-content">Skip to main content</a>
    <header class="site-delivery__header">
      <a class="site-delivery__brand" href="/site">{project.name}</a>
      <nav aria-label="Primary navigation"><ul>{primary.map((item) => <li key={item.id}><a href={item.href} data-active={item.active || undefined} aria-current={item.current ? "page" : undefined}>{item.title}</a></li>)}</ul></nav>
    </header>
    {crumbs.length > 1 && <nav class="site-delivery__breadcrumbs" aria-label="Breadcrumb"><ol>{crumbs.map((item, index) => <li key={item.id}>{index < crumbs.length - 1 ? <a href={item.href}>{item.title}</a> : <span aria-current="page">{item.title}</span>}</li>)}</ol></nav>}
    <main ref={content} class="site-delivery__main" id="main-content" tabIndex={-1} onClickCapture={guardLink}><DeliveryRuntime composition={route.composition} pack={pack} onComponentError={report} /></main>
    <footer class="site-delivery__footer"><p>{project.name}</p><nav aria-label="Footer navigation"><ul>{footer.map((item) => <li key={item.id}><a href={item.href} aria-current={item.current ? "page" : undefined}>{item.title}</a></li>)}</ul></nav></footer>
  </div>;
}

export function SiteDelivery({ providers, pathname = window.location.pathname, onComponentError = (detail) => console.error("Delivery component failed", detail) }: { providers: ProductionProviderIntegration; pathname?: string; onComponentError?: (detail: DeliveryComponentError) => void }): JSX.Element {
  const [state, setState] = useState<DeliveryState>({ status: "loading" });
  const request = useRef(0);
  const focusAfterRetry = useRef(false);
  useEffect(() => {
    const current = ++request.current;
    void loadDeliverySnapshot(providers).then((next) => { if (request.current === current) setState(next); });
    return () => { request.current += 1; };
  }, [providers]);
  const route = state.status === "ready" ? matchSiteRoute(state.build.routes, pathname) : undefined;
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
    void retryDeliverySnapshot(providers).then((next) => { if (request.current === current) setState(next); });
  };
  if (state.status === "loading") return <StateMessage heading="Loading site" message="Preparing the latest published content…" busy />;
  if (state.status === "provider-error") return <StateMessage heading="Site unavailable" message={<>The latest site data could not be loaded. {state.message}</>} focus={focusAfterRetry.current} onFocused={completeRetryFocus}>{state.retryable && <button type="button" onClick={retry}>Retry loading site</button>}</StateMessage>;
  if (state.status === "validation-error") return <StateMessage heading="Site data blocked" message={<>The latest site data did not pass validation. {state.message}</>} focus={focusAfterRetry.current} onFocused={completeRetryFocus} />;
  if (state.status === "compiler-error") return <StateMessage heading="Site build blocked" message={<>This site cannot be published until its configuration is fixed. {state.message}</>} focus={focusAfterRetry.current} onFocused={completeRetryFocus} />;
  if (!route) return <StateMessage heading="Page not found" message="This page is not present in the current Sitemap." focus={focusAfterRetry.current} onFocused={completeRetryFocus}><a href="/site">Return to site home</a></StateMessage>;
  return <DeliveryGuard><DeliveryChrome project={state.project} build={state.build} sitemap={state.sitemap} route={route} pack={providers.componentProvider.pack} report={onComponentError} focus={focusAfterRetry.current} onFocused={completeRetryFocus} /></DeliveryGuard>;
}
