# Repository guidance

## Permanent ownership

This repository is the permanent home of `zudo-composer`, an installable
authoring **tool**, not an application with its own content. It owns the
Composer document model, source generation, reuse rules, chrome, preview
renderer and same-origin iframe protocol; the Content model, Entry library and
authoring UI; the Mapping binding model, resolver and authoring UI; the
Sitemapper page-tree model, library, authoring UI and Composer-catalog
integration; the Assets metadata model, library route and upload/delivery
boundaries; and the shared filesystem storage engine
(`TransactionalRecordStore`) all five domains persist through.

A host project installs this tool, writes one `zudo-composer.config.ts` at its
own root, and owns everything the tool authors into that host: its
**components** (code — either host-local source reached through the host's own
`exports` self-reference, or an installed themeset package; never a path), its
**templates** (data, not code — a Composition whose `publication.kind` is
`"global-template"`, stored under `compositionsDir` like any other composition;
there is no templates directory or template file format), and its **CMS data**
(the four JSON domains plus assets, rooted at `dataDir`/`assetsDir`). See the
settings table in [`README.md`](./README.md) for the full default layout.

zudo-sg owns only the installed `@zudo-sg/ui` provider: typed component
sidecars, runtime pack, and canonical Composer CSS. Its transitive focused
`@takazudo/zfb-md-wasm` dependency is allowed for `ProseMd`; no zudo-doc, zfb
application runtime/config, virtual-zfb, or styleguide registry may enter this
tool. Never copy provider components or add a fallback registry. `@zudo-sg/ui`
is otherwise an ordinary component pack — any themeset that satisfies the same
contract is interchangeable with it.

The tool's authoring routes are `/`, `/composer`, same-origin
`/composer/preview`, `/content`, `/mapping`, `/sitemapper`, and `/assets`.
An activated host site is delivered under `/site`; each static site's own routes
come from its verified `dist-site/site-manifest.json`. Only Sample Studio's
hosted Composer production target uses frozen route data in
`packages/demo-studio/hosted-routes.mjs`, checked against the Studio artifact.
Emitted files live under `/assets/`, and committed images and PDFs from the
host's `publicAssetsDir` are delivered under `/uploaded-assets/`. Upload
authoring remains dev-only. Keep Vite base `/` and the preview graph isolated
from a consuming host project and its file-provider plumbing.

The SiteProject operator/API guide is [`docs/site-project.md`](./docs/site-project.md).
It is the source for provider-scoped graph, whole-project apply, active
identity/CAS revisions, immutable builds, diagnostics, JSON-stdin examples,
disposable local state, and guarded browser acceptance commands.
Hosted persistence, a hosted API, and authentication are future adapter work;
nothing in this repository claims them.

## Clean-break authority

There are no users or persisted production data. Prefer one clear current
schema and destructively replace provisional application routes, storage/source
layouts, and file-provider formats when needed. Do not add migrations,
redirects, aliases, legacy fallbacks, compatibility shims, or fixtures for old
schemas.

The demo hosts' `site-project.ts` files are authored source. Their tracked
`site-project.json` and ready CMS records are generated material and current
reader compatibility fixtures; never edit them by hand. A storage format,
workspace layout, compiler, component pack, or authored source change must
regenerate **every host atomically in the same PR** with
`corepack pnpm cms:regenerate`, then pass `corepack pnpm cms:check` (also part
of `corepack pnpm check`). The command discovers hosts on disk, including new
demo hosts, and uses the installed `generate` and `seed --ready-workspace`
commands. A changed build identity requires regeneration, even when the
SiteProject JSON did not change; do not exempt a baseline or relax readers.

