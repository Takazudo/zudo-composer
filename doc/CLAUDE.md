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

The deployment target is the fifth trusted-run target in the hosted pipeline,
served at [zc-doc.zudolab.dev](https://zc-doc.zudolab.dev/). The pipeline's
`doc-site-build` job uploads `doc-site-<sha>` from `doc/dist`; the trusted
target uses `zudo-composer-doc` and `wrangler.doc.jsonc`.

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
