# zudo-composer

`zudo-composer` is the permanent standalone home of five Preact authoring
products:

- Composer owns its document model, source generation, reuse rules, storage,
  chrome, preview renderer, and same-origin iframe protocol.
- Content owns its model, Entry library, browser storage, and authoring UI.
- Mapping owns its binding model, resolver, browser storage, preview handoff,
  and authoring UI.
- Sitemapper owns its page-tree model, storage, library, authoring UI, and the
  catalog integration that resolves saved Composer records.
- Media owns its metadata model, library route, and upload/delivery boundaries.

The products do not depend on zudo-doc, a zfb application runtime/configuration,
or a styleguide registry. `zudo-sg` has a narrower permanent role: its installed
`@zudo-sg/ui` package supplies typed component sidecars, the runtime component
pack, and canonical Composer CSS. That provider transitively owns the focused
`@takazudo/zfb-md-wasm` renderer used by `ProseMd`; this is not a zfb application
dependency.

## Routes and assets

The Vite application has base `/` and these exact SPA routes:

- `/` — standalone product landing page
- `/composer` — Composer library and editor
- `/composer/preview` — isolated same-origin Composer preview document
- `/content` — Content model and Entry authoring
- `/mapping` — Content-to-Composition Mapping authoring
- `/sitemapper` — Sitemapper library and editor
- `/media` — Media library and upload/delivery status
- `/site` — bundled/published sample home
- `/site/about`, `/site/services`, `/site/journal` — canonical nested sample pages
- `/site/journal/map-the-moving-parts`, `/site/journal/review-in-small-loops`,
  `/site/journal/start-with-the-question` — compiler-emitted Entry routes
- `/assets/` — emitted JavaScript, CSS, and the single focused render WASM/glue
- `/uploaded-media/` — committed images and PDFs copied from `media-store/public`

The preview route is an implementation boundary, not an independent public
product. Cloudflare serves route fallbacks from the same immutable `dist` tree;
build-emitted assets remain rooted at `/assets/`, while committed media is
delivered from `/uploaded-media/`. Upload authoring is available only in local
development, but committed media delivery is part of the production artifact.

The provider-scoped SiteProject graph, whole-project apply rule, active identity,
JSON-stdin API, CAS revisions, immutable builds, diagnostics, local editing
flow, and guarded browser acceptance commands are documented in
[`docs/site-project.md`](./docs/site-project.md). Production
uses the bundled sample; local project state is disposable and ignored.
Cloudflare persistence, hosted API, and authentication are future adapter work;
the assets-only Worker makes no such claim.

## Development and validation

Use Node.js 22.13.0+ or 24.0.0+ and pnpm 11.5.2 through Corepack:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

The main repository gate includes lint, typecheck, headless/deployment/handoff
boundaries, unit tests, one production build, the provider artifact boundary,
and an unauthenticated Wrangler dry-run:

```sh
corepack pnpm check
```

CI additionally verifies the component-contract handoff, writes and rechecks
the deployment manifest, runs local Worker smoke, and serves that same built
`dist` directory to Chromium:

```sh
corepack pnpm contract:conformance
corepack pnpm contract:negative-scan
corepack pnpm contract:external-install -- --exact
corepack pnpm deployment:manifest
corepack pnpm deployment:manifest:check
corepack pnpm smoke:local
corepack pnpm test:browser:dist
corepack pnpm test:browser:dev
corepack pnpm test:browser:site-project
corepack pnpm test:browser:site-project:dist
```

`test:browser` is the convenience command when no build exists; it builds and
then delegates to `test:browser:dist`. The Media dev lane exercises upload
transport without changing the production artifact. The SiteProject helper adds
an isolated CLI-activated dev lane and a local-Wrangler production lane that
reuses the one build. CI deliberately builds exactly once.

## Immutable UI-provider handoff

The current UI provider identity has four distinct version/provenance domains:

| Domain | Current value |
|---|---|
| Provider Git spec | `git+https://github.com/Takazudo/zudo-sg.git#6b0826cdaa14d9888e58c795ee015f70e2c5cbdf` |
| Provider commit / root tree | `6b0826cdaa14d9888e58c795ee015f70e2c5cbdf` / `1c3cbfd3a25d1425f447cdadd5ba538916394309` |
| Installed package metadata | `@zudo-sg/ui@0.1.0` |
| Component-pack protocol identity | `@zudo-sg/ui@1.0.0` |

