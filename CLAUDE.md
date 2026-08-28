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
- Keep `contract-handoff.json` authoritative: it maps the source path to the
  permanent package-only branch, full commit, and exact root Git spec. Do not
  replace it with a Git `path:` selector.
- Pull request and main CI verify the advertised package branch and root tree.
  The manager must record the permanent package commit, main SHA, and green CI
  URL on the epic before closing the handoff.
- Do not add deployment or production hostname configuration without explicit
  project-specific design and review.
