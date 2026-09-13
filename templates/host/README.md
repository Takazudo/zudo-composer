# Your Composer site

This project owns its components, styles, authored SiteProject and CMS records.

After cloning, install its declared dependencies, then open the populated studio:

```sh
corepack pnpm install
corepack pnpm dev
```

Use `--frozen-lockfile` when the project has a committed lockfile. A preview
created against unpublished packages needs matching tool and component-contract
tarballs supplied by the maintainer during installation until those versions are
published. The creator deliberately leaves temporary resolution settings and
the preview lockfile out of this tree.

The studio starts with a page, global template, content model and entry, mapping,
sitemap, three components, and an imported image. Initial CMS records were
produced by `generate`, `assets import`, and `seed --ready-workspace` during
creation. Opening the editor needs no seed or release activation.

```sh
corepack pnpm check
corepack pnpm build:site
```

`components/pack.ts` is the single component registry. It uses this package's
`./components` export. Preact is a direct dependency; Tailwind comes from the
tool. `styles/base.css` scans your component sources.

`site-project.ts` is the authored build source. After editing it, run
`corepack pnpm generate` and commit the updated `site-project.json`.
`corepack pnpm assets:import` imports additions to `images-src/manifest.json`.
`corepack pnpm seed` explicitly activates a release from that aggregate when you
want one; it is separate from opening the ready editor. `build:site` compiles the
aggregate into `dist-site`.

Commit the complete `cms/` tree, including every current pointer and its
generation records, plus `public/uploaded-assets/`, the aggregate, source, image
manifest and image bytes. Editor changes live in CMS records. They do not rewrite
the authored DSL. Preserve those changes before replacing generated state.

The creator is create-only. Format changes and existing-project updates require
maintainer review; there is no upgrade or migration command.
