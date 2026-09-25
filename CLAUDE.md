# Repository guidance

## Permanent ownership

This repository is the permanent home of `zudo-composer`, an installable
authoring **tool**, not an application with its own content. It owns the
Composer document model, source generation, reuse rules, chrome, preview
renderer and same-origin iframe protocol; the Content model, Entry library and
authoring UI; the Mapping binding model, resolver and authoring UI; the
Sitemapper page-tree model, library, authoring UI and Composer-catalog
integration; and the Assets metadata model, library route and upload/delivery
boundaries. All five domains use shared filesystem primitives, but only
Content, Mapping, Sitemapper and the workspace registry use
`TransactionalRecordStore`. Composer persists canonical composition JSON and
derived JSX through `SafeRootFilesystem`; Assets maintains its own atomic
catalog and immutable uploaded bytes.

A host project installs this tool, writes one `zudo-composer.config.ts` at its
own root, and owns everything the tool authors into that host: its
**components** (code — either host-local source reached through the host's own
`exports` self-reference, or an installed themeset package; never a path), its
**templates** (data, not code — a Composition whose `publication.kind` is
`"global-template"`, stored under `compositionsDir` like any other composition;
there is no templates directory or template file format), and its **CMS data**
(the four JSON domains plus assets, rooted at `dataDir`/`assetsDir`). See the
settings table in [`README.md`](./README.md) for the full default layout.

This repository also owns its dogfood component set in `packages/ui`
(`@zudo-composer/ui`): typed component sidecars, the runtime pack, and
canonical Composer CSS. Its package metadata is `@zudo-composer/ui@0.1.0`
and its component-pack protocol identity is `@zudo-composer/ui@1.0.0`. The
pack's focused `@takazudo/zfb-md-wasm` dependency, exactly `2.20.3`, is allowed
for `ProseMd` as a dependency of `packages/ui`, never of the tool; no zudo-doc,
zfb application runtime/config, virtual-zfb, or styleguide registry may enter
this tool. The tool never lists the pack under `dependencies` or
`peerDependencies`, never bundles it, and never falls back to it: there is no
dual provider and no fallback registry. `@zudo-composer/ui` is otherwise an
ordinary component pack — any themeset that satisfies the same contract is
interchangeable with it.

The standalone `styleguide/sample/` host is outside this tool; it catalogs the
tool's pack without making the styleguide engine part of the tool.

The tool's authoring routes are `/`, `/composer`, same-origin
`/composer/preview`, `/content`, `/mapping`, `/sitemapper`, and `/assets`.
`/site` and `/website-preview` are visitor documents outside the authoring
shell: they open in their own tab, delivered by the same visitor client as the
static build, loading only the host's styles entry and a small tool-owned
visitor sheet. An activated host site is delivered under `/site`; each static
site's own routes come from its verified `dist-site/site-manifest.json`. The
SiteProject acceptance
lane derives Sample Studio's route data from `scripts/host-site-routes.mjs`'s
`readVerifiedHostManifest`, which verifies it against that artifact.
Emitted files live under `/assets/`, and committed images and PDFs from the
host's `publicAssetsDir` are delivered under `/uploaded-assets/`. Upload
authoring remains dev-only. Keep Vite base `/` and the preview graph isolated
from a consuming host project and its file-provider plumbing.

The SiteProject operator/API guide is [`docs/site-project.md`](./docs/site-project.md).
It is the source for provider-scoped graph, whole-project apply, active
identity/CAS revisions, immutable builds, diagnostics, JSON-stdin examples,
disposable local state, and guarded browser acceptance commands.
Hosted persistence, a hosted API, and authentication are future adapter work;
nothing in this repository claims them.

## Clean-break authority

There are no users or persisted production data. Prefer one clear current
schema and destructively replace provisional application routes, storage/source
layouts, and file-provider formats when needed. Do not add migrations,
redirects, aliases, legacy fallbacks, compatibility shims, or fixtures for old
schemas.

The project is still in development and has no audience, so the same rule
covers its own public surface: hosted demo domains, Worker names, deploy target
keys, demo package names and URLs may be renamed or retired outright. Do not
keep old domains alive, add redirects between them, or preserve old names for
backward compatibility.

