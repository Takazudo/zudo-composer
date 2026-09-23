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
