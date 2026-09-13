# Documentation Site (zudo-doc)

The `doc/` directory is the English developer documentation site for
`zudo-composer`, built with [zudo-doc](https://github.com/zudolab/zudo-doc)
5.22.1 on zfb. The Drift theme, layout, chrome, routes, and interactive islands
come from the package; this workspace owns the config and MDX content.

## Structure

- `zfb.config.ts` — the site configuration and its intentional overrides
- `src/content/docs/<category>/<page>.mdx` — English documentation pages; the
  filesystem defines the sidebar
- `src/styles/global.css` — the package CSS and Tailwind layer setup
- `pages/index.tsx` — the package home route re-export
- `pages/docs/[[...slug]].tsx` — the host-owned documentation route seam
- `public/` — static site assets
- `../.claude/skills/zudo-doc-writing/SKILL.md` — the writing and navigation
  rules to consult before editing pages

The header categories are `overview/`, `architecture/`, `setup/`, and
`development/`. Each category has an `index.mdx` landing page and its sibling
pages; add a page to the matching directory so the generated navigation stays
in sync.

## Development

Run these commands from the repository root:

```sh
pnpm doc:dev      # zfb dev server plus the document-history server
pnpm doc:build    # static production build to doc/dist/
pnpm doc:check    # zfb content and TypeScript checks
pnpm doc:build-site # production build plus doc-site-manifest.json and artifact verification
```

The package-local equivalents are `pnpm -C doc dev`, `pnpm -C doc build`, and
`pnpm -C doc check`. `doc:build-site` is a root-only artifact wrapper, not a
script in the `doc` package.
The root `check` chain runs `doc:check` and `doc:build-site` before the packed
host-install proof; those checks must stay behind the no-deploy audit.

## Build output shape

`pnpm doc:build` writes the root-mounted static site to `doc/dist/`:

- `doc/dist/index.html` and `doc/dist/404.html` are the root pages.
- `doc/dist/docs/<category>/index.html` contains each category landing page.
- `doc/dist/docs/<category>/<page>/index.html` contains each content page.
- `doc/dist/assets/` contains the generated CSS and JavaScript bundles.
- The favicon files and package-owned routes (such as the sitemap, robots file,
  and search index) are copied into the static output.

Because `base` is `/`, emitted links and asset URLs are root-relative. Build
output and zfb working directories are ignored; a build must not leave
untracked `doc/dist/`, `doc/.zfb/`, or `doc/.zfb-build/` files.

The documentation site is the `doc` target in the nine-target trusted-run
pipeline, served at [zudo-composer.zudolab.dev](https://zudo-composer.zudolab.dev/).
The target registry and Wrangler contracts are:

| Target key | Kind | Worker | Wrangler config | Domain | Artifact directory | Manifest | CI artifact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `doc` | `doc-site` | `zudo-composer` | `wrangler.doc.jsonc` | `zudo-composer.zudolab.dev` | `doc/dist` | `doc-site-manifest.json` | `doc-site-<sha>` |
| `sample` | `site-static` | `zc-demo-sample` | `wrangler.demo-sample.jsonc` | `zc-demo-sample.zudolab.dev` | `packages/demo-sample/dist-site` | `site-manifest.json` | `demo-site-sample-<sha>` |
| `shop` | `site-static` | `zc-demo-shop` | `wrangler.demo-shop.jsonc` | `zc-demo-shop.zudolab.dev` | `packages/demo-webshop/dist-site` | `site-manifest.json` | `demo-site-shop-<sha>` |
| `landing` | `site-static` | `zc-demo-landing` | `wrangler.demo-landing.jsonc` | `zc-demo-landing.zudolab.dev` | `packages/demo-landing/dist-site` | `site-manifest.json` | `demo-site-landing-<sha>` |
| `blog` | `site-static` | `zc-demo-blog` | `wrangler.demo-blog.jsonc` | `zc-demo-blog.zudolab.dev` | `packages/demo-blog/dist-site` | `site-manifest.json` | `demo-site-blog-<sha>` |
| `sample-editor` | `demo-editor` | `zc-demo-sample-editor` | `wrangler.demo-sample-editor.jsonc` | `zc-demo-sample-editor.zudolab.dev` | `packages/demo-sample/dist-editor` | `demo-editor-manifest.json` | `demo-editor-sample-<sha>` |
| `shop-editor` | `demo-editor` | `zc-demo-shop-editor` | `wrangler.demo-shop-editor.jsonc` | `zc-demo-shop-editor.zudolab.dev` | `packages/demo-webshop/dist-editor` | `demo-editor-manifest.json` | `demo-editor-shop-<sha>` |
| `landing-editor` | `demo-editor` | `zc-demo-landing-editor` | `wrangler.demo-landing-editor.jsonc` | `zc-demo-landing-editor.zudolab.dev` | `packages/demo-landing/dist-editor` | `demo-editor-manifest.json` | `demo-editor-landing-<sha>` |
| `blog-editor` | `demo-editor` | `zc-demo-blog-editor` | `wrangler.demo-blog-editor.jsonc` | `zc-demo-blog-editor.zudolab.dev` | `packages/demo-blog/dist-editor` | `demo-editor-manifest.json` | `demo-editor-blog-<sha>` |

The `doc-site-build` job uploads `doc-site-<sha>` from `doc/dist`; static
targets use `site-manifest.json` and editor targets use
`demo-editor-manifest.json`. Keep this table aligned with
`scripts/hosted-demo/targets.mjs` and the nine checked-in Wrangler files.

Before the first rollout, an owner must delete the retired Workers
`zudo-composer`, `zudo-composer-doc`, `zudo-composer-demo-shop`,
`zudo-composer-demo-landing` and `zudo-composer-demo-blog`; the replacement
targets then create the current Worker names and bindings. The new `doc` target
intentionally reuses the `zudo-composer` name after that clean break. If only one of
`deployments list` or `versions list` reports a new Worker as missing, treat it
as a partial first deploy: delete that target's Worker, confirm both listings
report it missing, and rerun the same target. Never bootstrap a partial state
with a plain deploy.

The deployment token needs Account › Workers Scripts › Edit and Account ›
Account Settings › Read, plus Zone › Workers Routes › Edit, Zone › DNS › Edit
and Zone › Zone › Read for `zudolab.dev`. For a manual rollback, use the
captured version ID and the replacement Worker's config; do not infer an older
version from a list:

```sh
corepack pnpm exec wrangler rollback <version-id> --name zudo-composer --config wrangler.doc.jsonc --yes
corepack pnpm exec wrangler rollback <version-id> --name zc-demo-sample --config wrangler.demo-sample.jsonc --yes
corepack pnpm exec wrangler rollback <version-id> --name zc-demo-sample-editor --config wrangler.demo-sample-editor.jsonc --yes
corepack pnpm exec wrangler rollback <version-id> --name zc-demo-shop --config wrangler.demo-shop.jsonc --yes
corepack pnpm exec wrangler rollback <version-id> --name zc-demo-shop-editor --config wrangler.demo-shop-editor.jsonc --yes
corepack pnpm exec wrangler rollback <version-id> --name zc-demo-landing --config wrangler.demo-landing.jsonc --yes
corepack pnpm exec wrangler rollback <version-id> --name zc-demo-landing-editor --config wrangler.demo-landing-editor.jsonc --yes
corepack pnpm exec wrangler rollback <version-id> --name zc-demo-blog --config wrangler.demo-blog.jsonc --yes
corepack pnpm exec wrangler rollback <version-id> --name zc-demo-blog-editor --config wrangler.demo-blog-editor.jsonc --yes
```

For a manual `workflow_dispatch`, provide the successful main CI `run_id`, the
full `sha`, and one registry `target` key when a targeted rollout is needed;
the guard still verifies the same-repository run and current `main` head.

## Content conventions

- Invoke `/zudo-doc-writing` before creating or editing any page.
- Every page has YAML frontmatter with `title` and `sidebar_position`; content
  pages also have a one-sentence `description`.
- Category `index.mdx` files contain only a short introduction and
  `<CategoryNav category="<category>" />`.
- The frontmatter title supplies the page's h1. Start body content at `##`; do
  not add a `#` heading.
- Link between pages with relative paths that include `.mdx`, for example
  `[Configuration](../setup/configuration.mdx)`.
- Heading IDs are hierarchical. When linking to a heading, use the ID from the
  built HTML rather than assuming a flat slug; stale anchors are build errors.
- Leave a blank line after every opening admonition fence (and before its
  closing `:::`):

  ```mdx
  :::note

  Body text.

  :::
  ```

The repository's `docs/` directory remains the operator-reference surface;
`doc/` is the zudo-doc developer site.
