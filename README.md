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

Deployment and production hostname configuration are intentionally outside the
scope of this foundation.
