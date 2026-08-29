# Repository guidance

## Permanent ownership

This repository is the standalone owner of Composer model/source/reuse/storage,
chrome, preview rendering, and iframe protocol; Content model/storage/library/UI;
Mapping model/storage/resolver/UI; and Sitemapper model/storage/library, UI, and
Composer-catalog integration.

zudo-sg owns only the installed `@zudo-sg/ui` provider: typed component
sidecars, runtime pack, and canonical Composer CSS. Its transitive focused
`@takazudo/zfb-md-wasm` dependency is allowed for `ProseMd`; no zudo-doc, zfb
application runtime/config, virtual-zfb, or styleguide registry may enter this
application. Never copy provider components or add a fallback registry.

Exact routes are `/`, `/composer`, same-origin `/composer/preview`, `/content`,
`/mapping`, and `/sitemapper`; emitted files live under `/assets/`. Keep Vite base `/` and the
preview graph isolated from the host application and filesystem provider.

## Clean-break authority

There are no users or persisted production data. Prefer one clear current
schema and destructively replace provisional application routes, storage/source
layouts, and file-provider formats when needed. Do not add migrations,
redirects, aliases, legacy fallbacks, compatibility shims, or compatibility
fixtures.

This authority applies only to this project's current state. It does not permit
destructive changes to unrelated repositories, user files, Cloudflare Workers,
domains, credentials, or other infrastructure.

## Provider and contract handoffs

Keep these domains distinct:

- provider Git commit/tree:
  `fe3fc62d3f677f321f5eb7814240d4a55dc92cd0` /
  `96a42a59cf4d05078ba85e7a0ccdb7d7765d29cc`
- exact provider spec:
  `git+https://github.com/Takazudo/zudo-sg.git#fe3fc62d3f677f321f5eb7814240d4a55dc92cd0`
- installed provider metadata: `@zudo-sg/ui@0.1.0`
- component-pack protocol identity: `@zudo-sg/ui@1.0.0`
- component-contract API/package version:
  `@zudo-composer/component-contract@1.0.0`

Provider updates require a permanent full Git SHA, verified tree, regenerated
lockfile, clean frozen install, and full unit/artifact/browser/deployment gates.
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
- Main bounded gate: `corepack pnpm check`.
- Contract handoff: `corepack pnpm contract:conformance`, `corepack pnpm
  contract:negative-scan`, and `corepack pnpm contract:external-install --
  --exact`.
- Built artifact: `corepack pnpm deployment:manifest`, `corepack pnpm
  deployment:manifest:check`, `corepack pnpm smoke:local`, and `corepack pnpm
  test:browser:dist` after the one production build.

Do not weaken frozen install, negative dependency scans, exact provider pin,
12-component runtime/CSS/WASM proof, Wrangler dry-run, or six-route/all-asset
smoke to make a gate pass.

## Deployment and credentials

The only deployment target is Worker `zudo-composer` at Custom Domain
`zudo-composer.takazudomodular.com`; `workers.dev` and preview URLs remain
disabled. Never reuse a zudo-sg Worker, domain, account assumption, OAuth file,
token, or GitHub secret.

Unauthenticated proof uses `corepack pnpm deploy:dry-run` and `corepack pnpm
smoke:local`. Local deployment requires `wrangler login`, `wrangler whoami`,
manifest recheck, `pnpm deploy`, and `pnpm smoke:live`. CI deployment requires
both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; partial credentials are
an error and absent credentials produce a credential-only handoff without
skipping noncredential validation.

Do not claim a permanent target `main` SHA, final CI URL, deployment success, or
live smoke before the Phase 3 root merges and post-merge evidence exists. The
integration owner records that canonical evidence on both Phase 3 and Phase 4
epics.

## Provenance

The application was ported from
`Takazudo/zudo-sg@f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2` without history
grafting. That reference is provenance, not continuing application ownership or
permission to reuse source-project infrastructure.
