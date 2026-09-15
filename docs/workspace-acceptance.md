# Final workspace acceptance — #245

This is the durable acceptance map for the completed data-first CMS graph.
**Browser execution and visual acceptance are pending manager execution.** Source
audit, TypeScript and unit/static checks are not screenshots, browser passes,
CI, or final merge evidence. Record the integrated commit and actual results in
the manager's final handoff; do not infer them from this document.

## Approved design audit

The portable source of design contracts is [workspace-design.md](./workspace-design.md).
The implementation retains the application-owned shared `ui`, `overlay`,
`outline-tree`, `editor-chrome` and `library-page` primitives and semantic tokens.
The installed component provider remains a separate preview/runtime boundary.
No prototype implementation, copied source identity, image pipeline, checkout,
class alias or parallel component registry was introduced by this acceptance work.

The source audit found and corrected one obsolete production policy with explicit
manager approval: outline, canvas-menu and toolbar insertion no longer prohibit
children beneath Mapping-backed pages or redirect insertion to their siblings.
All three use the existing structural command boundary; missing parents and the
single-root rule remain guarded. Focused tests cover the outline's exact index,
the canvas action, and root/non-root toolbar targets.

| Area | Current source contract audited | Browser proof / manager visual check |
| --- | --- | --- |
| Shell | Content hierarchy from canonical provider models; optional named pins; independent 760px drawer and collapsible desktop rail; no bottom-tab substitute | `workspace.responsive.pw.ts`: all routes at each width/theme, persisted collapse, drawer keyboard trap/Escape/focus, real coarse pointer; visually compare 760 vs 761 |
| Content | Directory, Entries, Fields/Raw/Used by, grouped/writing task views; stable field-ID storage and provider-qualified refs | `content.pw.ts`: exact raw envelope, ordered relation survives reload; named task pin persists while the canonical project stays unchanged |
| Composition | Real installed component cards, device choice, enlarged preview, provider-safe iframe, shared chooser/history | `composer-undo-redo.pw.ts`, `provider-proof.pw.ts`: actual rendered-card signal, iframe dialog, Escape, existing component/CSS/WASM/export proof |
| Mapping | Explicit projections and materialization; published/draft policy, filters/sort/limit, pins and effective records | `mapping.pw.ts`: saved pin order and real repeated latest-News output; field/target drift repair remains covered |
| Sitemap | Canvas and outline retained alongside Routes and Navigation; stable independent menus and ancestor-qualified routes | `outline-tree.responsive.pw.ts` asserts geometry and exact insertion |
| Assets | Real global bytes, logical folders, metadata, immutable replacement/history, usage-aware trash/restore | `assets-upload.pw.ts`: signature/checksum bytes, old URL still serves old bytes, stable asset ID and changed immutable version, exact release lock; inspect per-use labels and folder states |
| Review | Changes/Checks/Affected, explicit Content selection, local-only apply/build/activate, staged identity independent of newer drafts | `site-project-acceptance.pw.ts`: staged candidate identity stays independent of a newer working draft across local activation and reload |
| States | Empty/no-match, loading, error, unavailable and stale-target messages are not editable success | `workspace-states.pw.ts`, responsive source: refused workspace provider, delayed/rejected Assets, recovery, no-match, unavailable provider URL; existing unit suites cover blank schemas and incomplete reference diagnostics |

Every module remains navigable: Overview, Content, Assets, Compositions,
Mappings, Sitemaps, Review & release, and the separate Website preview chooser.

## Viewport and interaction matrix

`tests/browser/workspace.responsive.pw.ts` uses **1440, 1100, 761, 760 and 390px**
at 900px height, each in light and dark, with reduced motion. Its responsive
suffix enrolls both the configured desktop and genuine coarse/touch projects.
It asserts zero document horizontal overflow, visible pane containment, every
module's readiness heading, persistent desktop collapse, all navigation links,
drawer focus containment, and Escape restoration. It emits named screenshots
for each module/width/theme into Playwright's test output directory.

The existing Content journey additionally checks pane scroll ownership, visible
focus rings, actual touch target sizes and overlay geometry. Its retired
bottom-tab assertion now checks the actual modal drawer and restoration.
The outline desktop/coarse suite checks sibling-boundary insertion geometry,
reserved 44px coarse insertion space, IME Enter/Escape immunity, Escape focus
and actual persisted first-sibling order. Missing outline adoption is a hard
failure, not a conditional skip. Existing menu/dialog sources preserve portal
placement and focus checks. Visually inspect theme contrast, complete assets,
branch disclosures, adjacent controls, scroll ownership and keyboard focus at
all breakpoints; screenshots alone do not replace the semantic assertions.

