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
