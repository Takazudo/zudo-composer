# Repository guidance

## Project status

This is a new standalone repository. There are no users or user data, and
backward compatibility is not required. Prefer a clear contract over preserving
provisional APIs or file layouts.

`zudo-composer` is independent of zudo-doc. Its provenance is
`Takazudo/zudo-sg@f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2`, but source-project
deployment workflows, Worker names, routes, domains, credentials, and package
publishing identities must not be copied or reused.

## Commands

- Install dependencies with `corepack pnpm install`.
- Run bounded checks with `corepack pnpm check`.
- Validate the standalone contract handoff with `corepack pnpm
  contract:conformance`, `corepack pnpm contract:negative-scan`, and `corepack
  pnpm contract:external-install`.
- Pull request CI verifies the pushed head SHA; post-merge main CI verifies the
  permanent consumer-reachable SHA. The manager must record that SHA and the
  green CI URL on the epic before closing the handoff.
- Do not add deployment or production hostname configuration without explicit
  project-specific design and review.
