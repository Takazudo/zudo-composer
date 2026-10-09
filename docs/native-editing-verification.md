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

- Corrected aggregate rerun: all 386 unit-test files / 4,800 tests passed
  (417.97 seconds), followed by production build, preview isolation (three builds,
  five entries), and distribution boundary (34 assets, one WASM, one glue).
  Later aggregate stages are still running; this is not yet an aggregate pass.
- `corepack pnpm contract:conformance` and `contract:negative-scan` passed.
  Conformance verified 635 packed files, exact public exports, runtime imports,
  strict Bundler and NodeNext types, and checkout/packed release portability.
  The local conformance command used `umask 022` and
  `pnpm_config_store_dir=/tmp/composer-pnpm-store-canonical`: the original shared
  pnpm content store retained 0600 files from the managed session's initial
  restrictive umask. A fresh task-local store fixed parity without changing
  any digest or assertion. CI also passed these gates on the corrected source.

The remaining aggregate/browser outcomes are recorded when complete. No repository
release, merge, or deployment was performed; release-API tests used disposable
local hosts.

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

The replacement environment's pinned Chromium was downloaded unprivileged again
into the task-local browser directory. Subsequent heavy commands use umask 022,
`pnpm_config_store_dir=/tmp/composer-pnpm-store-canonical` and
`PLAYWRIGHT_BROWSERS_PATH=/tmp/composer-playwright-browsers`.
