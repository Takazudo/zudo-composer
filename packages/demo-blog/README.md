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
corepack pnpm dev --port 4183
```

The eight essays are Markdown files in `content/articles/<slug>.md`, read by
`site-project.ts`; images are referenced by file name and resolved to their
`/uploaded-assets/asset-<id>` URLs from the committed `cms/assets` catalog, so
seed the assets before generating on a fresh store.

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
corepack pnpm seed       # images-src -> cms/assets, then an activated release
```

`seed` imports Assets and activates a local website release in the ignored
`.zudo-site-project/` directory; it is needed for `/site` delivery. The Assets
catalog and retained versions remain committed under `cms/assets`, with exact
checksum-named delivery copies under `public/uploaded-assets`. Ordinary Assets
edits under `pnpm dev` dirty the catalog by design.

The site is delivered at `/site` on the dev server and, once the static build
exists, at `https://zc-demo-blog.zudolab.dev`.
