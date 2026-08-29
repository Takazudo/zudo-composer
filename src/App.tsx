import type { ComponentChildren } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import { createProductionProviderIntegration } from "./app/provider-integration";
import ComposerApp from "./features/composer/chrome/composer-app";
import { ContentRouteContent } from "./features/content";
import { MappingRouteContent } from "./features/mapping";
import { SitemapperRouteContent } from "./features/sitemapper";

const products = [["Composer", "/composer"], ["Content", "/content"], ["Mapping", "/mapping"], ["Sitemapper", "/sitemapper"]] as const;

function Shell({ children, path }: { children: ComponentChildren; path: string }) {
  return <div class="app-shell"><header class="app-header"><a class="app-brand" href="/">zudo-composer</a><nav aria-label="Main navigation">{products.map(([label, href]) => <a key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</a>)}</nav></header>{children}</div>;
}
function Home() { return <main class="landing"><p class="eyebrow">Standalone authoring tools</p><h1>Build structures, not documents.</h1><p>Composer, Content, Mapping, and Sitemapper run independently from the documentation system.</p><a class="primary-link" href="/composer">Open Composer</a></main>; }
function NotFound() { return <main class="route-placeholder"><h1>Not found</h1><p>This standalone route does not exist.</p><a href="/">Return home</a></main>; }

export function App() {
  const providers = useMemo(createProductionProviderIntegration, []);
  const path = window.location.pathname;
  useEffect(() => { if (path === "/sitemapper") void providers.compositionCatalog.listCompositions().catch(() => undefined); }, [path, providers]);
  let content: ComponentChildren;
  if (path === "/composer") content = <ComposerApp componentProvider={providers.componentProvider} providers={providers.compositionProviders} />;
  else if (path === "/content") content = <ContentRouteContent provider={providers.contentProvider} />;
  else if (path === "/mapping") content = <MappingRouteContent provider={providers.mappingProvider} contentCatalog={providers.contentCatalog} compositionCatalog={providers.mappingCompositionCatalog} contentEntries={providers.mappingContentEntries} componentProvider={providers.componentProvider} />;
  else if (path === "/sitemapper") content = <SitemapperRouteContent catalog={providers.compositionCatalog} mappingCatalog={providers.sitemapperMappingCatalog} />;
  else if (path === "/") content = <Home />;
  else content = <NotFound />;
  return <Shell path={path}>{content}</Shell>;
}
