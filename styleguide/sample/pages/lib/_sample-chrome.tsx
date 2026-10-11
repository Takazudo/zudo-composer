import { routeContext } from "virtual:zudo-doc-route-context";
import {
  createRouteContext,
  type RouteContextPayload,
} from "@takazudo/zudo-doc/route-context";
import { createChrome } from "@takazudo/zudo-doc/chrome";
import {
  buildNavNodes,
  createCatalog,
  catalogEntriesFromDescriptors,
} from "@takazudo/zudo-sg/registry";
import { storyDescriptors } from "../../src/styleguide/descriptors";
import { chromeBindings } from "./_chrome-bindings";
const context = createRouteContext(
  routeContext as unknown as RouteContextPayload,
);
export const catalog = createCatalog(
  catalogEntriesFromDescriptors(storyDescriptors),
  { categoryOrder: ["Shared", "Cards", "Content", "Media"] },
);
const navNodes = buildNavNodes(catalog, { withBase: context.withBase });
const chrome = createChrome(context, chromeBindings);
export function sampleChrome(title: string, slug: string) {
  const {
    HeadWithDefaults,
    HeaderWithDefaults,
    FooterWithDefaults,
    BodyEndIslands,
  } = chrome;
  const lang = context.defaultLocale;
  return {
    title: chrome.composeMetaTitle(title),
    lang,
    navNodes,
    sidebarToggle: Boolean(context.settings.sidebarToggle),
    enableClientRouter: Boolean(context.settings.dynamicPageTransition),
    noindex: Boolean(context.settings.noindex),
    head: <HeadWithDefaults title={title} />,
    header: (
      <HeaderWithDefaults
        lang={lang}
        currentPath={context.withBase(`/components/${slug}`)}
        sidebarNodes={navNodes}
        currentSlug={slug}
      />
    ),
    footer: <FooterWithDefaults lang={lang} />,
    bodyEnd: (
      <>
        <BodyEndIslands basePath="/" />
        <div hidden data-sg-engine-route />
      </>
    ),
  };
}
