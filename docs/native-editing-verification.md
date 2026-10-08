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
supported override. No browser provisioning or privileged WebKit repair was run.

## Final gate results

The broader aggregate/browser outcomes and the subsequent installed guarded-undo
extension are recorded below when complete; the draft PR must not imply those
pending checks already passed.