The package version and pack protocol version are intentionally different.
Neither is a substitute for the immutable Git commit/tree.

To update the provider:

1. Obtain the permanent package-only zudo-sg commit and independently verify
   its root tree and advertised 12-component pack.
2. Set `dependencies["@zudo-sg/ui"]` to the exact full Git SHA. Never use a
   branch name, moving tag, sibling checkout, `workspace:`, `file:`, `link:`,
   `path:`, copied provider source, or a pnpm Git subdirectory selector.
3. Regenerate `pnpm-lock.yaml`, then prove a clean
   `corepack pnpm install --frozen-lockfile` resolves the same codeload SHA.
4. Run `corepack pnpm check`, all three contract commands above,
   `corepack pnpm deployment:manifest`, `corepack pnpm smoke:local`, and
   `corepack pnpm test:browser:dist`. The provider boundary must still prove
   the exact 12 IDs/runtime exports, canonical CSS, and one focused WASM/glue.

Do not copy provider components into this repository or add a fallback registry.

## Component-contract handoff

The component contract is a separate handoff from the UI provider. This
repository owns its source at `packages/component-contract`; external package
consumers use the package-only commit recorded by
[`contract-handoff.json`](./contract-handoff.json):

- API/package version: `@zudo-composer/component-contract@1.0.0`
- package commit: `9b774b827e9f6fec14379995ac2c691ccc3b7e5b`
- exact external Git spec:
  `git+https://github.com/Takazudo/zudo-composer.git#9b774b827e9f6fec14379995ac2c691ccc3b7e5b`

The monorepo itself intentionally resolves this contract with `workspace:*`.
That local workspace relationship must not be confused with, or used in place
of, the immutable external UI-provider Git dependency.

## Deployment and credential handoff

The configured target is Worker `zudo-composer` with the Custom Domain
`zudo-composer.zudolab.dev` (`custom_domain: true`). `workers.dev` and
preview URLs are disabled. This identity, domain, and its credentials are
project-specific and must never be copied from or shared with zudo-sg.

Build and prove the exact artifact without deployment credentials:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm provider:boundary
corepack pnpm deployment:manifest
corepack pnpm deploy:dry-run
corepack pnpm smoke:local
corepack pnpm test:browser:dist
corepack pnpm deployment:manifest:check
```

For a local authenticated deployment, the integration owner runs:

```sh
corepack pnpm exec wrangler login
corepack pnpm exec wrangler whoami
corepack pnpm deployment:manifest:check
corepack pnpm deploy
corepack pnpm smoke:live
```

The local flow uses Wrangler OAuth. Never copy OAuth files/tokens into GitHub.
Automated deployment instead requires both `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets. The token must come from
Cloudflare's **Edit Cloudflare Workers** template and be least-privilege scoped
to the intended account and active `zudolab.dev` zone. One secret
without the other is a hard configuration error; when both are absent, CI
prints the exact credential-only handoff and leaves all noncredential gates
enabled.

The hostname above is the configured target, not a claim that this branch is
deployed. Permanent `main` SHA, root-PR CI, post-merge CI, deployment success,
and live all-route/all-asset smoke evidence are recorded only after merge.

## Destructive current-only policy

There are no users and no persisted production data. Provisional routes,
schemas, storage identities, source layouts, and file-provider layouts may be
destructively replaced with the clearest current contract. Do not add
migrations, redirects, aliases, legacy fallbacks, compatibility shims, or
compatibility fixtures.

This authorization is limited to this project's current application state. It
does not authorize deleting or replacing unrelated repositories, Cloudflare
resources, domains, credentials, user files, or other infrastructure.

## Provenance and final evidence

The initial implementation was ported with provenance from
`Takazudo/zudo-sg@f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2`, without grafting
history or inheriting zudo-sg deployment identity. That frozen source reference
is provenance only; zudo-sg no longer owns these applications.

After the Phase 3 root reaches `main`, the integration owner records one
canonical evidence block on both Phase 3 and Phase 4 epics: root PR URL; full
permanent `main` SHA; provider Git spec/SHA/tree and all version domains; green
root-PR and post-merge CI URLs; and either the deployed URL with successful
all-route/all-asset smoke or the exact credential-only handoff.
