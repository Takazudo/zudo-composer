# Sample Styleguide

A standalone `@takazudo/zudo-sg` host for the installed `@zudo-composer/ui`
component pack. This directory owns its workspace, lockfile, and dependencies;
it is deliberately outside the repository's root pnpm workspace.

## Commands

Use Node 24 and the package's pinned pnpm version. From the repository root:

```sh
corepack pnpm -C styleguide/sample install --frozen-lockfile
corepack pnpm -C styleguide/sample exec playwright install chromium
corepack pnpm -C styleguide/sample check
corepack pnpm -C styleguide/sample build
corepack pnpm -C styleguide/sample dev
corepack pnpm -C styleguide/sample verify:browser
```

Development uses port **4397** with base `/`. The build writes `dist/`, including
the home page, 404 page, `/components`, component detail and preview pages,
`/tokens`, and the overview document. Serve `dist/` with a static HTTP server to
inspect the production build.

On a cold dev start, wait for `GET /__zfb/ready` to report `ready: true` before
checking interactive previews, and confirm `X-Zfb-Dev-Ready: true` on the
document response. The CLI's listening message and an available island bundle
can both precede a ready document generation (see the upstream notes).

`check`, `build`, and `dev` each run `gen` first. Host generation validates the
actual authored exports, derives plain SG descriptors, per-variant source, and
a Preact-only loader map; the installed engine generates the token manifest.
All generated files are ignored and reproducible from the stories and pack CSS.

`build` and `dev` compile the separate Vite/Tailwind Preact pipeline before zfb.
The preview is a generated public HTML document; a public zfb dev middleware
serves those exact bytes to prevent automatic shell CSS/island injection. The
host detail route composes public SG/Doc APIs to retain the source panel alongside
descriptor-driven controls and previews.

The browser dependency belongs to this standalone host. Install Chromium before
building: thumbnail generation captures every actual Preact component after
markdown, images and fonts settle. CI should install this browser before its
styleguide build step. `PLAYWRIGHT_EXECUTABLE_PATH` explicitly selects an alternate
local executable; unset it to use the pinned Playwright browser.

`dev` watches stories, preview sources, CSS, host configuration and build scripts.
It stops its zfb child, serially regenerates the corpus, preview and thumbnails,
then restarts zfb. An edit during generation schedules another pass before
restart. Wait for `/__zfb/ready` after edits; this is a full preview rebuild, not
Vite HMR. A failed rebuild stays visible in the terminal and retries on the next
edit. `node tests/dev-preview.mjs` verifies a real story/metadata/CSS edit and
thumbnail change, restores its inputs, and verifies the restored generation.

`verify:browser` tests the prepared artifact, including delayed hydration and
preview loading, the first available control edit, all 71 variants, source/copy,
live CSS, sizing, themes, token-panel navigation, readiness and negative protocol
cases. It writes local evidence under `.sample-build/evidence` (override with
`SAMPLE_EVIDENCE_DIR`). Run builds and browser tests through the workspace's heavy
command guard when that policy applies.

Stories live under `stories/<group>/<component>/`. Import components from
`@zudo-composer/ui` and the sidecar's display metadata and defaults through its
`@zudo-composer/ui/src/*.composer.tsx` export. Export `Defaults` first, then one
named story for every enum value in the sidecar fields. Titles and descriptions
come from the sidecar; categories use the capitalised pack folder: `Shared`,
`Cards`, `Content`, or `Media`. Previews compile the installed Composer CSS and
scan both the stories and the installed pack's source for Tailwind classes.
The catalog document uses `src/styles/global.css` for public zudo-doc,
zudo-sg, and zdtp stylesheets. Its utilities come from Wind and automatic package
manifests; the Composer pack's Tailwind stylesheet belongs only to the preview.

## Updating the component pack

The `@zudo-composer/ui` and `@zudo-composer/component-contract` dependencies use
the exact root Git specs from the repository's `ui-handoff.json` and
`contract-handoff.json`. When either handoff changes, update the corresponding
dependency here to that file's `rootGitSpec`, run a local install to refresh
this directory's lockfile, then repeat a clean frozen install, check, build,
and browser checks of both build and dev. Do not use a branch name, workspace
link, copied source, or a local path as a substitute for the Git pin.

Dependency resolution must stay inside `styleguide/sample/node_modules`. Do
not add this host or any engine dependency to the root workspace or lockfile.
Any release-age exception belongs in this host's `pnpm-workspace.yaml` and must
name an exact version.

Integration friction and local workarounds are recorded in
[UPSTREAM-NOTES.md](./UPSTREAM-NOTES.md).

The hosted catalog is <https://zc-sg-sample.zudolab.dev> (`sample-sg`). From
the repository root, `corepack pnpm sg:build-site` builds and verifies
`styleguide/sample/dist`. Deployment and the other styleguide hosts are
documented in [`docs/hosted-demo.md`](../../docs/hosted-demo.md).
