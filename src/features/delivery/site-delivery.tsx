import { Component, type ComponentChildren, type JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ProductionProviderIntegration } from "../../app/provider-integration";
import { compileSiteProject, type SiteBuildPlan, type SiteCompiledRoute } from "../../site-project/compiler";
import { validateSiteProject, type SiteProject } from "../../site-project";
import type { SitemapDocument } from "../../sitemapper/model/types";
import { breadcrumbs, footerNavigation, primaryNavigation } from "./chrome";
import { matchSiteRoute } from "./routing";
import { DeliveryRuntime, type DeliveryComponentError } from "./runtime";

type DeliveryState =
  | { status: "loading" }
  | { status: "provider-error"; message: string }
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
    if (snapshot.status === "error") return { status: "provider-error", message: snapshot.error.message };
    const validated = validateSiteProject(snapshot.project, { componentPack: providers.componentProvider.manifest });
    if (!validated.ok) return { status: "validation-error", message: validated.diagnostics.map(({ message }) => message).join(" ") };
    const compilation = await compileSiteProject(validated.project, { componentCatalog: providers.componentProvider.catalog });
    if (compilation.status === "blocked") return { status: "compiler-error", message: compilation.diagnostics.map(({ message }) => message).join(" ") };
    const sitemap = activeSitemap(validated.project);
    return sitemap ? { status: "ready", project: validated.project, build: compilation.build, sitemap } : { status: "validation-error", message: "The active Sitemap is unavailable." };
  } catch (error) {
    return { status: "provider-error", message: error instanceof Error ? error.message : "The delivery snapshot failed." };
  }
}

class DeliveryGuard extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  state = { failed: false };
  componentDidCatch(error: unknown): void { console.error("Delivery page failed", error); this.setState({ failed: true }); }
  render(): ComponentChildren { return this.state.failed ? <main class="site-delivery__state"><h1>Page unavailable</h1><p>This page could not be displayed safely.</p></main> : this.props.children; }
}

function StateMessage({ heading, children, busy }: { heading: string; children: ComponentChildren; busy?: boolean }): JSX.Element {
  return <main class="site-delivery__state" aria-busy={busy || undefined}><h1>{heading}</h1><p>{children}</p></main>;
}

function DeliveryChrome({ project, build, sitemap, route, pack, report }: { project: SiteProject; build: SiteBuildPlan; sitemap: SitemapDocument; route: SiteCompiledRoute; pack: ProductionProviderIntegration["componentProvider"]["pack"]; report: (detail: DeliveryComponentError) => void }): JSX.Element {
  const primary = primaryNavigation(sitemap, build.routes, route.sitemapNode.id, route.pathname);
  const crumbs = breadcrumbs(sitemap, build.routes, route.sitemapNode.id, route.pathname);
  const footer = footerNavigation(sitemap, build.routes, route.sitemapNode.id, route.pathname);
  return <div class="site-delivery">
    <header class="site-delivery__header">
      <a class="site-delivery__brand" href="/site">{project.name}</a>
      <nav aria-label="Primary navigation"><ul>{primary.map((item) => <li key={item.id}><a href={item.href} data-active={item.active || undefined} aria-current={item.current ? "page" : undefined}>{item.title}</a></li>)}</ul></nav>
    </header>
    {crumbs.length > 1 && <nav class="site-delivery__breadcrumbs" aria-label="Breadcrumb"><ol>{crumbs.map((item, index) => <li key={item.id}>{index < crumbs.length - 1 ? <a href={item.href}>{item.title}</a> : <span aria-current="page">{item.title}</span>}</li>)}</ol></nav>}
    <main class="site-delivery__main" id="main-content"><DeliveryRuntime composition={route.composition} pack={pack} onComponentError={report} /></main>
    <footer class="site-delivery__footer"><p>{project.name}</p><nav aria-label="Footer navigation"><ul>{footer.map((item) => <li key={item.id}><a href={item.href} aria-current={item.current ? "page" : undefined}>{item.title}</a></li>)}</ul></nav></footer>
  </div>;
}

export function SiteDelivery({ providers, pathname = window.location.pathname, onComponentError = (detail) => console.error("Delivery component failed", detail) }: { providers: ProductionProviderIntegration; pathname?: string; onComponentError?: (detail: DeliveryComponentError) => void }): JSX.Element {
  const [state, setState] = useState<DeliveryState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    void loadDeliverySnapshot(providers).then((next) => { if (current) setState(next); });
    return () => { current = false; };
  }, [providers]);
  if (state.status === "loading") return <StateMessage heading="Loading site" busy>Preparing the latest published content…</StateMessage>;
  if (state.status === "provider-error") return <StateMessage heading="Site unavailable">The latest site data could not be loaded. {state.message}</StateMessage>;
  if (state.status === "validation-error") return <StateMessage heading="Site data blocked">The latest site data did not pass validation. {state.message}</StateMessage>;
  if (state.status === "compiler-error") return <StateMessage heading="Site build blocked">This site cannot be published until its configuration is fixed. {state.message}</StateMessage>;
  const route = matchSiteRoute(state.build.routes, pathname);
  if (!route) return <StateMessage heading="Page not found">This page is not present in the current Sitemap.</StateMessage>;
  return <DeliveryGuard><DeliveryChrome project={state.project} build={state.build} sitemap={state.sitemap} route={route} pack={providers.componentProvider.pack} report={onComponentError} /></DeliveryGuard>;
}
