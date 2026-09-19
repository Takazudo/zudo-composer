# Upstream integration notes

Engine/CLI findings, their triage status, and the local integration choices.
Issue 741 completed this triage on 2026-09-20 against the published
`@takazudo/zudo-sg@0.2.0` and `create-zudo-sg@0.1.0`, with zfb CLI/runtime/host
markdown WASM `2.19.0`, `@takazudo/zudo-doc@5.26.0`, Node `24.13.1`, and pnpm
`11.5.2`. Every filed report includes a minimal reproduction and workaround.
The UI pack retains its separate markdown WASM dependency at `2.10.1`.

## 1. `uiPackageName` conflates the component package and story contract

- Status: **filed** — [zudo-sg #747](https://github.com/Takazudo/zudo-sg/issues/747).
- Observed: `gen-registry` imports the `StoryModule` type from `uiPackageName`.
  A component pack that only exports components and Composer sidecars does not
  provide this type. The same setting generates component usage snippets in
  `new-component`, so assigning the story-contract module fixes the registry
  but makes those generated component imports incorrect.
- Expected: generated story types and component usage imports have separate
  module identities. The published CLI type currently documents only the
  component-usage meaning.
- Workaround: keep `uiPackageName: "@takazudo/zudo-sg/stories"`; story component
  imports still use `@zudo-composer/ui`.

## 2. `gen-registry` requires an existing marker file

- Status: **filed** — [zudo-sg #748](https://github.com/Takazudo/zudo-sg/issues/748).
- Observed: the generator reads an existing registry and replaces its marker
  block; it cannot create the file on a clean checkout when generated output
  is ignored.
- Expected: generation bootstraps a missing registry.
- Workaround: commit `sg-registry.seed.ts` and run
  `scripts/bootstrap-registry.mjs` before both generators. The bootstrap uses
  an exclusive copy, so an existing registry is preserved.

## 3. The initializer ignores its lockfile

- Status: **filed** — [zudo-sg #749](https://github.com/Takazudo/zudo-sg/issues/749).
- Observed: `create-zudo-sg@0.1.0` scaffolds `pnpm-lock.yaml` in `.gitignore`,
  which prevents a committed frozen-install baseline.
- Expected: a standalone host can commit its lockfile and reproduce its
  dependency graph.
- Workaround: remove that ignore entry and commit the host's own lockfile.

## 4. Git-installed contract needs a pnpm prepare allowance

- Status: **local-misuse** — a consumer-specific pnpm lifecycle policy, not an
  engine or initializer defect. The generic starter cannot pre-approve the
  prepare script of a component contract that it does not install.
- Observed: the first install stops with
  `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` for
  `@zudo-composer/component-contract@1.0.0`. Its pinned Git package uses
  `prepare` to build the exported `dist/` files.
- Expected: a Git-package consumer setup documents this required pnpm 11
  lifecycle allowance.
- Workaround: allow `@zudo-composer/component-contract` in this host's
  `allowBuilds`, alongside the initializer's `esbuild` allowance. The exact
  package commit remains pinned; no root workspace settings change.

## 5. Fresh engine releases need exact release-age exceptions

- Status: **filed** — [zudo-sg #750](https://github.com/Takazudo/zudo-sg/issues/750)
  as a starter-policy improvement. The published initializer's unversioned
  exceptions were verified; whether a fresh install needs an exception also
  depends on package age and the consumer's pnpm policy.
- Observed: pnpm 11.5.2's install records release-age exceptions for the
  freshly published engine family: `@takazudo/zudo-sg@0.2.0`,
  `@takazudo/zudo-doc@5.26.0`, and the zfb 2.19.0 CLI, runtime, markdown WASM,
  and five platform binaries. The initializer starts with broader unversioned
  exceptions for several of these packages.
- Expected: a pinned starter installs reproducibly with narrowly scoped
  release-age allowances.
- Workaround: replace the initializer's broad allowances with the exact
  versions recorded in this host's `pnpm-workspace.yaml`. No exception is
  added to the repository root.

## 6. Dev readiness precedes the island bundle

- Status: **local-misuse** — the CLI's listening message was treated as a
  hydration readiness signal. zfb already exposes `GET /__zfb/ready` and
  document-specific `X-Zfb-Dev-Ready` / `X-Zfb-Dev-Generation` headers; see
  [the implemented readiness contract](https://github.com/Takazudo/zudo-front-builder/issues/2556).
- Observed with zfb 2.19.0: immediately after `ready on http://localhost:4397`,
  `/components/preview?slug=prose-md&variant=Defaults` returned 200 with a
  `ConfiguredPreviewApp` island marker but no `/assets/islands.js` script.
  Waiting for the island asset made the same page include the script. In a
  repeat run the asset became available about 5.7 seconds after process start.
- Expected: acceptance checks wait for the hydration signal rather than the
  CLI's listening message.
- Resolution: wait for `/__zfb/ready` to report `ready: true`, then verify that
  the document response has `X-Zfb-Dev-Ready: true`. An HTTP probe of this
  integration observed CLI readiness at 2.60 seconds, an unready preview and
  missing bundle at 2.68 seconds, a servable bundle but still-unready document
  at 4.31 seconds, and a ready generation with the preview script at 4.53
  seconds. A bundle-only probe is therefore weaker than the existing API.
  The probe stopped its dev process after verification. No new engine issue
  is warranted for this readiness distinction.

## 7. Interrupting dev compilation leaves temporary files

- Status: **filed** — [zudo-sg #751](https://github.com/Takazudo/zudo-sg/issues/751).
  The report targets missing starter ignore rules; it does not assert that
  compiler cleanup can run after every form of process termination.
- Observed: stopping dev while its island compilation was still in progress
  left `.zfb-esbuild-entry-*.tsx`, `.zfb-islands-tsconfig-*.json`, and
  `.zfb-virtual-*.mjs` files at the host root. The initializer ignores
  `.zfb-build/` but not these temporary files.
- Expected: interruption cleans up temporary compiler files, or the starter
  ignores all compiler-owned output.
- Workaround: add these three specific temporary-file patterns to the host's
  `.gitignore`. They are never committed as host source.

A subsequent graceful dev shutdown also wrote `.zfb/graph.bin`. That dev graph
cache has the same initializer ignore gap, so the host also ignores `.zfb/`.

## 8. Host stories apart from a Git-installed source-only component package

- Status: **local-misuse** — the planning candidate is supported by the
  existing API; no upstream gap was reproduced.
- Resolution: `componentsRoots` scans this host's `stories/`, while its
  `importBase` is relative to the generated registry. Stories import the pack
  and sidecars through their installed package exports. The preview entry
  scans both host stories and the installed pack source for Tailwind classes.
  Frozen install, typecheck, and build pass with all 12 components and 102
  token entries, using the exact Git package pins and no package source edits.
  The separate `uiPackageName` defect is covered by entry 1.

## 9. Generated token-manifest comments name the engine's demo package

- Status: **filed** — [zudo-sg #752](https://github.com/Takazudo/zudo-sg/issues/752).
- Observed: the generated token values come from this host's configured pack
  CSS, but the header and section comments still identify `@zudo-sg/demo-ui`
  and `packages/demo-ui/styles/*` as their source. They also assume the
  engine repository's `gen:token-manifest` / `check:token-manifest` scripts.
  These strings are hard-coded in the published manifest renderer.
- Expected: generated provenance names the configured inputs, or uses neutral
  host-independent wording and the public CLI commands.
- Workaround: treat `zudo-sg.config.mjs` as authoritative and keep generated
  output ignored. The host README documents its actual inputs and commands.
  No generated comments or installed package files are patched.

## 10. The initializer omits the catalog's global stylesheet

- Status: **filed** — [zudo-sg #753](https://github.com/Takazudo/zudo-sg/issues/753).
- Observed: the initialized host typechecks and builds without a consumer
  global stylesheet, but its catalog shell lacks the zudo-doc and zudo-sg
  package CSS and generated utility safelists. Responsive classes such as
  `lg:hidden` are absent, leaving the mobile navigation unusable.
- Expected: the initializer scaffolds and wires the required public stylesheet
  imports, or explicitly requires the consumer to provide them.
- Workaround: `src/styles/global.css` assembles the public Composer, zudo-doc,
  zudo-sg, and zdtp styles in cascade order. Production and dev browser checks
  now pass at 1280px and 390px, including mobile drawer interaction.

Duplicate searches covered all zudo-sg issues using the relevant config,
registry, initializer, lockfile, release-age, dev-output, and token-manifest
terms. The original CLI/template implementation issues (#655 and #736) do not cover
these newly reported gaps. No duplicate report was found, and no distinct
optional zudo-composer enhancement was required by the integration.
