# Upstream integration notes

Append engine/CLI findings here with the observed behavior, expected behavior,
and current workaround. Issue 741 owns the later upstream issue filing pass.

## 1. `uiPackageName` names the story contract module

- Observed: `gen-registry` imports the `StoryModule` type from `uiPackageName`.
  A component pack that only exports components and Composer sidecars does not
  provide this type.
- Expected: the setting name or documentation distinguishes the component
  package from the module that exports the engine's story contract.
- Workaround: keep `uiPackageName: "@takazudo/zudo-sg/stories"`; story component
  imports still use `@zudo-composer/ui`.

## 2. `gen-registry` requires an existing marker file

- Observed: the generator reads an existing registry and replaces its marker
  block; it cannot create the file on a clean checkout when generated output
  is ignored.
- Expected: generation bootstraps a missing registry.
- Workaround: commit `sg-registry.seed.ts` and run
  `scripts/bootstrap-registry.mjs` before both generators. The bootstrap uses
  an exclusive copy, so an existing registry is preserved.

## 3. The initializer ignores its lockfile

- Observed: `create-zudo-sg@0.1.0` scaffolds `pnpm-lock.yaml` in `.gitignore`,
  which prevents a committed frozen-install baseline.
- Expected: a standalone host can commit its lockfile and reproduce its
  dependency graph.
- Workaround: remove that ignore entry and commit the host's own lockfile.

## 4. Git-installed contract needs a pnpm prepare allowance

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

- Observed with zfb 2.19.0: immediately after `ready on http://localhost:4397`,
  `/components/preview?slug=prose-md&variant=Defaults` returned 200 with a
  `ConfiguredPreviewApp` island marker but no `/assets/islands.js` script.
  Waiting for the island asset made the same page include the script. In a
  repeat run the asset became available about 5.7 seconds after process start.
- Expected: the ready signal means initial island pages can hydrate, or the
  initial page arranges to load the island bundle once it becomes available.
- Workaround: wait for `/assets/islands.js` to return 200 before browser checks
  and reload any page opened earlier. The subsequent HTTP smoke check passed
  for both detail pages, the preview, catalog, tokens, CSS, and island bundle.

## 7. Interrupting dev compilation leaves temporary files

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
