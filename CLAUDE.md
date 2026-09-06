# Repository guidance

## Permanent ownership

This repository is the standalone owner of Composer model/source/reuse/storage,
chrome, preview rendering, and iframe protocol; Content model/storage/library/UI;
Mapping model/storage/resolver/UI; and Sitemapper model/storage/library, UI, and
Composer-catalog integration; and Media metadata, library, and upload/delivery
boundaries.

zudo-sg owns only the installed `@zudo-sg/ui` provider: typed component
sidecars, runtime pack, and canonical Composer CSS. Its transitive focused
`@takazudo/zfb-md-wasm` dependency is allowed for `ProseMd`; no zudo-doc, zfb
application runtime/config, virtual-zfb, or styleguide registry may enter this
application. Never copy provider components or add a fallback registry.

Exact routes are `/`, `/composer`, same-origin `/composer/preview`, `/content`,
`/mapping`, `/sitemapper`, `/media`, and the bundled SiteProject delivery routes `/site`,
`/site/about`, `/site/services`, `/site/journal`,
`/site/journal/map-the-moving-parts`, `/site/journal/review-in-small-loops`,
and `/site/journal/start-with-the-question`; emitted files live under
`/assets/`, while committed images and PDFs from `media-store/public` are
delivered under `/uploaded-media/`. Upload authoring remains dev-only. Keep Vite
base `/` and the preview graph isolated from the host application and filesystem
provider.

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
redirects, aliases, legacy fallbacks, compatibility shims, or compatibility
fixtures.

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
- Main bounded gate: `corepack pnpm check`.
- Contract handoff: `corepack pnpm contract:conformance`, `corepack pnpm
  contract:negative-scan`, and `corepack pnpm contract:external-install --
  --exact`.
- Built artifact: `corepack pnpm test:browser:dist`, `corepack pnpm
  test:browser:dev`, and `corepack pnpm test:browser:site-project` after the one
  production build. No browser lane may rebuild `dist`.

Do not weaken frozen install, negative dependency scans, exact provider pin, or
the 12-component runtime/CSS/WASM proof to make a gate pass.

## No deployment target

This project is a locally run tool. It has no deployment target, no hosting
provider, no deployed hostname, and no deployment credentials. Hosting is
deliberately deferred to a future adapter: do not add a deploy script, a hosting
config file, a credential check, or a live smoke lane. If hosting is ever added,
it arrives as a new adapter with its own gates.

Do not claim a permanent target `main` SHA or a final CI URL before the Phase 3
root merges and post-merge evidence exists. The integration owner records that
canonical evidence on both Phase 3 and Phase 4 epics.

## Provenance

The application was ported from
`Takazudo/zudo-sg@f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2` without history
grafting. That reference is provenance, not continuing application ownership or
permission to reuse source-project infrastructure.
