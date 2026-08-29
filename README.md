# zudo-composer

`zudo-composer` is a standalone component-composition workspace built with
Preact, Vite, TypeScript, and pnpm. It is independent of zudo-doc and does not
share deployment infrastructure with other zudo projects.

## Provenance

This repository was initialized from design and implementation knowledge in
`Takazudo/zudo-sg@f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2`. It intentionally
does not inherit that repository's deployment workflows, Worker identities,
domains, or package publishing identity.

## Development

Use Node.js 22.13.0+ or 24.0.0+ and enable Corepack, then run:

```sh
corepack pnpm install
corepack pnpm dev
```

The bounded validation commands used by CI are:

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

The package handoff checks are also available locally:

```sh
corepack pnpm contract:conformance
corepack pnpm contract:negative-scan
corepack pnpm contract:external-install
```

The external-install check reads [`contract-handoff.json`](./contract-handoff.json),
verifies that the advertised package branch points to its full commit and that
its root Git tree equals `HEAD:packages/component-contract`, then writes a fresh
temporary consumer using the exact root Git spec, generates its lockfile, runs a
frozen install, and imports both public entrypoints. The handoff intentionally
does not use pnpm's Git `path:` selector: pnpm can install the repository root
even when that selector names a subdirectory.

If a local run cannot reach the advertised package branch, it reports that fact
and runs an explicit packed-artifact proof instead; it never presents an
unreachable local SHA as an external install result. Pass `-- --exact` when a
local run must require the remote Git proof, or `-- --local` to force only the
packed-artifact proof.

Pull request and main CI both verify the permanent package branch mapping. The
final handoff is complete only after the manager records the package commit,
permanent main SHA, and green CI run URL on the epic.

## Deployment

The standalone static application deploys as the `zudo-composer` Worker at
`https://zudo-composer.takazudomodular.com`. Wrangler serves the committed Vite
route set as an SPA from `dist`; it does not enable a workers.dev hostname or
preview URLs.

Build and validate the exact artifact locally with:

```sh
corepack pnpm build
corepack pnpm provider:boundary
corepack pnpm deployment:manifest
corepack pnpm deploy:dry-run
corepack pnpm smoke:local
corepack pnpm test:browser:dist
```

CI builds once, records SHA-256 and MIME metadata for every emitted file, and
uses that same `dist` tree for the Wrangler dry-run, local deployment smoke,
browser suite, and deployment artifact. On `main`, both
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` enable deployment followed by
live smoke. If both are absent, CI emits a credential-only handoff; providing
only one is a hard configuration error. Never place credential values in this
repository.
