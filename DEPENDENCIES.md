# Dependency modernization evidence

Recorded 2026-10-11 for delivery A (#896), based on main
`cd373870b56102e5eec59ddb3883bfc1926bd56b`. Delivery B (#897), which migrates
all four styleguide shells, remains separate. This is an implementation-stage
record: pending verification below is not a passed gate or delivery claim.

## Census and baseline

All 18 tracked manifests were inspected: root, doc, four fixtures, eight
packages and four standalone styleguides. They contain 164 dependency,
devDependency and peerDependency declarations covering 46 distinct names.
The five install scopes remain root (including doc), Sample, Shop, Landing
and Blog. Root `autoInstallPeers: false` remains intentional. No lockfile was
deleted or hand-edited, no forced install or hoisting change was used, and
precise release-age exclusions are retained instead of adopting the scaffold's
broad `minimumReleaseAge: 0`.

Baseline frozen installations, documentation build and all four styleguide
builds were captured before edits. Baseline `dedupe --check` ran in all five
scopes; the logs reported no deduplication delta. A lexical detector was used
only for leads, then checked against imports, scripts, config, generated
output and the active native-editing branch. No removal quota or utility
replacement was introduced. PR #893 and its branch remain untouched.

| Scope | Baseline raw lock records | Current draft records | Delta | Baseline advisory entries (high/moderate/low) | Current audit |
| --- | ---: | ---: | ---: | --- | --- |
| Root + doc | 657 | 678 | +21 | 20 (7/8/5) | 0 advisories |
| Sample SG | 212 | 212 | 0 | 5 (1/1/3) | 0 advisories |
| Shop SG | 208 | 207 | -1 | 2 (1/0/1) | 0 advisories |
| Landing SG | 208 | 207 | -1 | 2 (1/0/1) | 0 advisories |
| Blog SG | 208 | 207 | -1 | 2 (1/0/1) | 0 advisories |

Counts are keys in each lockfile's `packages` map, not installed disk packages
or unique vulnerabilities across scopes. No baseline critical advisories were
reported. Root's change comprises 80 removed and 101 added records; platform
packages and the new framework graph contribute to the increase. Sample has
41 removed/41 added records; each other SG has 29 removed/28 added. Removing
and re-adding the optional-peer parents also refreshed their supported CodeMirror,
Inquirer, Lezer, PostCSS and utility ranges. No parent version changed. These
are actual lock deltas, not a blanket reduction or unchanged-output claim.

Final `dedupe --check` passes for all four SGs. Root returns a nonzero
dedupe finding: refreshed workspace Vitest resolves Vite 8.3.4/Rolldown 1.2.13,
while the application retains Vite 8.2.2/Rolldown 1.2.6. Applying dedupe would
upgrade the application bundler and also coalesce esbuild/platform records.
Decision: KEEP this supported duplication in A to avoid an unrelated application
bundler migration. This is not reported as a passing root dedupe check.

Disposable session evidence is under `/workspace/dependency-evidence`:
`manifests-baseline.json`, `census.md`, five `*-baseline-{audit.json,dedupe.log}`
sets, `root-after-audit.json` and `root-lock-delta.json`. Baseline SG tarballs
and fingerprint records preserve routes, HTML visible text/links, CSS,
generated source and asset hashes. They are local verification evidence, not
repository artifacts or a substitute for final CI.

## Security decisions

Root's refreshed audit reports zero entries at every severity. Supported
parent updates and targeted resolution refreshes address YAML 2.8.3,
DOMPurify 3.4.16, brace-expansion 5.0.12, source-map-js 1.2.2,
smol-toml 1.9.1, sharp 0.35.5 and undici 7.29.1/7.30.0. Direct declarations
remain where the source imports them.

Wrangler's exact pin moves from 4.130.0 to 4.149.0. Its published exact
Miniflare child moves from 5.20260908.0-alpha to 5.20261006.1-alpha, supplying
sharp 0.35.5 and undici 7.29.1. The workerd tuple moves from 1.20260908.1 to
1.20261006.1; esbuild moves from 0.28.1 to 0.28.2. This preserves parent-owned
coupling rather than forcing transitive versions. Both Wrangler and Miniflare
retain Node >=22. Published tarballs and path-level comparisons were inspected;
the delta is substantial, not a claim of unchanged implementation bytes.
No deployment or release was performed to validate this change.

## REMOVE, KEEP and DECIDE

| Decision | Dependencies / scope | Evidence and consequence |
| --- | --- | --- |
| REMOVE | doc's direct `preact` and `preact-render-to-string` | zudo-doc 6 removes its core Preact peer; the published scaffold and local route now use zudo-react. Migrated doc type/content check and real build pass. Application and preview Preact remain. |
| REMOVE | KaTeX in all four SGs | No source/config/generated MathBlock or enabled math feature was found. Published defaults disable math, but zudo-doc 5 and 6 still expose optional peer `^0.16.0`, incompatible with patched >=0.18.2. Manifest removal alone retained stale optional-peer resolution. A disposable proof removed both doc/SG parents with supported `--lockfile-only` commands and re-added their exact original specs; the same sequence now passes in all four hosts without lock deletion, manual edits or overrides. All four frozen installs, audits, builds and current-head CI computed-style checks pass with no resolved KaTeX. Final cleanup comparison preserves every route, visible text, link and all 128 CSS assets (32 per host). |
| KEEP | SG `diff` for this delivery | Although history is disabled, baseline common islands contain dormant history implementation and a diff chunk. Removing the dependency requires separate lost-chunk and behavior review; lexical non-use is insufficient. |
| KEEP | doc `diff` and history server | `docHistory:true`, dev scripts and history comparisons consume these optional peers. |
| KEEP | CodeMirror family and `@lezer/highlight` | Direct editor/formatting and markdown integration imports; active native-editing work uses this graph. |
| KEEP | direct sharp, YAML, Rollup and rollup-plugin-dts | Image optimizer, no-deploy checks and public-entry bundling directly consume these packages. |
| KEEP | Preact, renderer, Tailwind and Vite plugins in application/demo/preview scopes | Actual runtime, creator templates and build configuration need them. Doc's Wind migration does not remove those consumers. |
| KEEP | SG direct esbuild and Blog renderer | Preparation scripts and Blog route fixtures import them directly; transitive availability is not ownership. |
| KEEP | Zod and workspace fixture/contract/UI declarations | Validation and package-boundary/conformance fixtures require direct ownership. No replacement machinery is justified. |

Generic `.katex` CSS selectors and dormant history code already occur in
baseline output. The evidence is absence of rendered math/history UI and
feature usage, not absence of every engine byte. Final SG cleanup comparisons
must preserve actual routes, visible content, links and CSS; Sample's parser
change requires separate behavior evidence rather than global byte equality.

Deliberate duplication remains: independent install scopes; the transitional
2.22.x SG engine versus 4.3.1 doc/UI parser; TypeScript 5.9 versus 6 tooling
ranges; direct image tooling versus Miniflare's exact sharp ownership; and
undici's separate compatible parent ranges. Common-version pnpm resolution
may share physical modules. Artificial duplicate packages are not required.

## Published documentation migration

The registry's current published targets were verified as zudo-doc/history/
create-zudo-doc 6.0.0 and aligned ZFB/runtime/md-wasm 4.3.1. zdtp 0.8.6 and
zudo-sg 0.5.0 are the later catalog targets, not a claim that delivery A
already migrated the four shells.

Fresh 5.28.0 and 6.0.0 scaffolds were generated outside the checkout with
pnpm 11.5.2 and `--no-install --no-git`. Full three-way reconciliation is
recorded in [ZUDO_DEPS_PINS.md](ZUDO_DEPS_PINS.md), including generator gitHead
`b4f974598b27064a092eeadb5b2e5559078a8bb9` and registry integrity. Public
CSS/tsconfig are updated for Wind/zudo-react; the doc route uses the public
`DocHistoryBoundary` and canonical config export. The link checker, home
route, favicons and relocated writing skill are unchanged upstream/current.
English content, Drift, five categories, metadata/footer, wide home, search,
history, sidebar/TOC, assets, dynamic navigation and llmsTxt remain selected.
No MCP or agent-export feature was added.

## Focused parser and package handoff

Published md-wasm 4.3.0 -> 4.3.1 tarballs differ only in README, package
metadata, shipped-artifacts manifest and the four WASM binaries. Shipped
JavaScript parser APIs did not change. The focused render WASM remains
2,197,301 bytes, but its SHA-256 changes:

- 4.3.0: `405a6b1cff82801683645fa94ab22573cc3f7c07793b0791c39dacbc27286425`
- 4.3.1: `78ccf16f881fbc81339ae328f1e7dcc18928a984449467a09f5514ae4116e467`

The UI keeps focused `/render`, its Preact/Tailwind runtime, and DOMPurify
sanitization. The isolation test now proves owner declarations and focused
imports, meaningful HTML/CJK/GFM/highlighting, frontmatter diagnostics and
recovery through both owners. It no longer demands unequal module paths or
compares a module to itself. Existing built-artifact checks verify the emitted
render WASM size/digest against the published manifest, one glue module, and
absence of compiler/parse/highlight-only payloads; the final distribution gate passes with 34 assets, one render WASM and one glue module.

UI package handoff is now `776fb59a46bb53ceb0fa1ff823e83fae764597ac` on
`package/ui-v1`, following `ed372ac37a24485ed469554822db38c8ec1a334e`.
Remote package bytes were read back and show md-wasm 4.3.1 and
DOMPurify `^3.4.16`. The contract pin remains
`c0b452da075b66757c60bd0d721a47062d4354d0`. Sample's exact Git dependency
and handoff records are updated together. Exact external-install and
handoff/tree checks passed against this exact package commit. CMS regeneration processed all
four discovered hosts, with generated records retained in the same change.
The container default umask 0077 was detected by the packed portability gate;
generated contract files were normalized to 0644 and directories to 0755, including
the dist root and tracked source ancestors, and regeneration rerun with
umask 0022. Identity records were produced by the canonical generator only.

## Verification status and holds

Observed passing evidence: root frozen install; migrated doc content/types,
real artifact build (299 files, 29 routes), links (1,090 inspected), images,
and Wind audit with `--fail-on error`; lint/typecheck; 16 focused parser/UI
files with 95 tests; and four-host CMS regeneration. The Wind audit reports
one informational dynamic-construction observation (`docs;`), no errors.
History generation remains the existing local default unless
`GEN_DOC_HISTORY=1` is set; a local build is not proof of historical data.

Final local build, distribution boundary, preview style isolation, doc check and
all four SG builds pass. The cleanup comparator preserves route JSON, all 125
HTML pages (normalizing only the islands-entry filename hash), visible text,
links and all 128 CSS assets (32 per host) byte-for-byte. Sample's intended render WASM update
is verified separately. Five final audits contain zero advisories; four SG
frozen installs and dedupe checks pass. Root duplication is retained as above.

Exact Git UI/contract external installs, public installed-package verification,
conformance/negative boundaries, consumer/creator/provider/headless boundaries,
CMS checks and package handoff checks have passing evidence. Independent review
of final delivery A commit `08facd508648c5bfb2e2b02ed127b8858ae99e46` found no
remaining source finding. All 22 jobs in final-head CI run
38160898345 (linked from PR #898)
passed, including the full unit, build, packed-host and browser lanes.

Supplementary doc browser checks pass for English content/navigation, wide home,
search and repeated SPA navigation, computed theme, sidebar/TOC visibility,
history dialog/error handling and mobile escape/focus. The default local build omits history artifacts. A separate scratch run
generated all 28 histories from real, nonshallow Git; three configuration
revisions match exact git content. The published 6.0.0 loopback history server
returns the same payload, and browser revision selection, real added/removed
diff lines, same-version Compare disabling, reopen and Escape/focus all pass. Local pinned Chromium download returned HTTP 403, so this
supplementary probe explicitly used system Chromium; CI uses pinned Playwright.

Local aggregate checks exposed two environment defects: umask 0077 and cached
0600 package metadata broke permission-sensitive identities, and stale private
workspace hoists exposed an undeclared image-editor package to Vitest. Canonical
0022 generation plus a fresh pnpm store passes unchanged public verification;
focused unchanged digest tests pass. A clean frozen scratch installation proves
the hoist assertion passes without changing configuration or tests. A clean root frozen reinstall under pnpm 11.5.2 now passes; both unchanged
focused files pass all seven tests. Earlier aggregate failures are
not represented as a passing aggregate invocation.

Delivery B is recorded separately below; delivery A's transitional compatibility
proof remains against the four original hosts.

Conditional merge authority does not authorize the production deployment
triggered after successful main CI. Before any merge, an already-authorized
control must be verified; otherwise retain the reviewable PR and hold merge.
No workflow disabling, secret/trigger alteration or deployment permission is
inferred. Issues close only after their recorded scope integrates; B and its
parent/tracker are not complete merely because A is prepared.


## Delivery B: published catalog shells and owned Preact previews

Delivery B starts from reviewed A commit
`08facd508648c5bfb2e2b02ed127b8858ae99e46`. The disposable Sample experiment
proved the public API route and actual preview before the other three migrations.
All four independent hosts now declare zudo-sg `^0.5.0`, zudo-doc `6.0.0`,
ZFB/runtime/md-wasm `4.3.1` and zdtp `0.8.6`. Original declaration operators
and the five install scopes remain intact. Sample retains the exact UI Git
commit documented above; the three demos do not acquire that dependency.
Scaffold and release provenance is in [ZUDO_DEPS_PINS.md](ZUDO_DEPS_PINS.md).

The shell uses published zudo-react/Wind exports. A host-owned detail route
composes public `StyleguideLayout`, `CodePanel`, `DetailWorkbench`, registry and
doc chrome/context factories. It preserves source/copy, live CSS, controls,
resizing and token entry points without importing private engine routes.
A single actual story corpus generates serialized descriptors and preview-loader
identities; render functions and VNodes remain in the separate Preact bundle.
Actual pack CSS uses its own Tailwind build before ZFB. Real settled browser
captures supply thumbnails. The preserved census is 101 stories and 339 variants:
Sample 12/71, Shop 35/105, Landing 30/90, Blog 24/73. File and variant counts
are deliberately distinguished; Shop's `cart-page` file retains slug `cart-lines`.

The same-origin `/components/preview` receiver validates origin, source,
protocol version and identity, replays readiness, handles props/resolved theme,
reports border-box height and cleans up navigation. Token overrides use the
public token receiver. Controls wait for activation and preview readiness;
reset remains props-only. Shell and preview TypeScript projects preserve their
respective JSX runtimes. All shells extend the published doc base configuration.
Generated corpus, preview and thumbnail outputs are ignored and rebuilt; dev
watching serializes regeneration before restarting the public ZFB CLI.

### B terminal dependency decisions

- **KEEP** direct Playwright 1.62.1, Vite 7.3.7, Tailwind's Vite adapter and tsx
  in each host: they own the actual preview compiler and settled browser
  thumbnail pipeline. Browser installation precedes host builds in CI.
- **UPDATE** Vite 7.3.5 to supported same-major 7.3.7. Full audits exposed
  GHSA-g7r4-m6w7-qqqr through esbuild 0.27.7; the patch permits esbuild 0.28.2,
  now resolved in all four locks. No override or advisory suppression was used.
- **REMOVE direct declaration** of preact-render-to-string from Sample, Shop
  and Landing after checking source, configuration, dev/build and thumbnail
  consumption. Preact's optional renderer peer still retains it transitively;
  this is not a claim that the package disappeared from the resolved graph.
- **KEEP** Blog's renderer: its active route fixture check imports it directly.
- **KEEP** diff for the public doc common-engine path. **KEEP REMOVED** KaTeX:
  B starts from A's verified unused-math removal, not the disposable spike lock.
- **PRUNE** only obsolete exact release-age entries (4.3.0/2.22.x); preserve
  precise current exceptions and root `autoInstallPeers: false`.

No utility replacement was required. No forced removal quota, lockfile deletion,
manual lock editing, broad override, forced install or hoisting change was used.
The separate host compiler/browser graphs and root Vite/Vitest duplication are
intentional; no reduction claim is made for the new architecture.

### B lockfile and census delta

Counts include every package/platform key. Root remains 678 records, unchanged
from A (baseline 657). All 18 tracked manifests remain; declarations total 171
across 45 names, compared with A's 158/45 and baseline 164/46.

| Scope | A to B records | Added / removed vs A | Baseline to B records | Added / removed vs baseline |
| --- | --- | --- | --- | --- |
| Sample | 212 to 248 | 47 / 11 | 212 to 248 | 88 / 52 |
| Shop | 207 to 244 | 48 / 11 | 208 to 244 | 76 / 40 |
| Landing | 207 to 244 | 48 / 11 | 208 to 244 | 76 / 40 |
| Blog | 207 to 244 | 48 / 11 | 208 to 244 | 76 / 40 |

All five final full-graph audits report zero advisories, including development
dependencies. The four SG frozen installs and `dedupe --check` pass. Root retains A's
reviewed lock and deliberate dedupe finding. Final aggregate and browser evidence
will be recorded on the exact delivery B PR head; in-progress checks are not
represented as passed. Both deliveries remain unmerged until the authorized
production-deployment control and ordered integration gates are satisfied.


The former Sample stylesheet unit assertion required UI/Tailwind and doc chrome
in one global stylesheet. That assumption is intentionally retired by the
separate-preview architecture: its replacement verifies current published shell
CSS exports, absence of pack/Tailwind imports from the shell, and actual UI CSS
plus story/preview scan roots in the independent preview. Existing computed-style,
mobile drawer and token-edit behavior assertions remain intact. The focused
stylesheet suite passes all 12 tests.

Final local host builds, artifact checks and Wind error audits pass. All 339
actual variants pass browser rendering and catalog interaction checks, including
real Shop cart/checkout, Landing pricing/signup, and Blog comment/newsletter
state changes. Sample's watched story/metadata/CSS/thumbnail edit and restoration
pass. The first refreshed Sample build had inconsistent server/client identities;
its inputs overlapped a README edit. With inputs frozen, a clean public rebuild
produced matching identities and passed the complete browser/dev proof. This
observation is not labeled a demonstrated upstream defect. The first B CI run
found a prohibited run URL in these records and a test locator selecting a
hidden sidebar link. Portable run IDs and a unique actual catalog-card locator
correct those defects without bypassing the handoff gate or browser assertions.
Final exact-head CI and any later corrections are recorded on PR #899.
