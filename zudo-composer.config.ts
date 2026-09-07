// This repository's own host config.
//
// zudo-composer is a package a host project installs, and the seam it swaps —
// the component pack and the base stylesheet — has to be exercised by
// something. Rather than a second fixture, the repo root IS that host: `pnpm
// dev`, `pnpm build` and the artifact gates resolve their pack and styles
// through this file exactly as an installed host does.
//
// `pack` names the installed provider through its public `composer-pack`
// export. Swapping in a themeset is one edit here plus one `@import` in
// `styles/base.css` — see `fixtures/themeset-host/`.
import { defineComposerConfig } from "./server/config/define.mjs";

export default defineComposerConfig({
  pack: "@zudo-sg/ui/composer-pack",
  styles: "styles/base.css",
});
