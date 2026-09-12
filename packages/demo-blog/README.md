# Demo Blog (`demo-blog`)

A host project for zudo-composer, kept as a workspace member of this
repository. It owns its component pack (`components/`, reached through this
package's own `exports` self-reference), its Tailwind token namespace
(`blog-`, declared in `styles/base.css`), its authored site
(`site-project.ts`) and its Assets store (`cms/assets`). The shared workflow
and the reasoning behind it are in
[`docs/demo-sites/README.md`](../../docs/demo-sites/README.md).

Run these commands from this package directory:

```sh
corepack pnpm generate                      # site-project.ts -> site-project.json
corepack pnpm --filter demo-blog seed       # images-src -> cms/assets, then an activated release
corepack pnpm --filter demo-blog dev --port 4183
```

The eight essays are Markdown files in `content/articles/<slug>.md`, read by
`site-project.ts`; images are referenced by file name and resolved to their
`/uploaded-assets/asset-<id>` URLs from the committed `cms/assets` catalog, so
seed the assets before generating on a fresh store.

`generate` is the only way `site-project.json` changes; `zudo-composer generate --check`
reports when the committed JSON is stale. `seed` runs `zudo-composer release` from
this directory, so the release state lands in `.zudo-site-project/` and the
published CMS records in `cms/{compositions,content,mappings,sitemaps}/` — all
gitignored, all regenerable. Ordinary Assets edits under `pnpm dev` dirty
`cms/assets/catalog.json`; that is by design, as it is for the root dogfood
store.

The site is delivered at `/site` on the dev server and, once the static build
exists, at `https://zc-demo-blog.zudolab.dev`.
