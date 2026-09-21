# Upstream integration notes

This host was rechecked on 2026-09-21 with `@takazudo/zudo-sg@0.3.1`,
`create-zudo-sg@0.1.3`, `@takazudo/zfb@2.20.1`, `@takazudo/zdtp@0.8.1`,
`@takazudo/zudo-doc@5.26.3`, Node `24.13.1`, and pnpm `11.5.2`.
The installed UI pack still keeps its separate `@takazudo/zfb-md-wasm`
dependency at `2.10.1`; the standalone host uses the 2.20.1 markdown WASM.

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
- The defect this item reported is fixed: `create-zudo-sg@0.1.3` emits exact,
  fully-versioned release-age exemptions rather than bare package names, so a
  freshly initialized host installs without relaxing the policy wholesale.
- **The host list is no longer a copy of the template's.** Until this bump the
  two matched entry-for-entry (`zdtp@0.8.0`, the `zfb@2.20.0` family with its
  five platform binaries, `zudo-doc@5.26.2`, `zudo-sg@0.3.0`). Adopting
  `zudo-sg@0.3.1`, `zudo-doc@5.26.3`, `zdtp@0.8.1` and the `zfb@2.20.1` family
  moves this host **ahead** of a template that is still pinned to the older
  set, and `create-zudo-sg` will keep lagging every time this host adopts a
  release before the initializer is refreshed. The parity that earlier
  revisions of this item claimed ends here and is not expected to return.
- Consumer policy, deliberately: this host maintains its own eleven exact
  entries and moves each one in lockstep with the matching `package.json`
  version, template or no template. All eleven — one per package, including
  the five `zfb` platform binaries this host never resolves on Linux — are
  updated together, because a missing platform entry passes locally and fails
  the frozen install on another OS. The shape stays the template's (exact
  `name@version`, never a bare package name); only the versions run ahead.
  The host also keeps its extra `allowBuilds` entry for
  `@zudo-composer/component-contract` (item 4), and single-quotes its YAML
  where the template double-quotes — neither changes the resolved policy.
- Verification: with all eleven entries moved to the new versions,
  `corepack pnpm -C styleguide/sample install` regenerates the lockfile and
  `corepack pnpm -C styleguide/sample install --frozen-lockfile` then succeeds
  under pnpm 11.5.2. The lockfile had to be rebuilt rather than patched: it
  still pinned `zudo-sg@0.3.0`, which this bump drops from the exemption list
  while it is itself still inside the release-age window, so the pre-resolution
  policy check rejected the stale file. The rebuilt lockfile's only change
  beyond the six bumped packages and their integrity hashes is a transitive
  `tsx` 4.23.13 → 4.23.15.

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
- The `create-zudo-sg@0.1.3` starter still supplies the complete global-entry
  import order, dashboard/catalog chrome, safelists, and source globs. This
  host keeps `@zudo-composer/ui/styles/composer.css` first and its
  Composer-first cascade order — that ordering is unchanged by this epic.
- What did change: `@takazudo/zudo-doc/theme.css`'s `--color-*: initial` prune
  (item 14) wipes the pack's `--color-border` / `--color-surface-2` at
  compile time, before zudo-doc's own theme reaches the emitted sheet, which
  in turn leaves Tailwind's `.border-border` utility ungenerated and
  ProseMd's `--color-surface-2` references unresolved. The host now imports
  `@takazudo/zudo-doc/theme-no-reset.css` in `theme.css`'s exact former
  position — same order, same other imports — so the pack's own `--color-*`
  roles survive while zudo-doc still wins every reserved bare role by last
  declaration.
- Accepted residual risk: nothing in this import graph currently pulls in the
  `tailwindcss` bundle or `tailwindcss/theme`, so the omitted reset's only
  job — keeping Tailwind's default palette out — has nothing to guard today.
  A future upstream change that re-prepends that bundle into this graph would
  remove that guardrail.
- Verification: `scripts/__tests__/styleguide-host-styles.test.ts` asserts the
  `theme-no-reset.css` import sits after `composer.css`, that `theme.css` is
  absent, and that no `--color-border`/`--color-surface-2` declaration was
  added locally; the host build gates remain green. The Composer import is
  intentionally not replaced by the starter's local token file because this
  host consumes the Git-installed UI pack.