The demo hosts' `site-project.ts` files are authored source. Their tracked
`site-project.json` and ready CMS records are generated material and current
reader compatibility fixtures; never edit them by hand. A storage format,
workspace layout, compiler, component pack, or authored source change must
regenerate **every host atomically in the same PR** with
`corepack pnpm cms:regenerate`, then pass `corepack pnpm cms:check` (also part
of `corepack pnpm check`). The command discovers hosts on disk, including new
demo hosts, and uses the installed `generate` and `seed --ready-workspace`
commands. A changed build identity requires regeneration, even when the
SiteProject JSON did not change; do not exempt a baseline or relax readers.

Run regeneration with authoring stopped and preserve local CMS edits first.
It replaces only known generated trees that match Git HEAD or the newly
produced bytes, and preserves Assets and unrelated host state. Commit the
generated ownership file `scripts/cms-fixtures.json` with all generated host
files. Old records need not pass new readers before explicit regeneration;
there are still no migrations for consumer repositories. See the
[clean-break procedure](docs/site-project.md#regenerating-committed-hosts).

This authority applies only to this project's current state. It does not permit
destructive changes to unrelated repositories, user files, hosting resources,
domains, credentials, or other infrastructure. Deleting or unbinding this
project's own live Cloudflare Workers and domains is still a user-performed or
user-approved step, never an automatic side effect of a workflow.

## Package handoffs

Two package-only handoffs leave this repository, each on its own
fast-forward branch whose root tree equals the package directory:

| Package | Source | Handoff file | Branch | Package commit |
| --- | --- | --- | --- | --- |
| `@zudo-composer/component-contract@1.0.0` | `packages/component-contract` | `contract-handoff.json` | `package/component-contract-v1` | `c0b452da075b66757c60bd0d721a47062d4354d0` |
| `@zudo-composer/ui@0.1.0` (pack `@zudo-composer/ui@1.0.0`) | `packages/ui` | `ui-handoff.json` | `package/ui-v1` | `e33643e672554a321f34aed6f035a42ce90f5354` |

External hosts install each through its exact root Git spec,
`git+https://github.com/Takazudo/zudo-composer.git#c0b452da075b66757c60bd0d721a47062d4354d0`
for the contract and
`git+https://github.com/Takazudo/zudo-composer.git#e33643e672554a321f34aed6f035a42ce90f5354`
for the UI pack — never through a branch/tag, sibling checkout, `workspace:`,
`file:`, `link:`, `path:`, copied source, or a pnpm Git subdirectory selector.
Inside this monorepo both relationships are `workspace:*` development
dependencies; do not substitute either for the external Git spec. The
component-contract handoff and the UI-pack handoff are separate: each has its
own handoff file, branch and gate (`contract:external-install`,
`ui:external-install`).

A byte change under `packages/ui` needs a new package commit, parented on the
previous one so `package/ui-v1` fast-forwards, recorded in `ui-handoff.json`,
README and here. Then run a clean frozen install and the full
unit/artifact/browser gates, which still prove the 12-component
runtime/CSS/WASM set. A byte change under `packages/ui` also requires bumping
the styleguide pin in `styleguide/sample/package.json`; `corepack pnpm sg:pins`
enforces that it matches the handoff.

## Sample styleguide

`styleguide/sample/` is a catalog of the 12 `@zudo-composer/ui` components used
by the Sample host, built with the `zudo-sg` engine. It is a standalone project
with its own lockfile and is not a workspace member. The root lockfile must
never contain `@takazudo/zudo-sg`; `provider:boundary` enforces that
separation. Stories belong to this host and never live under `packages/ui`.

The host installs the UI pack and component contract by their exact root Git
specs, so its dependencies show the pinned package commits recorded by the
handoff files:

- `@zudo-composer/ui`: `git+https://github.com/Takazudo/zudo-composer.git#e33643e672554a321f34aed6f035a42ce90f5354`
- `@zudo-composer/component-contract`: `git+https://github.com/Takazudo/zudo-composer.git#c0b452da075b66757c60bd0d721a47062d4354d0`

This is the proven Git-spec state from the scaffold; it does not fall back to
a `link:` spec. A handoff bump must update
`styleguide/sample/package.json`, and `corepack pnpm sg:pins` enforces both
pins against `ui-handoff.json` and `contract-handoff.json`.

From the repository root, use:

```sh
corepack pnpm -C styleguide/sample install --frozen-lockfile
corepack pnpm -C styleguide/sample dev
corepack pnpm -C styleguide/sample build
corepack pnpm -C styleguide/sample check
corepack pnpm sg:build-site
```

## Demo styleguides

`styleguide/shop/`, `styleguide/landing/` and `styleguide/blog/` are standalone
catalog hosts for the demo-owned component packs. Each host has its own frozen
lockfile outside the root workspace, pins `@zudo-composer/component-contract`
to `contract-handoff.json`, and must not depend on Sample's `@zudo-composer/ui`
pack. `pnpm sg:pins` enforces that distinction and preserves Sample's existing
two exact handoff pins.

Use `pnpm sg:build-styleguide shop-sg`, `pnpm sg:build-styleguide landing-sg`,
or `pnpm sg:build-styleguide blog-sg` for one verified artifact. The command
performs that host's frozen install; `pnpm sg:build-styleguides` builds Sample,
Shop, Landing and Blog serially. CI checks and publishes each target's own
artifact after a root frozen install and that host's frozen install. Sample's
existing `pnpm sg:build-site` entry point remains unchanged.

## Commands and completion gates

- Install: `corepack pnpm install --frozen-lockfile`.
- Develop: `corepack pnpm dev`.
- Aggregate gate: `corepack pnpm check`, including the complete packed-install
  proof. It needs network access, Playwright Chromium and exclusive browser
  port 4175; run it with the other browser lanes stopped. It also builds the
  four standalone styleguides and writes their verified doc-site manifests.
- Package handoffs: `corepack pnpm contract:conformance`, `corepack pnpm
  contract:negative-scan`, `corepack pnpm contract:external-install --
  --exact`, and `corepack pnpm ui:external-install -- --exact`.
- Browser preparation: `corepack pnpm demo:build-sites` discovers and builds
  all host artifacts before the SiteProject and demos browser lanes; stale
  artifacts fail their read-only verification.
- Browser lanes: `corepack pnpm test:browser:host`, `corepack pnpm
  test:browser:dev`, `corepack pnpm test:browser:site-project`, `corepack pnpm
  test:browser:demos` (port 4176, the four `packages/demo-*` hosts), and
  `corepack pnpm test:browser:demo-editor [sample|shop|landing|blog]` (port
  4175, the prepared per-host editor artifacts). Each owns one machine-global
  port, so none may run concurrently, and no lane may rebuild.
- Consumer boundary: the ledger must contain zero entries. Scan actual creator
  templates and complete generated output before packed dependency rewriting.
- Host install: `corepack pnpm smoke:host-install` packs the tool and contract,
  then proves all disk-discovered package hosts, freshly generated creator
  output and the synthesized fixture outside this repository. CI uses one
  matrix job per host. `corepack pnpm no-deploy:check` guards these validation
  commands, including aliases and local wrappers; Cloudflare dry-runs only.

Do not weaken frozen install, negative dependency scans, the exact package
handoffs, or the 12-component runtime/CSS/WASM proof to make a gate pass.

## Scoped hosted demo exception

The installed tool and ordinary local workflow remain local-first. The scoped
exception publishes the documentation site, four standalone styleguides, four
static demo websites and four disposable per-host editors. None adds
hosted persistence, a hosted API,
authentication, arbitrary host project access or deployment support for
installed applications. `scripts/hosted-demo/targets.mjs` is the source of
truth for this thirteen-target registry:

| Target key | Kind | Worker | Wrangler config | Domain |
| --- | --- | --- | --- | --- |
| `doc` | `doc-site` | `zudo-composer` | `wrangler.doc.jsonc` | `zudo-composer.zudolab.dev` |
| `sample-sg` | `doc-site` | `zc-sg-sample` | `wrangler.sample-sg.jsonc` | `zc-sg-sample.zudolab.dev` |
| `shop-sg` | `doc-site` | `zc-sg-shop` | `wrangler.shop-sg.jsonc` | `zc-sg-shop.zudolab.dev` |
| `landing-sg` | `doc-site` | `zc-sg-landing` | `wrangler.landing-sg.jsonc` | `zc-sg-landing.zudolab.dev` |
| `blog-sg` | `doc-site` | `zc-sg-blog` | `wrangler.blog-sg.jsonc` | `zc-sg-blog.zudolab.dev` |
| `sample` | `site-static` | `zc-demo-sample` | `wrangler.demo-sample.jsonc` | `zc-demo-sample.zudolab.dev` |
| `shop` | `site-static` | `zc-demo-shop` | `wrangler.demo-shop.jsonc` | `zc-demo-shop.zudolab.dev` |
| `landing` | `site-static` | `zc-demo-landing` | `wrangler.demo-landing.jsonc` | `zc-demo-landing.zudolab.dev` |
| `blog` | `site-static` | `zc-demo-blog` | `wrangler.demo-blog.jsonc` | `zc-demo-blog.zudolab.dev` |
| `sample-editor` | `demo-editor` | `zc-demo-sample-editor` | `wrangler.demo-sample-editor.jsonc` | `zc-demo-sample-editor.zudolab.dev` |
| `shop-editor` | `demo-editor` | `zc-demo-shop-editor` | `wrangler.demo-shop-editor.jsonc` | `zc-demo-shop-editor.zudolab.dev` |
| `landing-editor` | `demo-editor` | `zc-demo-landing-editor` | `wrangler.demo-landing-editor.jsonc` | `zc-demo-landing-editor.zudolab.dev` |
| `blog-editor` | `demo-editor` | `zc-demo-blog-editor` | `wrangler.demo-blog-editor.jsonc` | `zc-demo-blog-editor.zudolab.dev` |

The four static sites build to each host's `dist-site` with
`pnpm demo:build-site <sample|webshop|landing|blog|dir>` or the discovering
`pnpm demo:build-sites` command. Each `demo-editor` target is built from the
matching host's own config, component pack, stylesheet and generated project:
`pnpm demo:build-editor <sample|shop|landing|blog|dir>` builds one and
`pnpm demo:build-editors` discovers and builds all four serially into
`dist-editor`. The editor browser lane is
`pnpm test:browser:demo-editor [sample|shop|landing|blog]`; it consumes those
prepared artifacts on port 4175 and never rebuilds them.

The `doc` target runs `pnpm doc:build-site`, verifies `doc/dist` with
`doc-site-manifest.json`, and uses the default `auto-trailing-slash` HTML
handling with an explicit `404-page` fallback. The target registry owns each
Worker, config file, artifact directory, domain and verifier shape;
`deploy.mjs`, `live-check.mjs` and `check-hosted-demo.mjs` are generic over
that target, while `workflow-guard.mjs` validates the trusted run before
artifact access. The production workflow is serialized per target and accepts
only a successful same-repository `main` CI run, its exact SHA-named artifact,
and the current `main` head. It captures the active single-version
deployment, performs a Wrangler dry run, uploads the verified directory with
Wrangler 4.130.0, and activates only the version returned by that upload.
Pull-request validation has no Cloudflare secrets.

The `sample-sg` target runs `pnpm sg:build-site`; `shop-sg`, `landing-sg` and
`blog-sg` run `pnpm sg:build-styleguide <target>`. These four standalone
styleguide targets build `styleguide/<host>/dist` with the shared
`doc-site-manifest.json` contract. Their Workers are new and use the existing
missing-Worker first-rollout path. `pnpm sg:build-styleguides` builds all four
serially; `pnpm sg:pins` keeps Sample's two handoff pins while checking the
contract-only pins and no-UI dependency boundary for the three demo hosts.

Missing credentials, stale `main`, missing rollback state, split traffic or an
artifact/source mismatch fail before mutation. A target whose Worker does not
exist yet is the one exception: when both `deployments list` and `versions
list` report it missing, the first rollout uses plain `wrangler deploy`, which
binds the custom domain and has no rollback target. Any other missing-state
combination fails closed. Live checks cover every manifest, emitted asset and
route with bounded HTTPS requests; automatic rollback is allowed only while
the exact uploaded version remains active, and a successful rollback still
leaves the workflow red.

The owner runbook for deleting retired Workers before the first rollout,
partial-first-deploy recovery, token scopes, captured-version rollback and
the `workflow_dispatch` target input is [`docs/hosted-demo.md`](./docs/hosted-demo.md).
Local OAuth credentials are never copied to repository or workflow secrets.

Do not claim a permanent target `main` SHA or a final CI URL before the Phase 3
root merges and post-merge evidence exists. The integration owner records that
canonical evidence on both Phase 3 and Phase 4 epics.

## Provenance

The application was ported from
`Takazudo/zudo-sg@f1206f3b82bdbfff791dcaf5d9918c2afdda0ae2` without history
grafting. The UI component set in `packages/ui` was ported from the zudo-sg
package commit `6b0826cdaa14d9888e58c795ee015f70e2c5cbdf`. Both references are
provenance, not continuing ownership or permission to reuse source-project
infrastructure.
