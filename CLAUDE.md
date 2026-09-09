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

Exact routes are `/`, `/composer`, same-origin `/composer/preview`, `/content`,
`/mapping`, `/sitemapper`, `/assets`, and the sample SiteProject delivery routes
`/site`, `/site/about`, `/site/services`, `/site/journal`,
`/site/journal/map-the-moving-parts`, `/site/journal/review-in-small-loops`,
and `/site/journal/start-with-the-question`; emitted files live under
`/assets/`, while committed images and PDFs from this repository's own
`publicAssetsDir` are delivered under `/uploaded-assets/`. Upload authoring
remains dev-only. Keep Vite base `/` and the preview graph isolated from a
consuming host project and its file-provider plumbing.

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
- Browser lanes: `corepack pnpm test:browser:host`, `corepack pnpm
  test:browser:dev`, and `corepack pnpm test:browser:site-project`. Each owns one
  machine-global port, so none may run concurrently, and no lane may rebuild.
- Host install: `corepack pnpm smoke:host-install`, the only proof that packs the
  package and installs it into a project outside this repository.

Do not weaken frozen install, negative dependency scans, exact provider pin, or
the 12-component runtime/CSS/WASM proof to make a gate pass.

## Scoped hosted demo exception

The installed tool and ordinary local workflow remain local-first. Issue 414
adds one disposable static sample at `https://zudo-composer.zudolab.dev`; it
does not add hosted persistence, a hosted API, authentication, arbitrary host
project access or deployment support for installed applications. The
`zudo-composer` Worker and its existing custom-domain binding are configured in
[`wrangler.jsonc`](./wrangler.jsonc).

The dedicated `dist-hosted-demo` artifact is built, checked against the ordinary
filesystem/server/test boundary, browser-tested, and uploaded by CI under the
exact source SHA. The independent production workflow accepts only a successful
same-repository `main` CI run, verifies its run/SHA/artifact, performs a
Wrangler dry run, captures the active single-version deployment, uploads the
verified directory with Wrangler 4.130.0, and activates only the version ID
returned by that upload. It has no pull-request artifact path. Pull-request
validation has no Cloudflare secrets, and production uses only the existing
deployment secrets after its trusted-run gates. Missing credentials, stale
`main`, missing rollback state, split
traffic or a source mismatch fail before mutation.

Live checks cover the manifest, every emitted asset and all authoring/sample
routes with bounded HTTPS requests. Automatic rollback is allowed only while
the exact uploaded version remains active, and a rollback that succeeds still
leaves the deployment workflow red. Local OAuth credentials are never copied to
repository or workflow secrets.

Do not claim a permanent target `main` SHA or a final CI URL before the Phase 3
root merges and post-merge evidence exists. The integration owner records that
canonical evidence on both Phase 3 and Phase 4 epics.

## Provenance

The application was ported from
`Takazudo/zudo-sg@f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2` without history
grafting. That reference is provenance, not continuing application ownership or
permission to reuse source-project infrastructure.
