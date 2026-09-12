# Demo Webshop (`demo-webshop`)

A host project for zudo-composer, kept as a workspace member of this
repository. It owns its component pack (`components/`, reached through this
package's own `exports` self-reference), its Tailwind token namespace
(`shop-`, declared in `styles/base.css`), its authored site
(`site-project.ts`) and its Assets store (`cms/assets`). The shared workflow
and the reasoning behind it are in
[`docs/demo-sites/README.md`](../../docs/demo-sites/README.md).

```sh
corepack pnpm --filter demo-webshop generate   # site-project.ts -> site-project.json
corepack pnpm --filter demo-webshop seed       # images-src -> cms/assets, then an activated release
corepack pnpm --filter demo-webshop dev -- --port 4181
```

`generate` is the only way `site-project.json` changes; the package test fails
while the committed JSON is stale. `seed` runs `zudo-composer release` from
this directory, so the release state lands in `.zudo-site-project/` and the
published CMS records in `cms/{compositions,content,mappings,sitemaps}/` — all
gitignored, all regenerable. Ordinary Assets edits under `pnpm dev` dirty
`cms/assets/catalog.json`; that is by design, as it is for the root dogfood
store.

The authored site is **Nightjar Supply** (`docs/demo-sites/webshop.md`): twelve
products on three shelves (Desk, Carry, Light), a catalog with filter / sort /
search, one page per product, a mock cart and checkout, About and FAQ. Image
ids in `site-project.ts` are the record ids of the committed Assets store.
`__tests__/site-compile.test.ts` compiles the committed JSON the way the static
build does and asserts every route, its h1, the materialised lists and the
pinned image URLs.

The site is delivered at `/site` on the dev server and at
`https://demo-shop.zudolab.dev` from `corepack pnpm demo:build-site webshop`.
