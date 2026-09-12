# Demo Landing (`demo-landing`)

A host project for zudo-composer, kept as a workspace member of this
repository. It owns its component pack (`components/`, reached through this
package's own `exports` self-reference), its Tailwind token namespace
(`land-`, declared in `styles/base.css`), its authored site
(`site-project.ts`) and its Assets store (`cms/assets`). The shared workflow
and the reasoning behind it are in
[`docs/demo-sites/README.md`](../../docs/demo-sites/README.md).

```sh
corepack pnpm --filter demo-landing generate   # site-project.ts -> site-project.json
corepack pnpm --filter demo-landing seed       # images-src -> cms/assets, then an activated release
corepack pnpm --filter demo-landing dev -- --port 4182
```

`generate` is the only way `site-project.json` changes; the package test fails
while the committed JSON is stale. `seed` runs `zudo-composer release` from
this directory, so the release state lands in `.zudo-site-project/` and the
published CMS records in `cms/{compositions,content,mappings,sitemaps}/` — all
gitignored, all regenerable. Ordinary Assets edits under `pnpm dev` dirty
`cms/assets/catalog.json`; that is by design, as it is for the root dogfood
store.

The site is delivered at `/site` on the dev server and, once the static build
exists, at `https://demo-landing.zudolab.dev`.
