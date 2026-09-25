// Host-callables channel for the package-owned routes (#113 upstream;
// mirrors the create-zudo-sg@0.1.8 starter's pages/lib/_chrome-bindings.tsx).
//
// `settings.chromeBindingsModule` points the zudo-doc routes plugin at this
// module; it re-exports `chromeBindings` into
// `virtual:zudo-doc-chrome-bindings`, which the injected chrome shim spreads
// into `createChrome(routeCtx, { ...chromeBindings })`. Every slot we omit
// keeps its package default.
//
// We override only BodyEndIslands: the package default excludes the host
// token-panel bootstrap, but this host mounts the engine's preview zdtp
// panel (`toggle-preview-token-panel`). Without this binding, a body-end
// islands file imported only from pages/index.tsx would cover the host-owned
// `/` and leave the injected /components/* and /tokens routes on the
// package-default BodyEndIslands — i.e. the header trigger's panel would not
// mount on the pages that need it.

import type { ChromeHostBindings } from "@takazudo/zudo-doc/factory-context";
import { BodyEndIslands } from "./_body-end-islands";

export const chromeBindings: ChromeHostBindings = {
  BodyEndIslands,
};
