# Dogfood host fixture

The smallest project that installs zudo-composer and runs it the way a host
does: the package is resolved through `node_modules` (a workspace link), Vite is
rooted here, and authored CMS data is written beneath this directory rather than
beneath the repository root.

```sh
corepack pnpm --filter @zudo-composer/fixture-host dev
```

`cms/` and `public/` are the default data locations from
`zudo-composer.config.ts`. They are kept in git with `.gitkeep` files so a fresh
clone can boot the fixture without creating them first; anything authored into
them is local scratch and is not committed.
