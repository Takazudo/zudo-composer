# Native editing verification

Baseline: `main` at `1d79be39d038fc4c9da3724dc5e6d0c109095930`, freshly
fetched before implementation. Node `24.19.0`; pnpm `11.5.2`; frozen root install
passed. The managed machine's unrelated bare `pnpm` was `11.19.0`, so a temporary
PATH shim forwarded nested `pnpm` to Corepack. No repository engine gate changed.

All heavy/port-owning commands ran serially through
`bash "$HOME/.codex/scripts/heavy-guard.sh" -- ...`.

## Completed evidence

- `corepack pnpm typecheck`: baseline and changed tree passed, including public
  type checks. The new resolved-config key remains required (possibly undefined),
  preserving the existing complete-resolved-config type assertion.
- `corepack pnpm lint`: passed. Generated `editing.d.mts` joins the same explicit
  generated-output exclusion used by the existing public declarations.
- `corepack pnpm no-deploy:check`: passed, including the new installed proof.
- `corepack pnpm build:public`: passed; nine public generated artifacts current.
- `corepack pnpm cms:regenerate`: passed for all four hosts, 241 producer files;
  generated identities updated together. The ownership ledger was verified by
  the producer and its path ownership did not change.
- Focused service/config/inspection: 56 tests passed, including bound-template
  apply/undo, changed template, root restrictions, extra defaults/wrappers,
  dynamic Mapping ancestor rejection, exact Japanese text and supplied table,
  managed image, stale/tampered/inactive plans and concurrent repeated apply.
- Composer storage/file-provider: 64 tests passed, including real second-process
  exclusion, journal-stage failures, receipt retry, unexpected recovery bytes,
  retained uncertain locks, and nonblocking dependency snapshot barriers.
