# Published dependency verification — 2026-10-23

Base: `0e548318f929bdffc24b57a74e26ca583a94c85c` (main).
Development branch: `chore/composer-zudo-deps-20261023`.
Exact hosted package-output SHA: `802714d0d10c46f1c30225d337375ff40ac12c39`.
Complete delivered payload: 667 files, SHA256 `e9c46e792fd7662571e9ad676eaffe9cfde546e42b8dca97b486d7137f47fcd0`.
Later CMS/evidence-only commits preserve this complete payload; the unchanged payload checker passes.

ZFB/runtime/md-wasm moved 4.6.0 → 4.7.0; Doc/history 7.0.0 → 7.1.0.
Five lockfiles were regenerated with pnpm11.5.2. SG0.5.6, panel0.8.6 and
create-zudo-sg0.2.5 remain current. Scaffold/impact provenance is recorded in
ZUDO_DEPS_PINS.md. Security exceptions remain exact; assertions, retries and
timeouts were not weakened.

## Passed verification

- Frozen installs; lint/types; documentation check; public/hosted/durable,
  CMS, boundary, no-deploy, UI-pack and contract checks.
- Real documentation and all four styleguide builds; all four styleguide
  browser and computed-style checks; documentation desktop/mobile smoke.
- App, demo-site and all four demo-editor builds; style isolation and dist boundary.
- Host browser specs:21 earlier cases plus24 responsive cases in the corrected
  environment. Full development browser lane; six SiteProject cases;40 demo-editor
  acceptance cases. Installed native edit CLI proof.
- Full unit first run:4951 passed,5 failed. All five affected cases passed scoped
  rechecks after pin literal correction, pinned nested pnpm, clean install, and
  canonical checkout permissions. The original aggregate is not claimed green.
- Exact-SHA independent hosted install and frozen reinstall: complete installed
  payload equality, CLI, worker/browser types, worker, browser bundle, Node
  boundary, SQLite, HTTP transport, static renderer and four publication cycles
  in each install phase.
- Both real hosted browser proofs passed: browser-proof.mjs and
  browser-broad-proof.mjs, including independent contexts, backend restart,
  durable edits, exact saved preview, and no-JS ZFB/SG/iframe parity.

The hosted wrapper stopped at `playwright install --with-deps chromium` because
`su` authentication is unavailable. Existing OS browser dependencies had already
run the native browser lanes. `playwright install chromium` then both unchanged
browser proof scripts passed separately. The wrapper itself is not reported green.

## First failures and environment findings

Default umask0077 produced restrictive checkout/generated/cache modes. Canonical
Git modes and a clean contract build under022 corrected identities; CMS was
regenerated. The first host-install smoke still found cached pnpm files at0600
instead of0644 despite byte-identical checkout/tarball content. A fresh isolated
store under022 passed the complete changed-input smoke recheck: four disk hosts,
the synthesized fixture and freshly generated output, including bidirectional
checkout/packed portability. The shared store is untouched. Initial launcher
configuration attempts either rejected the option or still used the old store;
the passing run explicitly verified its isolated store path before execution.

Webshop/blog demo crawls failed with Chromium ERR_INSUFFICIENT_RESOURCES after
about5000 module requests. Exact-main baseline builds and the unchanged demo
lane reproduce both failures (99/73 resource-error occurrences). These two native
crawl acceptances remain unverified in this environment; no assertion or app-code
workaround was added. No coordination issue was created, per task authorization.

## Pending publication gates

UI candidate `4e987d919fe51c905854af2260903ea60c79f2ec` is reachable on development
branch `candidate/composer-ui-zfb-4-7-20261023`. Shared `package/ui-v1` remains
`e5a5a24e6ac88e78b5dacd0ce66749462a315837`; its exact-branch install gate correctly
fails until separately authorized advancement. No PR, main merge, release or live
deployment occurred. No new CI run is claimed (workflow triggers main/PR).

Independent source review found no remaining source issues. Local detailed logs,
first-failure traces, upstream diffs and reproducible handoff are retained under
`/workspace/artifacts/zudo-composer/` in this execution environment.