## 11. Layered `hidden` loses to an unlayered consumer SVG reset

- Status: **resolved-upstream** — [zudo-doc #4355](https://github.com/zudolab/zudo-doc/issues/4355),
  fixed in `@takazudo/zudo-doc@5.26.3`.
- The package-owned mobile sidebar toggle used the layered Tailwind `hidden`
  utility for its inactive SVG, while the installed UI pack's unlayered media
  reset sets SVGs to `display: block`. The reset won by cascade-layer order, so
  both icons rendered and stacked at mobile widths.
- 5.26.3 hides the inactive icon with an inline declaration instead, which no
  consumer stylesheet can outrank. The island now defines
  `const HIDDEN_ICON_STYLE = "display:none"` and applies it per icon as
  `style={open ? undefined : HIDDEN_ICON_STYLE}` (X) and
  `style={open ? HIDDEN_ICON_STYLE : undefined}` (hamburger); neither `<svg>`
  carries `hidden` in its `className` any more. Its own source comment states
  the rule: "Icon visibility deliberately does NOT ride on Tailwind's `.hidden`
  utility … An inline declaration sits above all author rules, layered or not,
  so the state holds against any consumer stylesheet."
- **Workaround retired.** The host's unlayered
  `[data-zfb-island="SidebarToggle"] > button > .hidden` rule is removed from
  `src/styles/global.css`. It could no longer match anything: the only
  remaining `.hidden` inside the island is on the backdrop `<div>`, which is a
  sibling of the `<button>`, not a child of it.
- Verification (code and emitted markup, no browser): the installed
  `@takazudo/zudo-doc@5.26.3` carries the inline form in both
  `eject/sidebar-toggle-island/index.tsx` and the shipped
  `dist/sidebar-toggle-island/index.js`, and this host's rebuilt
  `dist/components/index.html` emits the closed-state toggle as one visible
  hamburger `<svg>` beside an X `<svg style=display:none>`, with no `hidden`
  class on either. `scripts/__tests__/styleguide-host-styles.test.ts` now
  asserts the host rule is **absent**.
- **Not measured here.** The 390px browser confirmation for this retirement —
  exactly one icon rendered, a ~24px toggle, and the drawer opening and closing
  without console errors — is recorded by the Wave 2 confirm
  ([#780](https://github.com/Takazudo/zudo-composer/issues/780)), which is
  instructed to restore this rule if two icons appear. No such measurement was
  taken by the change that retired the workaround; the retirement rests on the
  code-level evidence above.

## 12. The initializer omits favicons requested by the catalog head

- Status: **resolved-upstream, with a documented host divergence** —
  [zudo-sg #789](https://github.com/Takazudo/zudo-sg/issues/789).
- The 0.1.1 template had no favicon assets while the zudo-doc-backed head
  requested `favicon.ico`, `favicon.svg`, `favicon-32x32.png`, and
  `favicon-16x16.png`, so a clean built host logged four 404 errors.
  `create-zudo-sg@0.1.3` fixes this upstream by switching the starter to an
  inline `favicon: "auto"` — no `public/` assets required.
- This host deliberately does not adopt `favicon: "auto"`. It keeps its four
  real favicon assets under `styleguide/sample/public/` — byte-identical to
  the documentation site's own (`doc/public/`) and enforced by
  `scripts/__tests__/styleguide-host-styles.test.ts`'s "ships the favicon
  assets advertised by the catalog head" case — because an inline generated
  icon would make this catalog visually inconsistent with our own doc site for
  no gain. This is a deliberate divergence, not an unfixed defect.
- Verification: the favicon-identity test passes; a fresh browser context
  loads the built catalog with all four favicon requests returning 200 and no
  console errors.

## 13. Minimal hosts omit engine-owned header navigation

- Status: **resolved-upstream** — [zudo-sg #791](https://github.com/Takazudo/zudo-sg/pull/791).
- The `withZudoSg` composition, introduced in 0.2.2 and carried unchanged into
  0.3.0, fills zudo-doc's otherwise empty minimal header with Components and
  Design Tokens links plus Search. A host with configured navigation remains
  authoritative, and `chromeDefaults: false` preserves an intentionally empty
  header.
- This epic's 0.3.0 restructure changed the chrome's token namespace (item 14)
  and the pack's `--color-*` cascade (item 10), not the header navigation
  composition or `chromeDefaults` handling, so this defect and its fix are
  unaffected by this epic. 0.3.1 does touch the header composition, but only
  by appending one header-right item — the preview-token-panel trigger of
  item 15 — alongside the Components / Design Tokens links and Search this
  item covers; it neither replaces them nor changes `chromeDefaults`.
- Verification: last confirmed by browser on `@takazudo/zudo-sg@0.2.2` — the
  built catalog exposed both engine-owned links and the working Search control
  at desktop width; its mobile drawer opened and closed, and all template
  routes loaded without console or network errors. Not re-run under 0.3.0 in
  this documentation wave; general regression coverage is Wave 6 (#767).

## 14. `zudo-sg`'s catalog chrome read the pack's reserved `--color-*` keys, which `zudo-doc`'s reset wipes

- Status: **resolved-upstream** — `@takazudo/zudo-sg@0.3.0`.
- `@takazudo/zudo-doc/theme.css` declares `--color-*: initial` at its
  "Namespace contract" boundary — a compile-time `@theme` prune that removes
  every bare `--color-*` key declared before it from the merged theme; it
  never appears in the emitted CSS. `zudo-sg@0.2.2`'s catalog chrome read
  those bare keys directly, so any host that also imports zudo-doc's reset
  theme silently had its chrome tokens wiped. `zudo-sg@0.3.0` moves the
  chrome to its own `--sg-*` namespace, declared in `:where(:root)` as
  `var(--zd-*, <oklch fallback>)` with zero-specificity literal fallbacks, so
  it no longer depends on the pack's reserved names at all.
- **Retired**: no host-side workaround existed for this specific symptom —
  this host never themed the chrome (no `--sg-*` or bare `--color-*` override
  anywhere in `src`/`pages`), so the defect had no locally visible failure to
  work around, and none is retired here.
- **Not retired**: the same reset also wipes `--color-border` and
  `--color-surface-2`, which `@zudo-composer/ui`'s ProseMd typography, its
  syntax highlighting, and the `Card` / `Callout` / `PlaceholderBox` /
  `CtaButton` `border-border` utility still depend on. The 0.3.0 namespace
  move is scoped to zudo-sg's own chrome and does not touch that — it is a
  `packages/ui` consumer concern. See item 10 for the workaround this host
  retains for that half.
- Verification (measured on the emitted stylesheet during this epic's Wave 2):
  all 11 `--sg-*` chrome tokens are declared in `:where(:root)` via
  `var(--zd-*, <fallback>)` with no `--color-*` dependency
  (`zudo-sg@0.3.0/styles.css:32-63`), and a host-source grep for `--sg-` in
  `src`/`pages` returns nothing, confirming no override was ever needed.
  `zudo-sg@0.3.1` carries that block forward unchanged in shape — the same 11
  tokens in `:where(:root)`, now at `styles.css:34-63`.

## 15. `zudo-sg@0.3.1` adds a header token trigger and an engine-route marker

- Status: **adopted upstream feature** — not a defect report. Recorded so a new
  control in the catalog header is not undocumented.
- `withZudoSg()` now appends a preview-token-panel trigger to zudo-doc's
  header-right items. It is gated by a new `headerTokenTrigger` option that
  **defaults to `true`**, and unlike `chromeDefaults` it is unconditional — a
  host with its own `headerNav` still gets the trigger. This host wants it, so
  `zfb.config.ts` deliberately does **not** set the option; the default is the
  adoption. The engine also exports `HEADER_TOKEN_TRIGGER_ITEM` for a host that
  renders its own header, which this host does not.
- 0.3.1 additionally emits a `data-sg-engine-route` marker from `bodyEnd` on
  every chrome-rendered engine route and on the preview iframe document's own
  `html` tag, so client code can detect "this page can use the preview token
  panel" after each navigation. Nothing to configure.
- The 0.3.1 `ZdtpApplyProxyOptions` relaxation (`tabsModule` accepted without
  `routingFile`/`writeRoot`) has **no host impact**: `zudo-sg.config.mjs` sets
  no `zdtpApplyProxy`.
- Verification (built artifact, no browser): `dist/components/index.html`
  contains the header trigger's `toggle-preview-token-panel` control and the
  `data-sg-engine-route` marker, and `dist/components/preview/index.html`
  opens with `<html data-sg-engine-route=true data-sg-preview-doc=true …>`.
  Visual confirmation of the header control belongs to the Wave 2 confirm
  ([#780](https://github.com/Takazudo/zudo-composer/issues/780)).

## Starter structural diff (`create-zudo-sg@0.1.3`)

To keep the "targeted adoption, no starter delta skipped" claim auditable,
this host is periodically diffed against the initializer's own template
(`npm pack create-zudo-sg@0.1.3`, unpacked to `templates/default/`). Re-run
for this epic:

- `zfb.config.ts` differs only in `siteName` ("Sample Styleguide" vs. the
  starter's "Styleguide Starter"), the starter's `favicon: "auto"` line and
  its comment (item 12: this host keeps real favicon assets instead), and the
  starter's top-of-file / `mermaid` explanatory comments.
- `tsconfig.json` differs only in `include` (this host's `stories` vs. the
  starter's `ui`).
- `src/styles/preview-entry.css` differs because this host consumes the
  installed `@zudo-composer/ui` pack's `composer.css` and the `stories`/pack
  `@source` globs, rather than the starter's local `ui-tokens.css` and its
  `ui/` corpus.
- `src/styles/global.css` differs per item 10 (the `composer.css` import and
  `theme-no-reset.css` in place of `theme.css`) and additionally omits the
  starter's `@layer zd-preflight, zd-flow;` declaration and its layered
  `@import "tailwindcss/preflight" layer(zd-preflight);`: this host takes an
  unlayered preflight from the pack's `composer.css` instead. That predates
  this epic and is the reason the host still needs the trailing
  `@import "tailwindcss/utilities"`; it was also the reason for the item 11
  `SidebarToggle` workaround, which `zudo-doc@5.26.3` has now made
  unnecessary. It is recorded here as a known, unadopted starter delta.
  Tracked as [#768](https://github.com/Takazudo/zudo-composer/issues/768) —
  adopting the starter's layered form needs a `packages/ui` change, since this
  host's preflight arrives transitively inside `composer.css` rather than
  through its own import.
- `zudo-sg.config.mjs`, `package.json`, and `.gitignore`/`_gitignore` also
  differ, but only in ways already covered by items 1, 7, 8, and 9 above
  (provider package name, generated-output ignores, component roots, token
  manifest paths) — no new delta beyond those.

The starter's remaining files are content or generated output rather than
structure: `pages/lib/_zudo-sg-islands.ts` is byte-identical here;
`src/content/docs/getting-started.mdx` and `pages/index.tsx` carry this
catalog's own copy and its `.sg-home` shell in place of the starter's
`bg-bg`/`text-fg` utility markup, which is host content by design and not a
skipped starter delta; `src/styleguide/sg-registry.ts` is a generated,
gitignored output here (items 2 and 7). The starter's `ui/` corpus and
`src/styles/ui-tokens.css` have no counterpart because this host consumes the
installed `@zudo-composer/ui` pack instead (items 8 and 10). No other
structural file in the starter template has a counterpart on this host
outside this comparison.

The three `local-misuse` entries (4, 6, 8) remain as host operating guidance.
Eleven entries (1, 2, 3, 5, 7, 9, 10, 11, 12, 13, 14) are resolved in the
published releases — ten cleanly, and item 12's favicons with a deliberate
host divergence recorded above. Item 11's `SidebarToggle` workaround was the
last local CSS workaround and is retired by `@takazudo/zudo-doc@5.26.3`; no
upstream report is still open against a local workaround. Item 15 records an
adopted 0.3.1 feature rather than a defect.
