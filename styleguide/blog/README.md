# Blog styleguide

Standalone `zudo-sg` catalog for `packages/demo-blog`. From a clean checkout, run at the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm -C styleguide/blog install --frozen-lockfile
corepack pnpm -C styleguide/blog check
corepack pnpm -C styleguide/blog build
corepack pnpm -C styleguide/blog dev
```

The dev port is **4400**. This host is excluded from the root pnpm workspace and has its own lockfile. `gen` bundles the real Blog component pack from TypeScript source into ignored `src/generated/`, leaving `preact`, `preact/*`, and `@zudo-composer/component-contract` external for deterministic standalone resolution. It also copies the demo's uploaded images to ignored `public/uploaded-assets/` at their original URLs and reads article, author, and comment fixture content from the committed CMS records. No prebuilt demo artifacts or existing `node_modules` are needed.

`check` enforces one discoverable story per pack ID, verifies real route-filtered content and public assets, then typechecks. The host has `/` home, `/components` catalog, `/tokens` Blog tokens, and `/docs/getting-started` notes. Engine chrome supplies search, theme, sidebar, and responsive navigation. Preview iframes load the real Blog stylesheet and use Blog semantic colors for their canvas. Route-aware stories change only their own iframe history, preserving zudo-sg's preview query parameters; tag chips cannot change the parent catalog URL.

The hosted catalog is <https://zc-sg-blog.zudolab.dev> (`blog-sg`). From the
repository root, `corepack pnpm sg:build-styleguide blog-sg` builds and verifies
`styleguide/blog/dist`; the command performs this host's frozen install. This
host pins `@zudo-composer/component-contract` to the exact root handoff and does
not install Sample's `@zudo-composer/ui` package.


## Published descriptor shell and isolated previews

The catalog uses published zudo-sg 0.5 / zudo-doc 7 on zfb 4.5.3, with
zudo-react and Wind for its shell. The actual product pack and story callbacks
remain Preact. `src/config/preview.mjs` validates the retained same-origin
`/components/preview` endpoint. The frame loads only its separately compiled
Tailwind pack stylesheet and runtime, with no shell islands or CSS injection.

`gen` prepares the actual pack/assets, then derives descriptor metadata,
`Story.source ?? meta.usage` code snippets and preview loader identities from
one typed story corpus. The current inventory is 24 components and 73
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

Blog preserves the `ExcludeCurrentArticle` variant, generated CMS content, iframe-only route fixtures, query identities and history cleanup. The static preview retains `html[data-sg-preview-doc]` for the actual Blog canvas rules.
