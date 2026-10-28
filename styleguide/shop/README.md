# Shop styleguide

Standalone `zudo-sg` catalog for `packages/demo-webshop`. Run from a clean
checkout, at the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm -C styleguide/shop install --frozen-lockfile
corepack pnpm -C styleguide/shop check
corepack pnpm -C styleguide/shop build
corepack pnpm -C styleguide/shop dev
```

The dev port is **4398**. The standalone host is excluded from the root pnpm
workspace and has its own lockfile. `gen` bundles the real Shop component pack
from TypeScript source into ignored `src/generated/`. The bundle leaves
`preact`, `preact/*` and `@zudo-composer/component-contract` external so those
runtime imports resolve from this host's pinned dependencies. The host's real
uploaded images are copied into ignored `public/uploaded-assets/` at the same
URLs as the demo site. Neither `dist`, `node_modules`, nor a prebuilt pack is
required to begin. The root install builds component-contract's source package
for other repository consumers, while this adapter uses this host's published
contract pin.

The `check` command verifies each pack ID has a discoverable story and each
copied image URL exists, then runs TypeScript. `build` generates static pages
in ignored `dist/`. The adapter is under `scripts/prepare-source.mjs`; the
shared token generator is `../shared/generate-demo-token-manifest.mjs`.

Routes: `/` home, `/components` catalog, `/tokens` Shop tokens, and
`/docs/getting-started` host notes. Engine chrome supplies search, theme,
sidebar and responsive navigation. Component previews load the Shop base CSS;
the rest of the site uses zudo-doc styles.

The hosted catalog is <https://zc-sg-shop.zudolab.dev> (`shop-sg`). From the
repository root, `corepack pnpm sg:build-styleguide shop-sg` builds and verifies
`styleguide/shop/dist`; the command performs this host's frozen install. This
host pins `@zudo-composer/component-contract` to the exact root handoff and does
not install Sample's `@zudo-composer/ui` package.


## Published descriptor shell and isolated previews

The catalog uses published zudo-sg 0.8 / zudo-doc 9.1 (Classic theme pack) on zfb 5.1.5, with
zudo-react and Wind for its shell. The actual product pack and story callbacks
remain Preact. `src/config/preview.mjs` validates the retained same-origin
`/components/preview` endpoint. The frame loads only its separately compiled
Tailwind pack stylesheet and runtime, with no shell islands or CSS injection.

`gen` prepares the actual pack/assets, then derives descriptor metadata,
`Story.source ?? meta.usage` code snippets and preview loader identities from
one typed story corpus. The current inventory is 35 components and 105
variants; names, title-derived slugs and export order are checked. Render
functions, VNodes and runtime stores never cross the descriptor/Island JSON
boundary. The host detail route uses public StyleguideLayout, CodePanel,
DetailWorkbench and zudo-doc chrome/route-context factories.

`preview:build` builds the browser graph and static document, then captures an
800×480 PNG of every component's real `WithContent` story inside an iframe
after image/font/layout settling. No placeholder imagery is substituted.
`build` runs this before zfb, then `verify:artifact` checks the route/variant,
source/workbench, image, token and CSS boundaries. Browser generation makes
`build` a serial heavy lane: install Playwright Chromium first, or explicitly
set `PLAYWRIGHT_EXECUTABLE_PATH` for an approved local executable.

`check` checks source inventory and both shell and Preact TypeScript graphs.
`verify:browser` consumes prepared `dist` and covers copy/live CSS/height,
resizing, resolved theme, protocol validation/readiness, actual token CSS
edits, repeated SPA navigation, all variants and cleanup. There are no authored
control rows in these demo stories; the host does not manufacture controls to
inflate coverage. Tabs-only Apply remains disabled, and reset remains the
public props-reset contract.

`dev` watches stories, preview/config/CSS and the real pack's components,
styles, assets and CMS data. It serially stops zfb, regenerates the corpus and
preview assets/thumbnails, then restarts with the public middleware serving
the isolated preview document. Generated files remain ignored and must be
reproducible from tracked source; the four catalogs remain independent
install scopes with no Sample UI dependency.

The Cart page story keeps its existing title-derived `/components/cart-lines` slug.
