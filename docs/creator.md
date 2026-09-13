# Creating a host

The creator is `zudo-composer init`, shipped in the tool package. This keeps the
creator, canonical writers, templates and target tool version in one release;
there is no separately versioned `create-zudo-composer` package.
The bootstrap pnpm version is retained as `engines.pnpm`: packing strips the
tool's top-level `packageManager`, so source checks require both pins to agree.

```sh
zudo-composer init my-site
cd my-site
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Use `--name @your-team/site` when the directory basename is not the desired
lowercase npm package name. The destination must not exist, even as an empty
directory. Its parent must already exist. The command preserves an existing
destination and does not initialize Git, upgrade a project or migrate data.

## First activation and retained files

Creation runs the canonical producer sequence in a fresh temporary project:

1. Copy the installed base tree, located relative to `import.meta.url`.
2. Generate `package.json`, `zudo-composer.config.ts`, `tsconfig.json`,
   `vitest.config.ts`, `.gitignore` and package-manager settings from code.
3. Install matching dependencies with the tool's declared pnpm version.
4. Run that project's installed `generate`, `assets import
   images-src/manifest.json` and `seed --ready-workspace` commands.
5. Copy the canonical immutable asset bytes to the default public delivery
   directory and publish the complete host to the new destination.

This chooses creation-time canonical production over a committed CMS template.
CMS data always comes from current writers; every new host has a selected,
completed workspace without a prerequisite manual seed. A release is used only
inside the ready producer's disposable storage. Creation retains no
`.zudo-site-project` activation. Later, `pnpm seed` explicitly activates the
committed aggregate; it is separate from opening the populated editor.

The starter contains three Preact components, a global frame and home page,
a content model and entry, a mapping, a sitemap, and one imported PNG. The base
files are copied verbatim, including the host's own test source. The pack reads
the host package name for its `./components` self-reference. No provider
components or tool internals are copied into the host.

Commit every retained file together. The exact starter inventory in
[`scripts/creator-required-files.json`](../scripts/creator-required-files.json)
applies the [#545 fresh-clone contract](https://github.com/Takazudo/zudo-composer/issues/545)
to the starter's records:

| Contract category | Starter files |
| --- | --- |
| Ready runtime | Owned pack/styles/config; canonical Compositions, Content, Mapping and Sitemapper records; current pointers and completed workspace registry; Assets catalog/version and public image bytes |
| Authoring, regeneration and build | `site-project.ts`, canonical `site-project.json`, image manifest and source PNG |
| Tests, types, docs and hygiene | Own Preact/Vitest tests, TypeScript and Vitest configs, README, scratch-only `.gitignore`, `.npmrc` and `pnpm-workspace.yaml` |

A normal published creation also retains the registry lockfile. Installs, build
artifacts, release activation state and test output are on-demand scratch state.
After a clone-equivalent copy and install, `pnpm dev` opens the populated studio
without modifying or rebuilding the committed initial CMS.

Preact is a direct peer-satisfying dependency, and the tool deduplicates it.
Tailwind remains tool-supplied: the host owns only its CSS entry and `@source`.
The starter uses its own pack; adding `@zudo-sg/ui` still requires the exact
provider Git pin documented in `CLAUDE.md`. The generated package-manager files
retain `blockExoticSubdeps: false` while that provider uses Git. They do not
introduce a provider version or weaken the provider identity checks.

## Preview before publication

The current `zudo-composer@0.0.0` is unpublished. Plain registry installation of
that version is not a working bootstrap. Supply both tarballs from the same
build to an installed creator:

```sh
zudo-composer init my-site \
  --tool-tarball /absolute/path/zudo-composer-0.0.0.tgz \
  --contract-tarball /absolute/path/zudo-composer-component-contract-1.0.0.tgz
```

The creator reads the archived package metadata, checks package names and
versions, and copies the archives into its temporary install area. Temporary
pnpm overrides resolve both the tool and contract there. Before invoking any
producer it verifies the installed package metadata and rejects dependencies
whose real paths escape that isolated install. It never uses the caller's root
`node_modules` or workspace dependency protocols. `tar` and Corepack must be
available for this workflow.

The retained manifest still names matching versions. The temporary overrides,
archive copies, preview lockfile and `node_modules` are omitted. The preview is
portable source and ready CMS, not a claim that unpublished versions can be
installed from the registry. Until publication, a subsequent independent
installation must supply the same packed resolution again. The packed-host
lane owns that installation; its local paths belong only to its disposable
copy. No tool Git spec or machine-local dependency path is committed.

When tool and contract versions are published, the same CLI can use the normal
registry path and preserve the portable registry lockfile. There is no
first-activation migration or separate creator release to coordinate.

## Checks

`corepack pnpm consumer:boundary` also scans a verbatim template copy with its
code-generated configuration and checks every emitted dependency version. It
does not install dependencies or start a browser. Check a real generated tree:

```sh
node scripts/check-creator.mjs --host /absolute/path/my-site
```

That checks parity, the strict consumer boundary, and every required retained
file. Negative tests mutate tool, contract, Preact and development dependency
versions, introduce a source reach-back, and exercise archive mismatch and
install escape/failure. A bounded source test drives the canonical writers and
reopens the resulting registry, then compares the exact retained inventory.
The packed lane separately proves the installed CLI, clone-equivalent install,
host tests/types/build and no-seed browser behavior outside the repository.
