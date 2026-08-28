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

The external-install check writes a fresh temporary consumer, resolves the
contract from the full Git commit SHA and `packages/component-contract`
subdirectory, runs a frozen install, and imports both public entrypoints. If a
local commit has not been pushed to this repository yet, it reports that fact
and runs an explicit packed-artifact proof instead; it never presents an
unreachable local SHA as an external install result. Pass `-- --exact` when a
local run must require the remote Git proof, or `-- --local` to force only the
packed-artifact proof.

Pull request CI selects the pushed PR head SHA. Main CI selects
`github.sha`, so the final handoff is complete only after the manager records
the permanent post-merge main SHA and the green CI run URL on the epic.

Deployment and production hostname configuration are intentionally outside the
scope of this foundation.