## Activation isolation

`tests/browser/site-project-acceptance.pw.ts` runs only in the guarded dev lane
and requires the runner's `ZUDO_SITE_PROJECT_ROOT`. Its activation steps change
that disposable local active release and nothing outside it.

The journey confirms/cancels the real example action, reloads the selected
workspace, amplifies canonical Content through real provider transactions to 31
reference targets, checks saved reference order/Raw storage, persists query pins,
visits all Sitemap views, resolves a nested Guide→Product route, renders real
Composition cards, uploads/replaces owned bytes, checks old immutable delivery,
and checks that the real staged lock pins the owned version. Two browser tabs
exercise persisted Content CAS and stale approval; activation leaves unselected
newer B private. A second explicitly selected draft release makes B visible at
its activated route and after reload. No test provides a fake activated graph,
hard-coded pin manifest, provider runtime, successful usage scan or cloud API.

The ordinary dev foundations use `workspace-bootstrap.ts` to explicitly initialize
a workspace from the validated bundled source through the real workspace
service, which writes it to the host's filesystem exactly as authoring does.
They do not depend on an activated release and do not bypass initialization
failures.
Asset uploads are additive, uniquely named test assets; immutable versions are
not permanently purged. Existing reversible asset cleanup stays in its Assets
suite. The manager's test worktree/root must remain disposable. Never point the
activation journey at an operator's persistent release root.

Capability-based dev/dist skips are intentional separation: unavailable
production authoring must be asserted unavailable, not pretended available.
No feature-adoption skip or focused `test.only` is permitted. Source static checks
guard the required matrix, scenario registration and IME/index assertions;
they explicitly do **not** execute or certify browser behavior.

## Host document readiness policy

