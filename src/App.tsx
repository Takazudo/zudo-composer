import type { ComponentChildren } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import { createProductionProviderIntegration } from "./app/provider-integration";
import ComposerApp from "./features/composer/chrome/composer-app";
import { SitemapperRouteContent } from "./features/sitemapper";

function Shell({ children }: { children: ComponentChildren }) {
  return <div class="app-shell"><header class="app-header"><a class="app-brand" href="/">zudo-composer</a><nav aria-label="Main navigation"><a href="/composer">Composer</a><a href="/sitemapper">Sitemapper</a></nav></header>{children}</div>;
}

function Home() {
  return <main class="landing"><p class="eyebrow">Standalone authoring tools</p><h1>Build structures, not documents.</h1><p>Composer and Sitemapper now run independently from the documentation system.</p><a class="primary-link" href="/composer">Open Composer</a></main>;
}

function NotFound() {
  return <main class="route-placeholder"><h1>Not found</h1><p>This standalone route does not exist.</p><a href="/">Return home</a></main>;
}

export function App() {
  const providers = useMemo(createProductionProviderIntegration, []);
  const path = window.location.pathname;
  useEffect(() => {
    if (path === "/sitemapper") {
      void providers.compositionCatalog.listCompositions().catch(() => undefined);
    }
  }, [path, providers]);
  if (path === "/composer") return <Shell><ComposerApp componentProvider={providers.componentProvider} providers={providers.compositionProviders} /></Shell>;
  if (path === "/sitemapper") return <Shell><SitemapperRouteContent catalog={providers.compositionCatalog} /></Shell>;
  if (path === "/") return <Shell><Home /></Shell>;
  return <Shell><NotFound /></Shell>;
}