Run regeneration with authoring stopped and preserve local CMS edits first.
It replaces only known generated trees that match Git HEAD or the newly
produced bytes, and preserves Assets and unrelated host state. Commit the
generated ownership file `scripts/cms-fixtures.json` with all generated host
files. Old records need not pass new readers before explicit regeneration;
there are still no migrations for consumer repositories. See the
[clean-break procedure](docs/site-project.md#regenerating-committed-hosts).

This authority applies only to this project's current state. It does not permit
destructive changes to unrelated repositories, user files, hosting resources,
domains, credentials, or other infrastructure.

## Provider and contract handoffs

Keep these domains distinct:

- provider Git commit/tree:
  `6b0826cdaa14d9888e58c795ee015f70e2c5cbdf` /
  `1c3cbfd3a25d1425f447cdadd5ba538916394309`
- exact provider spec:
  `git+https://github.com/Takazudo/zudo-sg.git#6b0826cdaa14d9888e58c795ee015f70e2c5cbdf`
- installed provider metadata: `@zudo-sg/ui@0.1.0`
- component-pack protocol identity: `@zudo-sg/ui@1.0.0`
- component-contract API/package version:
  `@zudo-composer/component-contract@1.0.0`

Provider updates require a permanent full Git SHA, verified tree, regenerated
lockfile, clean frozen install, and full unit/artifact/browser gates.
Never resolve the provider through a branch/tag, sibling checkout,
`workspace:`, `file:`, `link:`, `path:`, copied source, or pnpm Git subdirectory
selector.

The component-contract handoff is separate. Its external package-only commit
and root Git spec live in `contract-handoff.json`; this monorepo intentionally
uses `workspace:*` for its own contract source. Do not substitute that workspace
relationship for the external UI-provider dependency.

## Commands and completion gates

- Install: `corepack pnpm install --frozen-lockfile`.
- Develop: `corepack pnpm dev`.
- Aggregate gate: `corepack pnpm check`, including the complete packed-install
  proof. It needs network access, Playwright Chromium and exclusive browser
  port 4175; run it with the other browser lanes stopped.
- Contract handoff: `corepack pnpm contract:conformance`, `corepack pnpm
  contract:negative-scan`, and `corepack pnpm contract:external-install --
  --exact`.
- Browser preparation: `corepack pnpm demo:build-sites` discovers and builds
  all host artifacts before the SiteProject and demos browser lanes; stale
  artifacts fail their read-only verification.
- Browser lanes: `corepack pnpm test:browser:host`, `corepack pnpm
  test:browser:dev`, `corepack pnpm test:browser:site-project`, and `corepack
  pnpm test:browser:demos` (port 4176, the three `packages/demo-*` hosts). Each
  owns one machine-global port, so none may run concurrently, and no lane may
  rebuild.
- Consumer boundary: the ledger must contain zero entries. Scan actual creator
  templates and complete generated output before packed dependency rewriting.
- Host install: `corepack pnpm smoke:host-install` packs the tool and contract,
  then proves all disk-discovered package hosts, freshly generated creator
  output and the synthesized fixture outside this repository. CI uses one
  matrix job per host. `corepack pnpm no-deploy:check` guards these validation
  commands, including aliases and local wrappers; Cloudflare dry-runs only.

Do not weaken frozen install, negative dependency scans, exact provider pin, or
the 12-component runtime/CSS/WASM proof to make a gate pass.

## Scoped hosted demo exception

The installed tool and ordinary local workflow remain local-first. Issue 414
adds one disposable static sample at `https://zudo-composer.zudolab.dev`; issue
504 extends the same trusted-run pipeline to three further static demo
websites built from committed SiteProject content: `zc-demo-shop.zudolab.dev`
(`packages/demo-webshop`), `zc-demo-landing.zudolab.dev`
(`packages/demo-landing`) and `zc-demo-blog.zudolab.dev` (`packages/demo-blog`).
None of this adds hosted persistence, a hosted API, authentication, arbitrary
host project access or deployment support for installed applications. Each
target is its own Worker with its own custom-domain binding, configured in
[`wrangler.jsonc`](./wrangler.jsonc) (`zudo-composer`),
[`wrangler.demo-shop.jsonc`](./wrangler.demo-shop.jsonc),
[`wrangler.demo-landing.jsonc`](./wrangler.demo-landing.jsonc) and
[`wrangler.demo-blog.jsonc`](./wrangler.demo-blog.jsonc).

The hosted composer demo's `dist-hosted-demo` artifact is built, checked
against the ordinary filesystem/server/test boundary, browser-tested, and
uploaded by CI under the exact source SHA; the three static demo sites are
each built and manifest-verified by CI with `pnpm demo:build-site <name>` into
`packages/demo-<name>/dist-site` and uploaded the same way. `scripts/hosted-demo/targets.mjs`
is the one place naming each target's Worker, config file, artifact directory,
domain and artifact contract; `deploy.mjs`, `live-check.mjs` and
`check-hosted-demo.mjs` are generic over that target, while
`workflow-guard.mjs`'s trusted-run checks needed no target parameter — they
never touch an artifact or a Cloudflare config. The independent production
workflow runs as a matrix of the four targets, each accepting only a
successful same-repository `main` CI run, verifying its own run/SHA/artifact,
performing a Wrangler dry run, capturing the active single-version deployment,
uploading the verified directory with Wrangler 4.130.0, and activating only
the version ID returned by that upload. It has no pull-request artifact path.
Pull-request validation has no Cloudflare secrets, and production uses only
the existing deployment secrets after its trusted-run gates, with a
concurrency group per target so one target's rollout never blocks another's.
Missing credentials, stale `main`, missing rollback state, split traffic or a
source mismatch fail before mutation, for every target. The one exception is a
target whose Worker does not exist yet: when both `deployments list` and
`versions list` report it missing, the first rollout is created with a plain
`wrangler deploy` — the only call that binds the config's custom domain — and
has no rollback target by definition. Any other missing-state combination still
fails closed.

Live checks cover the manifest, every emitted asset and every route with
bounded HTTPS requests — the hosted composer demo's fixed authoring/sample
route list for that target, and each static site's own manifest route list for
the other three. Automatic rollback is allowed only while the exact uploaded
version remains active, and a rollback that succeeds still leaves the
deployment workflow red. Local OAuth credentials are never copied to
repository or workflow secrets.

Do not claim a permanent target `main` SHA or a final CI URL before the Phase 3
root merges and post-merge evidence exists. The integration owner records that
canonical evidence on both Phase 3 and Phase 4 epics.

## Provenance

The application was ported from
`Takazudo/zudo-sg@f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2` without history
grafting. That reference is provenance, not continuing application ownership or
permission to reuse source-project infrastructure.
