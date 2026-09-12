# Demo Webshop (`demo-webshop`)

A host project for zudo-composer, kept as a workspace member of this
repository. It owns its component pack (`components/`, reached through this
package's own `exports` self-reference), its Tailwind token namespace
(`shop-`, declared in `styles/base.css`), its authored site
(`site-project.ts`) and its Assets store (`cms/assets`). The shared workflow
and the reasoning behind it are in
[`docs/demo-sites/README.md`](../../docs/demo-sites/README.md).

Run these commands from this package directory:

```sh
corepack pnpm --filter demo-webshop dev --port 4181
```

The committed `initial` workspace opens populated without a seeding step or
an activated release. `site-project.ts` is the authored source of truth;
`site-project.json` and `cms/{compositions,content,mappings,sitemaps,workspaces}`
are generated material that happens to be tracked. Do not edit those generated
files by hand. `generate` produces the JSON; `zudo-composer generate --check`
reports stale committed JSON. The installed
`zudo-composer seed --ready-workspace` produces the CMS through the canonical
stores and workspace registry. See the [ready-workspace guide](../../docs/site-project.md#committed-ready-workspace)
for fresh-output regeneration and unchanged reruns.

For an explicit source update and local website release:

```sh
corepack pnpm generate   # site-project.ts -> site-project.json
corepack pnpm --filter demo-webshop seed       # images-src -> cms/assets, then an activated release
```

`seed` imports Assets and activates a local website release in the ignored
`.zudo-site-project/` directory; it is needed for `/site` delivery. The Assets
catalog and retained versions remain committed under `cms/assets`, with exact
checksum-named delivery copies under `public/uploaded-assets`. Ordinary Assets
edits under `pnpm dev` dirty the catalog by design.

The authored site is **Nightjar Supply** (`docs/demo-sites/webshop.md`): twelve
products on three shelves (Desk, Carry, Light), a catalog with filter / sort /
search, one page per product, a mock cart and checkout, About and FAQ. Image
ids in `site-project.ts` are the record ids of the committed Assets store.
`__tests__/site-compile.test.ts` compiles the committed JSON the way the static
build does and asserts every route, its h1, the materialised lists and the
pinned image URLs.

The site is delivered at `/site` on the dev server and at
`https://zc-demo-shop.zudolab.dev` from `corepack pnpm demo:build-site webshop`.