The [R5 decision on #470](https://github.com/Takazudo/zudo-composer/issues/470#issuecomment-5621655911) replaces the separate global-setup preflight with readiness at the actual host document transitions. R4 falsified the preflight: it passed while fresh-context Content, later deep-record navigation and Hero reload readiness failed under load. A separate browser context cannot certify a later document. Those failures remain evidence; missing original R4 topic trace binaries have not been reconstructed.

`tests/browser/host-test.ts` supplies an automatic per-test runtime collector and `documentReady`. Each adopted goto, reload or selected route-action runs once under one absolute monotonic **47,000 ms** deadline spanning transition, exact semantic readiness, then `.cms-shell-main [aria-busy="true"]` count zero. Each operation recomputes its positive remaining time. The original test's total deadline remains the outer bound; helpers do not pause or extend it. There is no first-server/first-worker flag, retry, network-idle claim, cache clearing or generic action/assertion timeout increase. Every fresh context, later adopted route, replacement worker and explicitly grouped run receives this policy. Each canonical runner target still owns a fresh server and isolated host filesystem.

Readiness identifies the document's actual state: scoped Content tree items, the intended deep-record Heading value or focus, exact Mapping names, editor-toolbar Sitemap names that cannot match creation dialogs, and actual Composer iframe headings or ordered Hero links. Direct standalone `/composer/preview` instead requires its exact JS-rendered explanatory text and explicitly skips shell settlement; its original attachment and shell/navigation absence assertions remain. Invalid workspace and missing-asset documents use their error-state landmarks. The seven host specs retain their original actions, assertions, test identities and strict runtime watchers. Only enumerated transitions are adopted; unlisted click-driven editor transitions retain their original assertions.

The pooled ceiling is `ceil(1.5 × max(31295.2, 29893.673828125) / 1000) × 1000 = 47000`. R0b measured the slower initial host navigation-to-heading window; R5's eligible maximum includes transition through semantic target and settlement. R5 had eight complete runner attempts (one quiet plus three loaded per original Composer/Content file), 24 completed tests and 140 navigation observations, with strict runtime failures zero. Exactly three healthy quiet phase observations had ambiguous Sitemap dialog predicates and are excluded from policy estimation; their raw rows and complete-workflow timings remain. The resulting 137 eligible observations support an engineering estimate with 50% margin, not a percentile or all-machine reliability guarantee. Other adopted host sites inherit this conservative pooled estimate subject to independent full-host acceptance.

Whole-test policy budgets are separate from per-document ceilings. Content directory/raw/usage becomes **63,000 ms**, the long models/Mapping/Sitemapper journey **317,000 ms**, and responsive/theme/focus/navigation **54,000 ms**. The same-context journey and both Composer tests retain **120,000 ms**. The measured maxima of Playwright duration were respectively 40199, 210950, 35373, 33491, 30486 and 25001 ms. Only the first Content test uses the cross-study conservative projection `31295.2 + 10397.690185546875 = 41692.890185546875 ms`, rounded upward after 50% margin to 63,000 ms. This combines an initial browser window and paired remaining workflow; it is not an observed full-test duration or a sum of every navigation allowance. R0b's heading and R5's heading-plus-tree predicates differ, so that margin is explicitly estimated. Server launch is outside test time. No other whole-test or numeric configuration defaults change.

Each test/project owns append-only `document-readiness.jsonl` through `testInfo.outputPath`, attached in fixture finalization. Navigation rows include schemaVersion, gate `host-document-ready/v1`, test/project identity, id/kind, ordinal, configured budget, start/end URL, transition/ready/settle/total durations, outcome, phase/error and strict runtime failures. Incomplete phase durations are null; repeated IDs are distinguished by ordinal. Final rows retain primary errors and late runtime failures. Artifact failures fail otherwise successful work; a primary assertion remains primary with additional errors reported diagnostically. No document contents are logged. The unchanged runtime collector remains active through the test and dependent fixture cleanup, and readiness checks it after every phase.

Dev **was measured by R0b**, including hidden initial `/`, imports, initialization and reload. Its empty-workspace bootstrap remains test-owned so `Open workspace` scenarios remain valid; foundations route/busy E60 and outline E30 contracts remain unchanged. Site-project and hosted were not measured. Site-project retains its 30,000 ms expect default, 120,000 ms test default and explicit 60,000 ms Composer assertion. Hosted retains its existing `waitForRoute` behavior and `/content` **Content** heading, distinct from host **All models**. None receives a new timeout or acceptance claim.

R0b used 12 synthetic busy workers ready before startup through landmark observation on the recorded Ryzen/WSL machine. R5 held the same 12-thread load through each entire runner, including all tests and teardown. Filesystem and disk Vite caches were not cleared; uncontrolled background activity and a load-average threshold are not equivalent to that protocol. R5 diagnostic 60,000 ms observation and 600,000 ms test ceilings were measurement infrastructure, not shipping policy or acceptance. Shipping acceptance requires focused unit tests, typecheck/lint, the original Composer/Content runners separately under full 12-worker load held through completion, then full host/dev/site-project lanes and check serialized. Preserve source SHA, all failures, complete shipping diagnostics and load metadata, and copy browser artifacts externally before unit/check runs. Obsolete global-setup lifecycle subprocess tests were retired because their default output directory could clear real browser artifacts. Replacement tests use owned temporary directories and no subprocess. Any new business failure remains a failure requiring exact cause review, never a blanket timeout increase.

## Worker checks vs manager completion gates

Safe worker commands (no browser/server/build):

```sh
corepack pnpm exec tsc -p tests/browser/tsconfig.json --pretty false
corepack pnpm exec eslint tests/browser tests/browser-dev
corepack pnpm exec vitest run tests/browser/acceptance-contract.test.ts
```

Manager must run the full integrated CI-equivalent gates without omissions:

| Gate group | Required commands / evidence |
| --- | --- |
| Source and contracts | `lint`, `typecheck`, `headless:negative-scan`, `site-project:boundary`, `handoff:boundary`, `contract:negative-scan`, `contract:conformance`, `contract:external-install`, `styles:class-names` |
| Unit and artifact | `provider:boundary` (no build); full `test`; one production `build`; `dist:boundary` |
| All three browser lanes | `test:browser:host`, `test:browser:dev`, `test:browser:site-project` through their configured guarded runners |
| Host install | `smoke:host-install`: the packed package installed into a bare project outside this repository, booted, authored, restarted and then removed |
| Boundaries | No provider runtime in host/headless graph; no source-repository access/assets or current-schema aliases; direct-loopback authoring capability only in development; production static/release inspection is read-only |
| Finish graph | Independent foreground review/fixes; root PR ready and green CI; merge into captured main; exact post-merge CI watch; touched issue/branch/worktree resource audit and cleanup |

Use the installed provider commit/tree/spec and separate contract protocol
identities in CLAUDE.md; this work does not change them. Existing tests verify
preview isolation, compiled output, metadata and strict malformed requests. Do
not remove these gates in favor of the new UI matrix. Never claim a passing
host install, permanent main SHA, GitHub completion or visual parity from
worker static checks alone.
