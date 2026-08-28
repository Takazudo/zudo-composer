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
- Do not add deployment or production hostname configuration without explicit
  project-specific design and review.
