# Sample Styleguide

A standalone `@takazudo/zudo-sg` host for the installed `@zudo-composer/ui`
component pack. This directory owns its workspace, lockfile, and dependencies;
it is deliberately outside the repository's root pnpm workspace.

## Commands

Use Node 24 and the package's pinned pnpm version. From the repository root:

```sh
corepack pnpm -C styleguide/sample install --frozen-lockfile
corepack pnpm -C styleguide/sample check
corepack pnpm -C styleguide/sample build
corepack pnpm -C styleguide/sample dev
```

Development uses port **4397** with base `/`. The build writes `dist/`, including
the home page, 404 page, `/components`, component detail and preview pages,
`/tokens`, and the overview document. Serve `dist/` with a static HTTP server to
inspect the production build.

On a cold dev start, wait for `GET /__zfb/ready` to report `ready: true` before
checking interactive previews, and confirm `X-Zfb-Dev-Ready: true` on the
document response. The CLI's listening message and an available island bundle
can both precede a ready document generation (see the upstream notes).

`check`, `build`, and `dev` each run `gen` first. Generation bootstraps the empty
registry seed if needed, discovers the stories, and reads design tokens from
the installed pack. The generated registry and token manifest are ignored;
only `src/styleguide/sg-registry.seed.ts` is committed.

Stories live under `stories/<group>/<component>/`. Import components from
`@zudo-composer/ui` and the sidecar's display metadata and defaults through its
`@zudo-composer/ui/src/*` export. Export `Defaults` first, then one named story
for every enum value in the sidecar fields. Titles and descriptions come from
the sidecar; categories use the capitalised pack folder: `Shared`, `Cards`,
`Content`, or `Media`. Previews compile the installed Composer CSS and
scan both the stories and the installed pack's source for Tailwind classes.

## Updating the component pack

The `@zudo-composer/ui` and `@zudo-composer/component-contract` dependencies use
the exact root Git specs from the repository's `ui-handoff.json` and
`contract-handoff.json`. When either handoff changes, update the corresponding
dependency here to that file's `rootGitSpec`, run a local install to refresh
this directory's lockfile, then repeat a clean frozen install, check, build,
and browser checks of both build and dev. Do not use a branch name, workspace
link, copied source, or a local path as a substitute for the Git pin.

Dependency resolution must stay inside `styleguide/sample/node_modules`. Do
not add this host or any engine dependency to the root workspace or lockfile.
Any release-age exception belongs in this host's `pnpm-workspace.yaml` and must
name an exact version.

Integration friction and local workarounds are recorded in
[UPSTREAM-NOTES.md](./UPSTREAM-NOTES.md).
