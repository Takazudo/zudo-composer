import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { createProductionProviderIntegration } from "./app/provider-integration";
import { Home } from "./app/home";
import { Shell } from "./app/shell";
import { createWorkspaceSummary } from "./app/workspace-summary";
import ComposerApp from "./features/composer/chrome/composer-app";
import { ContentRouteContent } from "./features/content";
import { MappingRouteContent } from "./features/mapping";
import { MediaRouteContent } from "./features/media";
import { SitemapperRouteContent } from "./features/sitemapper";
import { SiteDelivery } from "./features/delivery/site-delivery";
import { isSitePath } from "./features/delivery/routing";
import { bootstrapTheme, createThemeController, type ThemeController } from "./theme/theme";

function NotFound() { return <main class="route-placeholder"><h1>Not found</h1><p>This standalone route does not exist.</p><a href="/">Return home</a></main>; }

export interface AppProps {
  /** Main bootstrapping supplies the already-observing controller. */
  themeController?: ThemeController;
}

export function App({ themeController }: AppProps = {}) {
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

  const providers = useMemo(createProductionProviderIntegration, []);
  // One read model for the whole chrome; the rail's counts come from it, and
  // the Dashboard route reuses this instance rather than initializing a second.
  const workspaceSummary = useMemo(() => createWorkspaceSummary(providers), [providers]);
  const path = window.location.pathname;
  useEffect(() => { if (path === "/sitemapper") void providers.compositionCatalog.listCompositions().catch(() => undefined); }, [path, providers]);
  if (isSitePath(path)) return <SiteDelivery providers={providers} pathname={path} />;
  let content: ComponentChildren;
  if (path === "/composer") content = <ComposerApp componentProvider={providers.componentProvider} providers={providers.compositionProviders} />;
  else if (path === "/content") content = <ContentRouteContent provider={providers.contentProvider} componentProvider={providers.componentProvider} createPreviewSource={providers.createContentPreviewSource} />;
  else if (path === "/mapping") content = <MappingRouteContent provider={providers.mappingProvider} contentCatalog={providers.contentCatalog} compositionCatalog={providers.mappingCompositionCatalog} contentEntries={providers.mappingContentEntries} componentProvider={providers.componentProvider} />;
  else if (path === "/sitemapper") content = <SitemapperRouteContent provider={providers.sitemapProvider} catalog={providers.compositionCatalog} mappingCatalog={providers.sitemapperMappingCatalog} />;
  else if (path === "/media") content = <MediaRouteContent provider={providers.mediaProvider} />;
  else if (path === "/") content = <Home />;
  else content = <NotFound />;
  return <Shell path={path} themeController={activeThemeController} themeSnapshot={themeSnapshot} summary={workspaceSummary}>{content}</Shell>;
}
