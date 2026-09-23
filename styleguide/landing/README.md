# Landing styleguide

Standalone `zudo-sg` catalog for `packages/demo-landing`. From a clean
checkout, run at the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm -C styleguide/landing install --frozen-lockfile
corepack pnpm -C styleguide/landing check
corepack pnpm -C styleguide/landing build
corepack pnpm -C styleguide/landing dev
```

The dev port is **4399**. This host is excluded from the root pnpm workspace
and has its own lockfile. `gen` bundles the real Landing component pack from
TypeScript source into ignored `src/generated/`, leaving `preact`, `preact/*`,
and `@zudo-composer/component-contract` external for deterministic standalone
resolution. It also copies the demo's uploaded images to ignored
`public/uploaded-assets/` at their original URLs. No prebuilt demo artifacts
or existing `node_modules` are needed.

`check` enforces one discoverable story per pack ID, validates referenced
images and copied public paths, then typechecks. The host has `/` home,
`/components` catalog, `/tokens` Landing tokens, and `/docs/getting-started`
notes. Engine chrome supplies search, theme, sidebar, and responsive
navigation. Preview iframes load the real Landing stylesheet without catalog
chrome; their light canvas and text colors use Landing's semantic tokens.

The hosted catalog is <https://zc-sg-landing.zudolab.dev> (`landing-sg`). From
the repository root, `corepack pnpm sg:build-styleguide landing-sg` builds and
verifies `styleguide/landing/dist`; the command performs this host's frozen
install. This host pins `@zudo-composer/component-contract` to the exact root
handoff and does not install Sample's `@zudo-composer/ui` package.
