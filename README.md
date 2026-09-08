# zudo-composer

`zudo-composer` is an installable Preact authoring **tool**, not an application
with its own content. A host project installs it, points it at its own
components and a `zudo-composer.config.ts`, and gets five authoring products
over a shared filesystem storage engine:

- Composer owns its document model, source generation, reuse rules, chrome,
  preview renderer, and same-origin iframe protocol.
- Content owns its model, Entry library, and authoring UI.
- Mapping owns its binding model, resolver, preview handoff, and authoring UI.
- Sitemapper owns its page-tree model, library, authoring UI, and the catalog
  integration that resolves saved Composer records.
- Media owns its metadata model, library route, and upload/delivery boundaries.

All five persist to the host's own project files — the four JSON domains plus
media, under paths the host's `zudo-composer.config.ts` controls (see
[Settings and host directory layout](#settings-and-host-directory-layout)
below). The tool does not depend on zudo-doc, a zfb
application runtime/configuration, or a styleguide registry. `zudo-sg` has a
narrower permanent role in this repository: its installed `@zudo-sg/ui`
package is this repo's own dogfood component pack, supplying typed component
sidecars, the runtime component pack, and canonical Composer CSS. That
provider transitively owns the focused `@takazudo/zfb-md-wasm` renderer used
by `ProseMd`; this is not a zfb application dependency. A host is free to
install a different themeset instead — see
[Component packs and themesets](#component-packs-and-themesets).

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
- `/uploaded-media/` — committed images and PDFs from the host's `publicMediaDir`

The preview route is an implementation boundary, not an independent public
product. Build-emitted assets remain rooted at `/assets/`, while committed media
is delivered from `/uploaded-media/`. Upload authoring is available only in local
development.

The provider-scoped SiteProject graph, whole-project apply rule, active identity,
JSON-stdin API, CAS revisions, immutable builds, diagnostics, local editing
flow, and guarded browser acceptance commands are documented in
[`docs/site-project.md`](./docs/site-project.md). Production
uses the bundled sample; local project state is disposable and ignored.
Hosted persistence, a hosted API, and authentication are future adapter work;
nothing in this repository claims them.

## Demo media in this repository

This repository is its own dogfood host and includes four demo images in the
tracked `cms/media/` store. Ordinary Media edits under `pnpm dev` will dirty
`cms/media/catalog.json`; this is intended. Other runtime `cms/` directories
are ignored. Run `pnpm media:seed-demo` to seed missing demos from the committed
source PNGs in `scripts/demo-media/`; rerunning skips matching filenames and
checksums, including trashed assets and historical versions, and preserves
existing records. The demo store is not included in the installed package or
published by a static build.

From a fresh checkout, run `corepack pnpm install --frozen-lockfile`, then
`pnpm dev` and open the local URL it prints. On **Open workspace**, click
**Create project**, enter a **Project name**, and click **Create project** in
the dialog. Open **Media** in the navigation (`/media`), select **Grid** if
needed, click a demo thumbnail to inspect it, then click **Preview**.

## Installing into a host project

`zudo-composer` is installed by the project it authors. There is no registry
release; hosts resolve it from an exact Git commit, alongside the component
contract, which the package declares as a **peer dependency** so the host's own
`defineComponent` sidecars type against a single instance:

```sh
pnpm add -D \
  "zudo-composer@git+https://github.com/Takazudo/zudo-composer.git#<commit>" \
  "@zudo-composer/component-contract@git+https://github.com/Takazudo/zudo-composer.git#b66d52bb273a10010485efb2d06f80cee8001bd6"
```

The host also declares the package its `pack` comes from. A pack is resolved
from the HOST root, and a release attests the dependency spec the host used, so
a host that names `@acme/themeset/composer-pack` depends on `@acme/themeset`
itself; only the self-reference shape below is exempt.

The host then declares `zudo-composer.config.ts` at its own root and runs the
bin. `pack` is the only setting without a default:

```ts
import { defineComposerConfig } from "zudo-composer/config";

export default defineComposerConfig({
  pack: "@zudo-sg/ui/composer-pack",
});
```

```jsonc
// package.json
{ "scripts": { "dev": "zudo-composer dev" } }
```

### Settings and host directory layout

Every setting except `pack` has a default and is resolved host-root-relative;
`dataDir` re-bases the five settings below it, so moving all CMS data is one
edit. `publicMediaDir` and `styles` are not CMS data and are never re-based.

| Setting | Default | What it is |
| --- | --- | --- |
| `dataDir` | `cms` | Root for the four JSON domains plus media |
| `compositionsDir` | `cms/compositions` | Composition JSON, including global templates |
| `contentDir` | `cms/content` | Content-domain JSON |
| `mappingsDir` | `cms/mappings` | Mapping-domain JSON |
| `sitemapsDir` | `cms/sitemaps` | Sitemapper-domain JSON |
| `mediaDir` | `cms/media` | Media content-addressed store |
| `publicMediaDir` | `public/uploaded-media` | Published media bytes the host commits and serves |
| `styles` | `styles/base.css` | The host's base CSS entry — see [Styles ownership](#styles-ownership) |
| `pack` | *(required, no default)* | Component-pack module specifier — see below |

A minimal host that keeps every default and supplies its components as a
self-reference looks like this:

```text
my-site/
├── package.json                 # name: "my-site", exports: { "./components": … }
├── pnpm-workspace.yaml           # explicit Git-source and build permissions
├── zudo-composer.config.ts       # pack: "my-site/components"
├── components/
│   └── pack.ts                   # the component pack `exports` resolves to
├── styles/
│   └── base.css                  # imported pack CSS + Tailwind @source
├── public/
│   └── uploaded-media/           # publicMediaDir — committed, served bytes
└── cms/                          # dataDir — everything the tool authors
    ├── compositions/
    ├── content/
    ├── mappings/
    ├── sitemaps/
    └── media/
```

Every setting can also be overridden per-environment as
`ZUDO_COMPOSER_<SETTING_NAME>` (for example `ZUDO_COMPOSER_DATA_DIR`), with
precedence explicit config > environment > default.

### Component packs and themesets

A component pack is always addressed as a **package**, never as a path — the
contract's `parseSource` admits only public bare-package imports and rejects any
`src` path segment. Two shapes follow from that, and both are proven by fixtures
in this repository:

| Shape | `pack` | Every `source.module` | Fixture |
| --- | --- | --- | --- |
| Installed themeset | `"@acme/themeset/composer-pack"` | `"@acme/themeset"` | `fixtures/themeset-host` |
| Host self-reference | `"my-site/components"` | `"my-site/components"` | `fixtures/self-host` |

The self-reference needs nothing installed: the host's `package.json` declares
its own `name` plus `"exports": { "./components": "./components/pack.ts" }`, and
both Node and Vite resolve a package's reference to itself whenever `exports` is
present. Its name must be a valid lowercase npm name, and no exported subpath
segment may be `src`.

Either shape's entry module must export `componentPack` built with
`defineComponentPack`/`defineComponent` from `@zudo-composer/component-contract`
— a plain object is rejected. A minimal self-reference pack:

```tsx
// components/pack.ts, exported as "./components" in package.json
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { Banner, type BannerProps } from "./banner";

const banner = defineComponent<BannerProps>()(Banner, {
  id: "site.banner",
  schemaVersion: 1,
  title: "Banner",
  category: "Content",
  description: "The host's own headline component.",
  source: { module: "my-site/components", exportKind: "named", exportName: "Banner" },
  defaults: { headline: "Banner" },
  fields: [{ prop: "headline", label: "Headline", schema: { type: "string" }, editor: { kind: "text" } }],
});

export const componentPack = defineComponentPack({ packId: "my-site", packVersion: "1.0.0", components: [banner] });
export { Banner };
```

Swapping a themeset is two edits and no tool change: the `pack` value above, and
the `@import` in the host's `styles` entry. zudo-composer never falls back to a
bundled pack — an unresolvable specifier is a startup error naming the specifier
and the `package.json` it was resolved from.

**Packaging rule for a themeset.** The pack is resolved with `createRequire`,
so the `exports` targets for the pack entry and for every `source.module` must
be a plain string or an object carrying a `default` key. An `exports` entry with
only `import`/`types` conditions cannot be resolved.

### Styles ownership

zudo-composer's own CSS never imports a pack's. The host's `styles` file
(`styles/base.css` by default) is the sole importer of the pack's stylesheet and
the host's Tailwind `@source` declaration point:

```css
@import "@acme/themeset/styles/themeset.css";

@source "../node_modules/@acme/themeset/src";
```

The tool reaches it through `virtual:zudo-composer-host-styles`, which resolves
to the real file so its relative `@import`/`@source` bases stay the host's. A
missing file is a loud config error. Every custom property the editor chrome
consumes is declared in the tool's own `src/styles/app-tokens.css`, so a themeset
that ships none of them still leaves a working editor.

The package publishes five entry points. Everything else is internal:

| Specifier | What it is |
| --- | --- |
| `zudo-composer` | `startComposerDevServer` / `resolveComposerDevConfig` |
| `zudo-composer/config` | `defineComposerConfig` and the config types |
| `zudo-composer/vite` | the composer Vite plugins, for a host-authored config |
| `zudo-composer/styles` | the canonical Composer stylesheet |
| `zudo-composer/package.json` | the manifest |

Vite and its Preact/Tailwind plugins are runtime `dependencies` rather than
`devDependencies`: they are dev-only for *this* repository but are loaded by the
installed launcher, so a host must receive them. The published archive ships the
TypeScript sources under `src/`, `server/`, and `plugins/` — not a built
`dist/` — because the launcher evaluates them through Vite. It also retains
`contract-handoff.json` and the contract's own sources, which the SiteProject
toolchain reads to compute release identity; those sources are named one file at
a time in `files`, because the nested `package.json` under `packages/` stops the
root allowlist's exclusions from applying to that subtree.

With pnpm 11.5.2, the host must explicitly accept the tool's Git-hosted
`@zudo-sg/ui` dependency, which is pinned to a full commit SHA. pnpm blocks
transitive Git sources by default and this version has no per-package exception.
Use the following in the **host project's** `pnpm-workspace.yaml`; do not change
global pnpm settings. `blockExoticSubdeps: false` permits transitive Git sources
for this host, so review other dependencies before adopting it. Build permission
remains limited to the named packages:

```yaml
blockExoticSubdeps: false
allowBuilds:
  "@zudo-composer/component-contract": true
  esbuild: true
```

Pin the host's `packageManager` to `pnpm@11.5.2` as well, so installs inside and
outside this repository use the same package-manager behavior.

`fixtures/host/` is the in-repo dogfood host: the smallest project that installs
the package and runs its bin.

## Development and validation

Use Node.js 22.13.0+ or 24.0.0+ and pnpm 11.5.2 through Corepack:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

`pnpm check` is the bounded offline gate: lint, typecheck, the headless, handoff
and class-name boundaries, the provider identity boundary, unit tests, one
production build, and the built-artifact boundary.

```sh
corepack pnpm check
```

The provider boundary is split in two. `provider:boundary` checks the manifest
spec, the lockfile resolution and the parity between the installed pack's
generated component list and its sidecars — none of which needs a build, so it
runs on a bare checkout. `dist:boundary` checks what `vite build` emitted and
requires `pnpm build` first.

CI additionally verifies the component-contract handoff and runs the three
browser lanes:

```sh
corepack pnpm contract:conformance
corepack pnpm contract:negative-scan
corepack pnpm contract:external-install -- --exact
corepack pnpm test:browser:host
corepack pnpm test:browser:dev
corepack pnpm test:browser:site-project
```

Each lane owns one port and one server, so none of them may run concurrently:

| Lane | Server | Port | Specs |
| --- | --- | --- | --- |
| `test:browser:host` | `zudo-composer dev`, rooted at a disposable host project | 4173 | `tests/browser`, minus the SiteProject spec |
| `test:browser:dev` | this repository's own `pnpm dev` | 5173 | `tests/browser-dev` |
| `test:browser:site-project` | this repository's own Vite, with a CLI-activated release | 4174 | `tests/browser/site-project-acceptance.pw.ts` |

The host lane is the one that runs the package the way a host does — through its
`bin`, against a project it has never seen. It activates the sample SiteProject
into that project first, because a library with no activated project has no rows
to look at.

`smoke:host-install` goes further and is the only proof that involves a real
install: it packs the package, installs it into a bare project outside this
repository, boots it with no sample activation, authors through the browser,
restarts, and finally removes the tool to confirm the host keeps its data.

```sh
corepack pnpm smoke:host-install
```

Both `test:browser:host` and `test:browser:dev` route specs to a viewport by
filename: `*.coarse.pw.ts` runs only on a 390x844 touch project, and
`*.responsive.pw.ts` runs on both. The rules those specs check are switched off
on a fine pointer, so a coarse spec that reaches the desktop project passes
while proving nothing — the suffix is part of the proof, not a label.

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
4. Run `corepack pnpm check`, all three contract commands above, and
   `corepack pnpm test:browser:host`. The provider and dist boundaries must
   still prove the exact 12 IDs/runtime exports, canonical CSS, and one focused
   WASM/glue.

Do not copy provider components into this repository or add a fallback registry.

## Component-contract handoff

The component contract is a separate handoff from the UI provider. This
repository owns its source at `packages/component-contract`; external package
consumers use the package-only commit recorded by
[`contract-handoff.json`](./contract-handoff.json):

- API/package version: `@zudo-composer/component-contract@1.0.0`
- package commit: `b66d52bb273a10010485efb2d06f80cee8001bd6`
- exact external Git spec:
  `git+https://github.com/Takazudo/zudo-composer.git#b66d52bb273a10010485efb2d06f80cee8001bd6`

The monorepo itself intentionally resolves this contract with `workspace:*`, as
a dev dependency; the published manifest declares it as a peer dependency so a
host installs exactly one instance. Neither relationship may be confused with,
or used in place of, the immutable external UI-provider Git dependency.

## Scoped hosted demo exception

The installed tool and ordinary local workflow remain local-first. Issue 414
adds one disposable static sample at `https://zudo-composer.zudolab.dev`; it
does not add hosted persistence, an API, authentication, arbitrary host-project
access or a deployment target for installed applications. The target is the
Worker named `zudo-composer` and the existing custom-domain binding in
[`wrangler.jsonc`](./wrangler.jsonc) remains in place.

`pnpm build:hosted-demo` emits `dist-hosted-demo`, and `pnpm hosted-demo:verify`
checks the final files, manifest identities, checksums, MIME types and the
ordinary artifact boundary. CI then runs the hosted browser lane against that
same directory and uploads an artifact named for the exact 40-character commit
SHA. Production can consume only a successful `main` CI run from this
repository, downloads that exact run/SHA artifact, verifies it again, runs a
Wrangler dry run, captures the currently active single-version deployment, and
uploads the same directory with Wrangler 4.130.0 before activating its returned
version ID.

The production workflow is serialized and refuses a stale `main` head, missing
or partial Cloudflare credentials, a missing rollback target, a split-traffic
deployment, or an artifact/source mismatch. It checks the live manifest, every
route and every asset with bounded HTTPS requests. If smoke verification fails,
it rolls back only when the active version is still the version this run
uploaded; the workflow remains failed even after a verified rollback. A manual
rollback uses the captured version ID with `wrangler rollback`; never copy local
OAuth tokens into repository or workflow secrets.

Prove the exact local artifact with:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm smoke:host-install
corepack pnpm build:hosted-demo
corepack pnpm hosted-demo:verify
```

## Destructive current-only policy

There are no users and no persisted production data. Provisional routes,
schemas, storage identities, source layouts, and file-provider layouts may be
destructively replaced with the clearest current contract. Do not add
migrations, redirects, aliases, legacy fallbacks, compatibility shims, or
compatibility fixtures.

This authorization is limited to this project's current application state. It
does not authorize deleting or replacing unrelated repositories, hosting
resources, domains, credentials, user files, or other infrastructure.

## Provenance and final evidence

The initial implementation was ported with provenance from
`Takazudo/zudo-sg@f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2`, without grafting
history or inheriting any zudo-sg infrastructure identity. That frozen source
reference is provenance only; zudo-sg no longer owns these applications.

After the Phase 3 root reaches `main`, the integration owner records one
canonical evidence block on both Phase 3 and Phase 4 epics: root PR URL; full
permanent `main` SHA; provider Git spec/SHA/tree and all version domains; and
green root-PR and post-merge CI URLs.
