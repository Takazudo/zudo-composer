# Hosted session performance delivery

Package-output B: **`7c55e90da4ce0a1e513b84d418110436234c877d`**, reachable on `perf/919-hosted-session-state` / PR #920. Final evidence changes are outside the tool's shipped allowlist. The complete canonical-mode payload contains 667 files with digest `b0836326848f0801d94d27a11d1db92082c6621f4ca644c787ad259b100d3df0`; `current-payload.json` and the retained packed inventory bind it to B.

Implementation: one detached deeply frozen projection keyed by session-owned acknowledged state and edit-array identity, a fresh metadata envelope, shared immutable pending/reviewed objects, live preview eligibility on each read, and detached public command results. Checkpoints still copy the full acknowledged content and edits in their existing ordered write queue. Nine new regressions cover reuse/freezing, unchanged old projections, acknowledgement without a local revision increment, later edits, recovery/reapply/discard/refresh, collection results and late creation-form edits, external/public ownership, raw errors, live subscribed/state-only preview eligibility and reentrant reads.

Measurements are in [benchmark.md](benchmark.md), with raw before/after samples. Node 24.19.0, pnpm 11.5.2, Linux x64; five samples over 10/100/1,000 entries, separate first projection / warm reads with a reviewed snapshot / editing including a no-op awaited checkpoint writer. The benchmark consumes projected values into an observable accumulator, equal before and after. No timing threshold is used in tests; cold projection and editing still scale with content size. Independent read-only review found no correctness issues; see [review.md](review.md).

## Exact package and browser proof

The local command was `corepack pnpm hosted:installed <full-B-SHA> <disposable-consumer>`, guarded, with no `--no-browser` argument. Fresh exact Git install and frozen reinstall passed complete inventory equality, public CLI, Worker/browser declarations, workerd, browser JS/CSS/CodeMirror graph, Node compilation, SQLite/process durability, HTTP transport, shared ZFB/SG renderer and two-publication renderer cycles. It then stopped at Playwright system dependency installation because this cloud has no usable root authentication; downloading the pinned browser also returned a destination-policy 403.

The same exact-B frozen consumer then passed **unchanged** `browser-proof.mjs` and `browser-broad-proof.mjs`, with the executable-only override in [system-chromium-override.mjs](system-chromium-override.mjs) selecting preinstalled Chromium **154.0.8037.57**. This resumed lane was guarded (PASS, 50 seconds) and proves real DOM/iframe acceptance on B, including two independent contexts, backend restart, real Markdown/numeric/assets, create/add/reorder, exact saved preview/Submit, B during A, two integrations and no-JS static/SG/iframe parity. See local-browser-proof.log, local-broad-browser-evidence.json and local-verification.json. No browser assertion or application/fixture source was changed.

The canonical CI job additionally passed the **full existing verifier with repository-pinned Chromium 151** on synthetic PR checkout `2c278d309ab85ec228f154ab4b207007eb331be7`. Before installing it, CI checked the complete 667-file shipped payload against B's inventory. This is distinct from B and from the PR head; it proves the same delivered bytes. [CI job/artifact provenance](ci-consumer.json), [CI gate ledger](ci-gates.json) and selected proof lines retain the actual provenance. The cloud could not retrieve the connector's signed artifact URL (403), so the ZIP URL is retained in JSON, not claimed locally inspected. Actual B manifests, both locks, workspace policies, installed-sha and installed inventory are retained here independently.

## Completion ledger and local limitations

| Required stage | Evidence |
| --- | --- |
| build:hosted / build:public; hosted:check / public:check; hosted:durable | Passed locally; 11 hosted files / 9 Node entries; 135 hosted tests. |
| CMS identity | The cloud's umask 077 produced noncanonical mode-sensitive identities. Normalizing Git/build modes and using umask 022 made canonical regeneration restore every existing token. Final CMS fixtures are byte-identical to #905; cms:check passed for all four hosts. |
| Lint, typecheck including public/scripting surfaces; no-deploy and pin checks | Passed locally and in canonical CI. The final benchmark accumulator change separately passed script lint and typecheck:scripts. |
| Full unit suite | 402 files / 4,956 tests passed locally with canonical modes. The earlier umask-077 attempt had three mode-parity failures; the four affected parity tests and the subsequent full suite passed. |
| Headless/consumer/site-project/handoff/styles/provider/UI boundaries, production build, isolation/dist | Passed in the local aggregate prefix and canonical CI. |
| Installed native editing, doc check/build, four styleguide builds with real thumbnails | Passed in the local aggregate prefix. Canonical CI additionally passed styleguide browser/computed-style assertions. |
| Packed-host installation | Local `pnpm check` reached its final stage and **failed**, after the generic host and Blog artifact checks, because system Chromium 154 reported an automatic `/favicon.ico` 404. Guard: FAIL, exit 1, 943 seconds. All six canonical pinned-Chromium CI matrix jobs passed, including Blog. This is distributed command coverage, not a successful local aggregate invocation. No assertion/timeout/worker setting was weakened. |
| Existing host/dev/SiteProject/demos and four demo-editor browser lanes | Canonical CI validation and per-editor jobs supply pinned-browser coverage; see the retained CI gate ledger. |
| Exact installed consumer / frozen reinstall / real browser | Exact B local runtime proof plus resumed real Chromium 154 thin/broad assertions; full pinned Chromium 151 verifier on complete B-equivalent CI payload, as above. |
| Final evidence-only payload | Run `node scripts/check-hosted-payload.mjs --check verification/hosted-content/current-payload.json`; every shipped file/mode/metadata value must remain equal to B. |

UI package `5af34a703ea840db22261a0acf8ee09f69c0ae8e` and contract `c0b452da075b66757c60bd0d721a47062d4354d0` retain their existing bytes and pins. A's old evidence and #904's exact history remain preserved. No production D1/provider test, Pinsel change, release or deployment is implied by these fixture proofs.

## Integration remains held

PR #920 stays **draft**, targeting `feat/hosted-content-authoring-903` for review only. Never merge it into that branch. PR #918 stays ready at `3c19b1ce`; #905 stays ready at `8359b6d5`; #904 stays open/draft at `547b532e`, with `7ca114a3` preserved. No main integration occurred. #901/#902/#903/#906/#907/#908–#917 and #919 stay open pending their actual integrations; unrelated #890/#53/#54/#77 are untouched.

The remaining operational gate is the explicit production-deployment hold in #907 comment 6136072449: successful main-push CI automatically deploys 13 targets. When that condition is resolved, retain #918 → #905 → #920 integration order; retarget #920 to main only after the prerequisites land, refresh affected verification and package equivalence, then mark ready/merge under repository policy. No workflow control or deployment authorization was inferred or changed.
