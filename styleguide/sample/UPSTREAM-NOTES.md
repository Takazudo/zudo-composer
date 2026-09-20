# Upstream integration notes

This host was rechecked on 2026-09-20 with `@takazudo/zudo-sg@0.2.2`,
`create-zudo-sg@0.1.2`, `@takazudo/zfb@2.20.0`,
`@takazudo/zudo-doc@5.26.2`, Node `24.13.1`, and pnpm `11.5.2`.
The installed UI pack still keeps its separate `@takazudo/zfb-md-wasm`
dependency at `2.10.1`; the standalone host uses the 2.20.0 markdown WASM.

Each upstream report below was verified against the published package before
the corresponding local workaround was removed. The generated registry and
token manifest remain ignored build outputs.

## 1. `uiPackageName` conflates the component package and story contract

- Status: **resolved-upstream** — [zudo-sg #747](https://github.com/Takazudo/zudo-sg/issues/747).
- The 0.2.1 generated registry imports `StoryModule` from
  `@takazudo/zudo-sg/stories`, independently of the configured component
  package. The host now sets `uiPackageName: "@zudo-composer/ui"`.
- Verification: generated `sg-registry.ts` contains the engine story-contract
  import; an isolated `new-component` scaffold with this config emits usage
  imports from `@zudo-composer/ui`; the production catalog labels the 12
  components as coming from `@zudo-composer/ui`.
- The old story-contract setting and its workaround comment were removed.

## 2. `gen-registry` requires an existing marker file

- Status: **resolved-upstream** — [zudo-sg #748](https://github.com/Takazudo/zudo-sg/issues/748).
- The 0.2.1 CLI creates a missing or whitespace-only registry output and its
  parent directories, while still protecting non-empty hand-authored files.
- Verification: after deleting both ignored generated outputs from a clean
  checkout, `corepack pnpm -C styleguide/sample check` succeeds and recreates
  the registry and token manifest. A separate temporary-host probe also
  created nested output from both a missing path and a whitespace-only file.
  The host `gen` script now invokes the two engine generators directly.
- The marker seed and bootstrap helper were removed.

## 3. The initializer ignores its lockfile

- Status: **resolved-upstream** — [zudo-sg #749](https://github.com/Takazudo/zudo-sg/issues/749).
- The `create-zudo-sg@0.1.1` template tracks its generated lockfile; its
  package-safe ignore template contains no lockfile entry. The host likewise
  keeps `pnpm-lock.yaml` committed and outside `.gitignore`.
- Verification: `npm pack create-zudo-sg@0.1.1` followed by inspection of
  `templates/default/_gitignore` and a frozen install of this host confirmed
  the lockfile is tracked and reproducible.

## 4. Git-installed contract needs a pnpm prepare allowance

- Status: **local-misuse** — this is a consumer-specific pnpm lifecycle policy,
  not an engine or initializer defect.
- The Git-installed `@zudo-composer/component-contract` package builds its
  exported `dist/` files from `prepare`. This host therefore retains its exact
  package in `allowBuilds`, alongside the initializer's `esbuild` allowance.

## 5. Fresh engine releases need exact release-age exceptions

- Status: **resolved-upstream** — [zudo-sg #750](https://github.com/Takazudo/zudo-sg/issues/750).
- The 0.1.2 starter emits exact release-age exemptions for zdtp, zfb and
  its platform packages, zudo-doc, and zudo-sg. The host's
  `pnpm-workspace.yaml` retains the same exact 2.20.0 / 5.26.2 / 0.2.2
  entries as an explicit consumer policy; no bare package names are used.
- Verification: the unpacked template and the host workspace policy match,
  and the frozen install succeeds under pnpm 11.5.2.

## 6. Dev readiness precedes the island bundle

- Status: **local-misuse** — the CLI listening message was treated as a
  hydration signal. zfb already exposes `GET /__zfb/ready` and the document
  `X-Zfb-Dev-Ready` header; no engine change is required.
- Host documentation retains the readiness probe and header check for browser
  confirmation. This is an acceptance procedure, not a source workaround.

## 7. Interrupting dev compilation leaves temporary files

- Status: **resolved-upstream** — [zudo-sg #751](https://github.com/Takazudo/zudo-sg/issues/751).
- The 0.1.1 starter ignores `.zfb/`, `.zfb-build/`, and the three compiler
  temporary-file patterns. This host's `.gitignore` has the same canonical
  entries (plus its generated styleguide outputs and `.zudo-doc/`).
- Verification: the unpacked `_gitignore` was diffed against the host; every
  compiler-owned cache and temporary pattern is covered, so no host-only
  workaround remains.

## 8. Host stories apart from a Git-installed source-only component package

- Status: **local-misuse** — the existing API supports this host's layout.
- `componentsRoots` scans this host's `stories/`, `importBase` resolves from the
  generated registry, and stories import the Git-pinned pack and sidecars
  through public exports. The preview entry scans both story and pack source.
  Frozen install, check, and build retain 12 components and 102 token entries.

## 9. Generated token-manifest comments name the engine's demo package

- Status: **resolved-upstream** — [zudo-sg #752](https://github.com/Takazudo/zudo-sg/issues/752).
- The 0.2.1 renderer preserves each configured CSS import specifier. The
  generated manifest now names this host's two inputs:
  `@zudo-composer/ui/styles/tokens.css` and
  `@zudo-composer/ui/styles/colors.css` (resolved through `node_modules/`).
- Verification: generated output contains those two configured paths and no
  `@zudo-sg/demo-ui`, `packages/demo-ui`, or engine-repository script names.
  No generated package file is patched.

## 10. The initializer omits the catalog's global stylesheet

- Status: **resolved-upstream** — [zudo-sg #753](https://github.com/Takazudo/zudo-sg/issues/753).
- The 0.1.1 starter now supplies the complete global-entry import order,
  dashboard/catalog chrome, safelists, and source globs. This host keeps its
  consumer-specific `@zudo-composer/ui/styles/composer.css` import and
  Composer-first token/cascade behavior, while retaining the canonical docs
  content source glob and all zudo-doc, zdtp, and zudo-sg imports.
- Verification: the unpacked starter stylesheet was compared with the host;
  root `styleguide-host-styles.test.ts` and the host build gates remain green.
  The Composer import is intentionally not replaced by the starter's local
  token file because this host consumes the Git-installed UI pack.

## 11. Layered `hidden` loses to an unlayered consumer SVG reset

- Status: **filed; local workaround retained** —
  [zudo-doc #4355](https://github.com/zudolab/zudo-doc/issues/4355).
- The package-owned mobile sidebar toggle uses the layered Tailwind `hidden`
  utility for its inactive SVG, while the installed UI pack's unlayered media
  reset sets SVGs to `display: block`. The reset wins by cascade-layer order,
  so both icons rendered and stacked at mobile widths.
- Workaround: the host global stylesheet carries one unlayered selector scoped
  to the zudo-doc `SidebarToggle` island. It restores `display: none` only for
  the inactive package-owned icon and links the upstream report.
- Verification: at 390px exactly one icon renders, the toggle is 24px tall,
  and the drawer opens and closes without console errors.

## 12. The initializer omits favicons requested by the catalog head

- Status: **filed; local workaround retained** —
  [zudo-sg #789](https://github.com/Takazudo/zudo-sg/issues/789).
- The 0.1.1 template has no favicon assets, but the zudo-doc-backed head
  requests `favicon.ico`, `favicon.svg`, `favicon-32x32.png`, and
  `favicon-16x16.png`. A clean built host therefore logged four 404 errors.
- Workaround: this host reuses the repository's canonical documentation-site
  favicon assets under `styleguide/sample/public/`; the root regression test
  requires all four files to remain byte-identical.
- Verification: a fresh browser context loads the built catalog with all four
  requests returning 200 and no console errors.

## 13. Minimal hosts omit engine-owned header navigation

- Status: **resolved-upstream** — [zudo-sg #791](https://github.com/Takazudo/zudo-sg/pull/791).
- The 0.2.2 `withZudoSg` composition fills zudo-doc's otherwise empty minimal
  header with Components and Design Tokens links plus Search. A host with
  configured navigation remains authoritative, and `chromeDefaults: false`
  preserves an intentionally empty header.
- Verification: the built catalog exposes both engine-owned links and the
  working Search control at desktop width; its mobile drawer opens and closes,
  and all template routes load without console or network errors.

The three `local-misuse` entries remain as host operating guidance. The seven
original upstream defects and the minimal-header defect are resolved in the
published releases; the two confirmation findings above remain tracked with
local workarounds.
