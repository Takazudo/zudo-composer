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

## Host cold-start readiness policy

The installed-host browser lane follows the [R2 decision on #470](https://github.com/Takazudo/zudo-composer/issues/470#issuecomment-5617281734): each canonical runner invocation gets one isolated `/content` preflight in Playwright global setup after the web server answers its listener probe. The preflight launches a fresh Chromium context, navigates with the ordinary `load` milestone, requires the exact **All models** heading, then waits for `.cms-shell-main [aria-busy="true"]` to reach zero. It performs no authoring, workspace initialization, storage clearing, cache manipulation or storage-state transfer, and a failure stops the lane before its tests run.

The policy budget is **47000 ms** for navigation through heading visibility and busy settlement as one monotonic deadline. It is `ceil(31295.2 × 1.5 / 1000) × 1000`, based on R0b's maximum measured initial-navigation-to-landmark duration under load. The 50% margin is a policy estimate for scheduling and settlement, not a measured percentile or a guarantee. R0b's assertion-only `/content` maximum of 10430.2 ms cannot be used as an end-to-end budget; R0b did not measure busy settlement. Chromium launch has its separate 30000 ms infrastructure cap and duration, and is not part of the 47000 ms route budget.

Every outcome writes `host-cold-start.json` under the effective host project output directory (the canonical runner gives each target its own output directory) with `schemaVersion`, `gate` (`host-global-setup/content-v1`), `lane`, `baseURL`, `route`, `budgetMs`, `outcome`, `browserLaunchDurationMs`, `navigationDurationMs`, `headingDurationMs`, `settleDurationMs`, `totalNavigationThroughSettleDurationMs`, `runtimeFailures`, and `phase`/`error` on failure. Uncompleted durations are `null`; the summary retains causes and runtime diagnostics without page content or secrets. Setup prints one concise artifact-path summary so the acceptance run can retain measured evidence.

The preflight is cold with respect to its fresh browser context and first `/content` navigation. The specs then use their own fresh contexts and retain their original navigations, assertions, reloads, runtime checks and individual timeout values; those journeys are warm relative to the server graph, and the preflight does not prove that every later route's provider data is ready. Explicitly grouped named specs share one server and one gate, as do desktop/coarse projects and worker replacement. A new canonical target invocation starts a new server and gets one new gate. Persistent-server UI/watch behavior is outside this contract.

The other lanes keep their existing boundaries. Dev keeps `workspace-bootstrap.ts`'s hidden initial `/`, imports, initialization and reload inside each test because a global preflight would invalidate tests that expect `Open workspace`; its foundations route/busy waits stay E60 and the outline wait stays E30. Site-project keeps the exact `Compositions` E60 assertion, T120 test default and explicit 60000 ms Composer wait. Hosted keeps its existing `waitForRoute` contract and its `/content` **Content** landmark, which is different from host **All models**. None of the dev, site-project or hosted measurements were part of R0b, so this policy grants them no new timeout or pass claim. No Playwright config timeout, retry, production code, original lane assertion or `tests/runtime-failures.ts` contract changes under this policy.

R0b's load means 12 synthetic busy workers, one per logical CPU, ready before server startup and held through landmark observation, on the recorded Ryzen/WSL machine. Filesystem and on-disk Vite caches were not cleared and background activity was uncontrolled; a load-average threshold alone is not the same experiment. R4 must retain the load through this gate's busy settlement and the target spec's original first landmark, report gate timing separately, preserve every attempt and failure, and run host, dev and site-project lanes serially. The acceptance expectation is one bounded, measured and strict preflight artifact/summary per host invocation, both named host specs passing separately, the scoped gate tests plus typecheck/lint passing, and all existing lane-specific browser checks still passing. A warm assertion or readiness failure remains a failure and is not repaired by raising a timeout.

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