- Composer provider plugin: 55 tests passed with session lease integration.
- Additional lease and initializer tests passed; concurrent shutdown awaits one
  shared release promise, preventing process exit before lock removal.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/verify-edit-install.mjs`:
  guarded **PASS**, 78 seconds. Packed tool/contract outside the repository;
  three installed CLI insertions; public `zudo-composer/editing` inspection and
  receipt; exact Japanese `textContent`, supplied table cells and decoded managed
  image in actual Composer; CLI plan/apply blocked while server live; clean
  server stop and restart preserved all three insertions.

The environment lacked Playwright's downloaded Chromium binary. The dedicated
proof used the already-installed `/usr/bin/chromium`, explicitly selected by its
supported override. For the remaining standard lanes, the pinned Playwright CLI
later downloaded Chromium and its headless shell/FFmpeg unprivileged into
`/tmp/composer-playwright-browsers` using `PLAYWRIGHT_BROWSERS_PATH`. No system
packages, privileged browser provisioning, or WebKit repair was attempted.

## Final gate results

- The first broad aggregate reached all 386 unit-test files: 4,794 tests passed,
  five failed. Four failures were integration updates required by this change:
  CLI help text, fake Vite server shutdown, and aggregate command order. Their
  complete affected suites subsequently passed (38 CLI, 3 installed Assets,
  69 no-deploy tests). Assertions were preserved; the aggregate retains its
  existing final documentation/styleguide handoff sequence.
- The fifth failure exposed this managed checkout's restrictive 0600/0700 file
  modes, also responsible for CI-only CMS pointer identity drift. Tracked modes
  were restored to Git's 0644/0755 executable policy and subsequent commands use
  umask 022. The unchanged four-test UI package mode-parity suite passed.
  `cms:regenerate` then passed all four hosts (241 files, guarded 34 seconds),
  followed by `cms:check` (guarded 25 seconds). Only the 16 generated current
  pointers changed; no generated file was hand-edited and mode hashing remains
  unchanged.
- `corepack pnpm exec vitest run server/edit/__tests__/service.test.ts`: all
  23 tests passed, including native ESM cache refusal before
  the first service operation, changed same-version installed dependency bytes,
  and reopening a service in the same process.
  `corepack pnpm exec vitest run server/site-project-local/__tests__/pack-source-graph.test.ts`
  passed all 18 tests. Independent source review reported no remaining must-fix;
  that reviewer did not run tests.
- Packed-host shutdown now waits for the descendant's inherited output streams
  to close, preventing the package-manager launcher from killing lease cleanup.
  Three lifecycle tests passed, including a real child with delayed lock removal;
  the confinement allowlist was not broadened.
- Final public regeneration passed (nine files, guarded nine seconds), and the
  no-deploy assertion passed (104 scripts, 302 sources, one workflow, 257 commands).
  CI now schedules the installed native editing/Composer reopen proof.

- Final `pnpm edit:installed` with the same system-Chromium override: guarded
  **PASS**, 132 seconds. This rerun includes all three insertions, durable receipt
  retries, guarded undo and a fresh reviewed reapplication, the installed public
  API, live-server exclusion, and real Composer first open and server restart.
- Final full lint and typecheck passed after regenerated public declarations.

- Earlier corrected aggregate rerun: all 386 unit-test files / 4,800 tests passed
  (417.97 seconds), followed by production build, preview isolation (three builds,
  five entries), and distribution boundary (34 assets, one WASM, one glue).
  Installed editing, documentation and all four styleguides also passed. Its
  final host-install stage failed because the default Playwright Chromium path
  was absent. This run was not an aggregate pass; the resumed run below uses
  the pinned task-local browser directory throughout.
- `corepack pnpm contract:conformance` and `contract:negative-scan` passed.
  Conformance verified 635 packed files, exact public exports, runtime imports,
  strict Bundler and NodeNext types, and checkout/packed release portability.
  The local conformance command used `umask 022` and
  `pnpm_config_store_dir=/tmp/composer-pnpm-store-canonical`: the original shared
  pnpm content store retained 0600 files from the managed session's initial
  restrictive umask. A fresh task-local store fixed parity without changing
  any digest or assertion. CI also passed these gates on the corrected source.

No repository release, merge, or deployment was performed; release-API tests
used disposable local hosts.

## Resumed shutdown verification

CI exposed two real lifecycle regressions: a Composer mutation lock retained
after packed self-host restart, and the dev browser runner force-killing a
server before its host lease was released. The fix drains all async middleware
(including preview/release handlers), disconnects pending challenges and body
streams first, and keeps the module evaluator alive until storage work settles.
CLI and successful browser/helper shutdowns no longer impose a forced cutoff.
Failed startup closes the captured server, including later-plugin/listen errors.

- Focused affected suites: six files / 108 tests passed. Coverage includes a
  close delayed beyond three times the former two-second cutoff, incomplete body
  streams, pending operator challenges, late async handler completion, and
  configure/listen failure cleanup. The actual delayed-child helper regression
  also passed with a 5.2-second lease release, beyond its former cutoff.
- `pnpm smoke:host-install -- --host self-host`: guarded PASS, 40 seconds.
  Actual browser authoring and fresh-context server restart, both release
  portability directions, unchanged write confinement, data survived removal.
- Two separate `pnpm test:browser:dev` invocations targeting
  `tests/browser-dev/assets-download.pw.ts` then
  `tests/browser-dev/assets-editor.pw.ts`: guarded PASS, 47 seconds, 1 + 2 tests.
  The second server started and both runs shut down without retained host locks.
- Full lint and typecheck passed. Independent read-only lifecycle review found
  no remaining blocker; the reviewer did not run browser tests.
- On source revision `0975cf418aa1ef062ee0abae9b2e0fb89e287c5c`, complete
  `corepack pnpm check`: guarded **PASS**, exit 0, 789 seconds. All 389 unit-test
  files / 4,812 tests passed (323.98 seconds), followed by production build,
  preview isolation, distribution boundaries, installed editing/reopen proof,
  documentation and all four styleguides. The final packed-host lane passed
  all four disk hosts, the synthesized fixture and freshly generated output,
  including unchanged write confinement and bidirectional release portability.
- The same source revision's CI run (linked from [PR #893](https://github.com/Takazudo/zudo-composer/pull/893))
  passed all 22 jobs. Validation included the same 4,812 unit tests, installed
  native editing proof, 45 host browser tests, 25 dev browser tests, six
  SiteProject browser tests and seven demo browser tests. The packed self-host
  restart and sequential dev-server lifecycle regressions both passed in CI.
- Full local `pnpm test:browser:host`: all 45 tests passed, guarded **PASS**,
  697 seconds. `pnpm demo:build-sites` and all six local SiteProject browser
  tests also passed.
- Local demo route crawls for webshop and blog failed, and an unchanged retry
  reproduced Chromium `net::ERR_INSUFFICIENT_RESOURCES` during module loading.
  Their separate interaction tests and the sample/landing tests passed. The
  failed traces were preserved; no timeout, assertion or browser gate was
  weakened. These local failures are not claimed as passes or established
  baseline failures. The same source revision's complete seven-test demo lane
  passed in CI, which supplies the successful verification of those crawls.

The replacement environment's pinned Chromium was downloaded unprivileged again
into the task-local browser directory. Subsequent heavy commands use umask 022,
`pnpm_config_store_dir=/tmp/composer-pnpm-store-canonical` and
`PLAYWRIGHT_BROWSERS_PATH=/tmp/composer-playwright-browsers`.

## Direct Vite shutdown follow-up

A final filesystem audit caught a retained root lease even though the direct
Vite SiteProject browser tests passed. A diagnostic recorded two SIGTERM
deliveries 30 milliseconds apart: the package-manager launcher forwarded the
process-group signal after Vite had consumed its once-listener. The second
signal interrupted lease release after Vite close completed. A separate real
child probe also demonstrated natural exit during unref'ed close work.

The shared shutdown helper now keeps the event loop alive and retains a scoped
SIGTERM listener until lease release completes; both are removed in `finally`.
It preserves all existing signal listeners and retains locks on failed close.
The SiteProject runner now explicitly fails if its exited server left a lease,
without deleting that lease.

- All seven shutdown tests passed, including real child processes with single
  and repeated SIGTERM and listener cleanup on success/failure.
- Two consecutive full SiteProject browser invocations passed, six tests each,
  with explicit lease absence checks between and after them: guarded **PASS**,
  103 seconds. No cleanup occurred between the two runs.
- Full lint/typecheck and `handoff:boundary` passed. The handoff scanner caught
  an Actions URL in the earlier evidence update; the URL was moved to PR
  evidence without changing the scanner.
- Independent read-only review found no remaining must-fix; the reviewer did
  not run tests. The [draft PR](https://github.com/Takazudo/zudo-composer/pull/893)
  records the latest exact-head aggregate and CI results separately from the
  dated source-revision evidence above.

## Current-main reconciliation (2026-10-11)

This section records a new local integration; all evidence above remains
historical. The fetched base was `main` at
`cd373870b56102e5eec59ddb3883bfc1926bd56b` (including PR #894), and the
existing draft branch began at `0d6ee0e6eaaae350a5fdc1873353f5564162cdde`.
An additive merge committed as `79dd410f49125afeadfc1e3a1523f8c30ea2f09f`.
The verified implementation and generated-host follow-up committed as
`24ecaf3451ad1f3e3f0a56f59accc006c2b95cf4`.

The merge conflicted only in four generated `demo-sample` CMS current pointers.
The authoritative sources were preserved, followed by `cms:regenerate` and
`cms:check`. This managed checkout initially used umask 0077 and 0600/0700
tracked modes; restoring Git's 0644/0755 modes and regenerating produced the
four pointer tokens in the follow-up commit. No identity hashing was weakened.
Current main's UI pack handoff identity
`ed372ac37a24485ed469554822db38c8ec1a334e`, Markdown WASM 4.3.0,
isolation rules, lockfiles and parser coverage are retained. The root frozen
install used Node 24.19.0 and Corepack pnpm 11.5.2.

The upgrade exposed a real Vite shutdown race: closing its plugin container
while initial client transforms remained active could leave a SIGINT shutdown
waiting indefinitely. The authoring shutdown helper now awaits Vite's client
request idle barrier after draining middleware and before closing Vite. A new
ordering test and the real dev-server SIGINT suite pass; the server-lifetime
authoring lease and CLI exclusion remain in force.

### Executed checks on the integrated tree

- Focused native editing, storage, lease, shutdown, Markdown and package
  isolation suites: 10 files / 93 tests passed. The affected shutdown and
  parity suites then passed 5 files / 28 tests; plugin and installed-asset
  fixtures passed 2 files / 58 tests.
- `corepack pnpm check` ran serially through the heavy guard. All 390 unit-test
  files / 4,816 tests passed. Lint, typecheck, package-handoff and CMS checks,
  production build, preview isolation, distribution boundary, docs build and
  all four styleguides passed. The aggregate's `edit:installed` stage passed:
  installed CLI and public API, exact Japanese multiline text, supplied table
  values and managed image, real Composer open/render and restart, receipts,
  retries and guarded undo. Its packed-host stage passed the synthesized
  fixture and failed during the `demo-blog` route crawl as described below.
  Thus the **aggregate did not pass overall**.
- Separate `contract:conformance`, `contract:negative-scan`,
  `contract:external-install -- --exact`, `ui:external-install -- --exact`,
  `public:installed`, `demo:build-sites`, `demo:build-editors`,
  `sg:build-styleguides`, `cms:regenerate` and `cms:check` passed. The contract
  conformance pack contained 636 files and verified strict Bundler/NodeNext
  imports and both release-portability directions. The external checks kept
  contract identity `c0b452da075b66757c60bd0d721a47062d4354d0` and the
  current-main UI pack identity above.
- `test:browser:dev -- tests/browser-dev/assets-download.pw.ts` passed its
  single test. Full `test:browser:dev`, `test:browser:site-project`,
  `test:browser:demos` and `test:browser:demo-editor` ran but failed route or
  page-console checks on the browser resource error below. `test:browser:host`
  was stopped after repeated instances of the same error; it is not a pass.

### Browser environment limitation and baseline

The pinned Playwright Chromium download endpoints returned HTTP 403 in this
environment. Local runs therefore used installed Chromium 154.0.8037.57 via
`/usr/bin/chromium` (with task-local Playwright paths for browser suites).
This browser requests `/favicon.ico` and reports its HTTP 404 as a console
error; the repository's existing strict page-console checks fail. The
installed-host diagnostic now prints the failing resource URL, without
relaxing any check. The same `smoke:host-install -- --host demo-blog` command
was reproduced in an isolated current-main worktree at baseline
`cd373870b56102e5eec59ddb3883bfc1926bd56b`: its installed 18-route,
14-file artifact reached the route crawl and failed with the same
`Failed to load resource ... 404 (Not Found)` signature. These local browser
lanes are **failed under the available browser**, not verified passes. No CI
result for the new integrated commit has been inspected or claimed.

The native editing foundation still supports strict text, managed image and
table insertion through owner-qualified, page-only plans with exact review
binding, writer revision checks, durable receipts, idempotent retries and
guarded undo. It refuses unsupported host shapes and keeps planning and apply
blocked while the authoring server runs. Next work remains (1) browser-safe
save/revision coordination, (2) page-first review UI, and (3) one restricted
local agent runner with distinct proposal, approval and receipt state.
