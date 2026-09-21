# Disposable hosted demo

`pnpm demo:build-editor <sample|shop|landing|blog|dir>` builds the selected host's
demo editor into `<hostDir>/dist-editor`. Names map explicitly to the four demo
hosts: `sample`, `shop`, `landing` and `blog`; for example, `shop` selects
`packages/demo-webshop`. `pnpm demo:build-editors` discovers the host fleet with
`discoverPackedHosts` and builds each editor one at a time. The matching browser
lane is `pnpm test:browser:demo-editor [sample|shop|landing|blog]`; it serves
prepared editor artifacts on port 4175 and never rebuilds them.
The ordinary `pnpm build`, installed package and local development endpoints keep
their existing behavior. The demo publishes no filesystem APIs or release server.

Each editor bundles its host's `site-project.json`, generated from that host's
`site-project.ts` and `content/`. The build reads and validates it against the
host's pack, injects `virtual:demo-editor-project` into the browser bootstrap,
and derives the manifest's project revision from that same snapshot.
Vite is rooted at the host so dependency and stylesheet resolution follow the
host's config. The builder loads the tool's shared HTML under a host-rooted
module ID; no host `index.html` is required or changed. The deployed demo needs
no filesystem. It never reads an activated local SiteProject, arbitrary host
directories, or browser databases. Content, Mapping,
Sitemap and Composition records live in this tab's memory. Reloading resets them;
new independent tabs start from the selected host's project. Export working JSON
to retain edits.
Review inspection/export works; local staging, build and activation remain disabled.

The test fixture helper and isolated browser seed lanes use the sample host's JSON.
`pnpm sample:check`, included in `check` and both editor build commands, rejects
duplicate sample files, fixed project imports in the editor, and hand-edited
generated JSON.
`pnpm cms:check` also verifies the studio's derived ready CMS. Regenerate all
hosts with `pnpm cms:regenerate` after changing authored content. The installed
tool's `files` allowlist excludes demo hosts, `src/test`, and `src/hosted-demo`;
repository test runners supply the sample to their disposable hosts explicitly.

The editor reads assets from its host's configured store. The current adapter
in `scripts/hosted-demo/prepare.ts` accepts the demo hosts' active catalogs,
keeps every immutable version for each active record and every active folder
(including empty folders), and verifies record shape, MIME signature, length,
checksum and real file paths. Trash and unreferenced bytes are omitted. The
full per-host asset snapshot and verifier contract is tracked separately in
[issue 611](https://github.com/Takazudo/zudo-composer/issues/611).
Committing assets alone does not publish them: the editor build must export and
deploy the assets. No uploads are sent to a server.

Assets metadata retains the regular canonical `/uploaded-assets/` URLs. The demo-only
service worker holds no data, cache or database. It requests bytes from the exact
requesting client, with a four-second timeout. Unknown authoring URLs and unknown
immutable uploads fail closed; the four immutable bundled assets remain public.
The isolated Composer iframe forwards asset requests only to its matching host.
Setup waits at most ten seconds for control and reports initialization failures.

Same-tab working preview is gone: `/website-preview` and `/site` always open in
their own new tab as a separate visitor document, and the one-use, random-token
handoff is the only path that feeds it. The opener validates both origin and
window identity, flushes sessions and captures a coherent current project plus
all asset bytes; other tabs cannot request it. Reloading that tab without a
token falls back to the public bundled sample. The bootstrap also exposes
`mountPreviewFrame(frame, url)` for the same scoped handoff into an attached
working-preview iframe.

Build output includes `demo-editor-manifest.json` with the full **40-character
Git sourceRevision**, the separate **64-character projectSourceRevision**, and
SHA-256 checksums of every final deployable file except the manifest itself.
The `assets` map records every active immutable uploaded version; it has no
fixed asset count. Active folders remain in the bundled snapshot even when
empty, while trashed records and unreferenced bytes stay out. The workspace
baseline is separately computed from canonical SiteProject JSON as a
**64-character SHA-256 project revision**. These are different identities and
must never be substituted for one another.

Verification for the deployment/acceptance lane:

- `pnpm exec vitest run src/hosted-demo scripts/hosted-demo`
- `pnpm demo:build-editors`
- `pnpm test:browser:demo-editor`
- Serve the selected host's `dist-editor` with SPA fallback and correct asset MIME types on HTTPS
  (or loopback for testing), then verify all manifest hashes including `index.html`.
- Check `/review`, `/composer`, `/assets`, `/website-preview`, `/site` and nested site
  routes at desktop/narrow widths and light/dark themes. Confirm four images, image
  inspector/preview, upload/replace, snapshots, new-window changed project/assets,
  unrelated-tab isolation and reload reset. The browser runner must use the
  machine-wide Playwright guard.
- Run ordinary `pnpm build && pnpm dist:boundary`; ordinary output must contain no
  demo editor seed, Worker, manifest or uploaded demo exports.

Deployment gates must validate this exact artifact before publishing its bytes.

## Ten deploy targets, one pipeline

The trusted-run deploy pipeline (`scripts/hosted-demo/deploy.mjs`,
`live-check.mjs` and `scripts/check-hosted-demo.mjs`) deploys ten independent
Cloudflare Workers, each on its own custom domain:

| Target key | Worker | Config file | Domain | Artifact directory | Manifest | CI artifact |
| --- | --- | --- | --- | --- | --- | --- |
| `doc` | `zudo-composer` | `wrangler.doc.jsonc` | `zudo-composer.zudolab.dev` | `doc/dist` | `doc-site-manifest.json` | `doc-site-<sha>` |
| `sample-sg` | `zc-sg-sample` | `wrangler.sample-sg.jsonc` | `zc-sg-sample.zudolab.dev` | `styleguide/sample/dist` | `doc-site-manifest.json` | `sample-sg-site-<sha>` |
| `sample` | `zc-demo-sample` | `wrangler.demo-sample.jsonc` | `zc-demo-sample.zudolab.dev` | `packages/demo-sample/dist-site` | `site-manifest.json` | `demo-site-sample-<sha>` |
| `shop` | `zc-demo-shop` | `wrangler.demo-shop.jsonc` | `zc-demo-shop.zudolab.dev` | `packages/demo-webshop/dist-site` | `site-manifest.json` | `demo-site-shop-<sha>` |
| `landing` | `zc-demo-landing` | `wrangler.demo-landing.jsonc` | `zc-demo-landing.zudolab.dev` | `packages/demo-landing/dist-site` | `site-manifest.json` | `demo-site-landing-<sha>` |
| `blog` | `zc-demo-blog` | `wrangler.demo-blog.jsonc` | `zc-demo-blog.zudolab.dev` | `packages/demo-blog/dist-site` | `site-manifest.json` | `demo-site-blog-<sha>` |
| `sample-editor` | `zc-demo-sample-editor` | `wrangler.demo-sample-editor.jsonc` | `zc-demo-sample-editor.zudolab.dev` | `packages/demo-sample/dist-editor` | `demo-editor-manifest.json` | `demo-editor-sample-<sha>` |
| `shop-editor` | `zc-demo-shop-editor` | `wrangler.demo-shop-editor.jsonc` | `zc-demo-shop-editor.zudolab.dev` | `packages/demo-webshop/dist-editor` | `demo-editor-manifest.json` | `demo-editor-shop-<sha>` |
| `landing-editor` | `zc-demo-landing-editor` | `wrangler.demo-landing-editor.jsonc` | `zc-demo-landing-editor.zudolab.dev` | `packages/demo-landing/dist-editor` | `demo-editor-manifest.json` | `demo-editor-landing-<sha>` |
| `blog-editor` | `zc-demo-blog-editor` | `wrangler.demo-blog-editor.jsonc` | `zc-demo-blog-editor.zudolab.dev` | `packages/demo-blog/dist-editor` | `demo-editor-manifest.json` | `demo-editor-blog-<sha>` |

`scripts/hosted-demo/targets.mjs` is the single place naming these ten rows
and each target's artifact-verification shape. The `doc` target verifies
`doc/dist` against the documentation manifest contract above. The `sample-sg`
target verifies `styleguide/sample/dist` with the same doc-site manifest
contract, built by `pnpm sg:build-site`. The four demo websites verify a
`dist-site` directory (built by `pnpm demo:build-site
<sample|webshop|landing|blog>`, see [`docs/demo-sites/README.md`](./demo-sites/README.md))
against the static-site manifest contract in
[`server/site-build/artifact.mjs`](../server/site-build/artifact.mjs) —
`site-manifest.json` and a live route list read from each manifest's own
`routes` array. Each `demo-editor` target verifies its host's `dist-editor`
against `demo-editor-manifest.json` and the editor route contract. The `doc`
target's routes are derived from emitted HTML files (directory `index.html`
files become trailing-slash routes and standalone HTML files keep
extensionless routes). Its multi-page live check uses the target's `routeFile`
and `assetUrl` hooks to map each route and canonical asset URL. Index HTML
files are covered by their route checks; standalone `x.html` is fetched at
`/x` and `404.html` at `/404`, because
[Workers Static Assets redirects `.html` URLs](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/).
The config keeps the default `auto-trailing-slash` HTML handling and sets
`404-page` for unknown routes. ICO and XML assets accept their explicit MIME
alternatives while retaining exact hash checks. Local doc builds may omit
`sourceRevision`; production preflight requires the full SHA selected by the
trusted-run guard. The CI build uses the default shallow checkout, which also
passes the doc-history preBuild.

The doc target's first production rollout happens after merge to `main` through
the pipeline's new-Worker path. It has no previous deployment to roll back to.
The `sample-sg` target is also a new Worker: `pnpm sg:build-site` builds the
standalone `styleguide/sample/` host into `styleguide/sample/dist`, and its
first rollout takes the same missing-Worker path.

`deploy.mjs`'s `preflightDeployment`/`deployHostedDemo`
and `live-check.mjs`'s `verifyLiveDeployment`/`verifyLiveWithRetries` take an
optional `target` (or the lower-level `manifestFileName`/`artifactVerifier`/
`liveRoutes` a target supplies). CLI callers must pass `--target` or set
`HOSTED_DEMO_TARGET`; there is no implicit target because the ten contracts
have different artifact shapes.
`scripts/hosted-demo/workflow-guard.mjs` needed no target parameter at all —
its trusted-run checks (successful same-repo `main` CI run, fresh `main` head)
never touch an artifact, a Worker name or a Cloudflare config, so the same
guard step runs unmodified for every target.

Target selection for the CLIs is the `HOSTED_DEMO_TARGET` environment variable
or the deploy script's `--target` option. For example,
`HOSTED_DEMO_TARGET=shop-editor pnpm hosted-demo:verify` and
`HOSTED_DEMO_TARGET=shop-editor pnpm hosted-demo:deploy` operate on the
shop editor's Worker, config and `packages/demo-webshop/dist-editor`; use the
same form for any of the ten keys in the table above.

## Production rollout

The production workflow is `.github/workflows/hosted-demo-deploy.yml`, run as
a matrix of the ten targets above. A successful `main` run of `CI` is its
only automatic trigger. Each matrix leg downloads the artifact whose name
contains that target's prefix (`doc-site-`, `sample-sg-site-`,
`demo-site-<name>-` or
`demo-editor-<name>-`) and that
run's full commit SHA, verifies the artifact again, and passes the matching
directory to Wrangler. Each target has its own concurrency group
(`hosted-demo-production-<target>`), so two rollouts of the *same* target
cannot overlap, but the ten targets can roll out concurrently with each
other. A manual `workflow_dispatch` requires `target`, `run_id` and `sha`:
`target` is one registry key from the table, while `run_id` and `sha` identify
a successful same-repository `main` CI run. The guard is loaded from a fresh
trusted `main` checkout before the selected artifact checkout is used.

The deploy step requires both `CLOUDFLARE_ACCOUNT_ID` and a Cloudflare API
token. It fails visibly when either is absent or partial. Local Wrangler OAuth
sessions are useful for read-only checks and must never be copied into GitHub
secrets. The checked-in `wrangler.doc.jsonc`, `wrangler.sample-sg.jsonc`, the
four `wrangler.demo-*.jsonc` site configs and the four
`wrangler.demo-*-editor.jsonc` configs each keep
`workers_dev: false`, `preview_urls: false`, and that target's own
custom-domain binding. The compatibility date is pinned in each file; no
account ID or credential is committed to any of them.

Before any upload, the workflow checks the active deployment and its single
100% version, records that exact version as the rollback target, and runs
`wrangler deploy --dry-run`. It then runs `wrangler versions upload` against the
verified artifact with a unique run tag. Activation is requested only for the
version ID returned by that upload (`versions deploy <id>@100 --yes`). A missing
upload ID stops before activation. A command failure after Cloudflare accepts
the replacement still has the known ID available for the ownership check.

### First-rollout owner runbook

The root-domain move is a clean break. Before the first production rollout,
delete the retired Workers `zudo-composer`, `zudo-composer-doc`,
`zudo-composer-demo-shop`, `zudo-composer-demo-landing` and
`zudo-composer-demo-blog` from the `zudolab.dev` account. Confirm that their
old custom-domain bindings and DNS records are gone, then let the current
target's plain `wrangler deploy` create the replacement Worker and binding. The
new `doc` target intentionally reuses the `zudo-composer` name after this clean
break. The `sample-sg` target has no retired Worker: it is a new
`zc-sg-sample` Worker and follows the missing-Worker first-rollout path.
Delete only those exact retired names; never delete a current `zc-demo-*` or
editor Worker as part of this cleanup.

The owner can delete the retired scripts explicitly (or use the Cloudflare
dashboard when a custom-domain binding needs separate cleanup):

```sh
# Wrangler 4.130.0 has no --yes flag; a non-interactive run accepts the
# confirmation prompt. Set CLOUDFLARE_ACCOUNT_ID when the login has several accounts.
corepack pnpm exec wrangler delete zudo-composer < /dev/null
corepack pnpm exec wrangler delete zudo-composer-doc < /dev/null
corepack pnpm exec wrangler delete zudo-composer-demo-shop < /dev/null
corepack pnpm exec wrangler delete zudo-composer-demo-landing < /dev/null
corepack pnpm exec wrangler delete zudo-composer-demo-blog < /dev/null
```

If a first deploy is interrupted and only one of `deployments list` or
`versions list` reports the Worker missing, the pipeline refuses to continue.
That is a partial-first-deploy state: stop the workflow, delete the named
target Worker after confirming the target key/config, verify both listings now
report the Worker missing, and rerun the same target. Do not use a versioned
upload or a guessed rollback to repair a partial Worker. A genuinely new
Worker is created by plain `wrangler deploy`, has no rollback target, and gets
the longer first-hostname live-check budget; a failed first live check remains
red and is recovered by a later run after the operator has inspected it.

For a targeted manual run, the `workflow_dispatch` form is:

```text
target=<doc|sample-sg|sample|shop|landing|blog|sample-editor|shop-editor|landing-editor|blog-editor>
run_id=<successful-main-ci-run-id>
sha=<full-main-commit-sha>
```

The guard still checks that the run is successful, belongs to this repository,
was produced by a `main` push, and matches the current `main` head.

### First rollout of a new target

A target whose Worker has never been uploaded has no deployments and no
rollback target, so the versioned path above cannot bootstrap it: `wrangler
deployments list` fails with Cloudflare error `10007`, and `wrangler versions
upload` would not bind the config's `routes` entry even if it succeeded —
triggers are applied by `wrangler deploy`, not by a version upload.

`deploy.mjs` therefore detects that exact state and creates the first
deployment with a plain `wrangler deploy` against the verified artifact, which
creates the script, uploads the assets and binds the custom domain in one call.
Detection is narrow: *both* `deployments list` and `versions list` must report
the script missing. A Worker that answers one and not the other is an
unexplained state and still fails before any mutation. The first version
carries no rollout tag (`wrangler deploy` takes neither `--tag` nor
`--message`), and its active version ID is read back from Cloudflare rather
than parsed from command output.

A first deployment's live check also gets a longer budget (about two minutes of
retries instead of seven seconds): it is waiting on a hostname this very call
created, and a resolver that answers with AAAA before A makes the first fetch
fail outright on an IPv4-only runner. Later rollouts keep the short budget —
their domain already resolves.

Nothing is rolled back when live verification fails on a first deployment —
the only prior state is "the Worker does not exist", which a rollback cannot
restore. The job fails red with the created version named, and the next run
takes the ordinary versioned path against it.

### Cloudflare API token scope

The token in `CLOUDFLARE_API_TOKEN` must be able to create a Worker, upload
static assets, and bind a custom domain in the `zudolab.dev` zone:

| Scope                                  | Why                                                        |
| --------------------------------------- | ----------------------------------------------------------- |
| Account › Workers Scripts › Edit        | create/update all ten Workers and upload their assets      |
| Account › Account Settings › Read       | `wrangler whoami`, the preflight's first call               |
| Zone › Workers Routes › Edit            | attach each `*.zudolab.dev` custom domain to its Worker     |
| Zone › DNS › Edit                       | the CNAME record a custom domain creates                    |
| Zone › Zone › Read                      | resolve the zone behind each domain                         |

Zone scopes are needed only on `zudolab.dev`. A custom domain cannot be bound
while a conflicting DNS record for the same hostname already exists — Wrangler
creates the record itself.

After activation, the live checker fetches the manifest, every emitted asset,
and every route over bounded HTTPS requests — the static-site manifest
`routes` for the four demo sites, the editor manifest and editor route contract
for the four `demo-editor` targets, or the doc-site manifest `routes` for the
documentation and sample-styleguide sites. Navigation route
requests send `Accept: text/html` and `Sec-Fetch-Mode: navigate`; asset requests
do not receive navigation headers. Responses must match the downloaded
manifest's bytes, checksums and MIME types. Cloudflare Web Analytics can inject
its RUM script into navigation HTML. The checker permits only the recognized
empty Cloudflare beacon script immediately before the closing body, then
requires every remaining HTML byte to match. It also fetches the canonical
entry URL without navigation headers and checks the original HTML checksum;
arbitrary scripts or other HTML changes still fail verification. Analytics
remains enabled. On any live failure, automatic
rollback is permitted only if the active version is still this run's known
uploaded version. It restores the exact version captured before the rollout,
verifies that version is active, and leaves the workflow failed so the incident
is visible. If production no longer serves the owned version, the workflow
refuses rollback and fails red for manual intervention.

Activation confirms only Cloudflare's control plane, so a PoP can still answer
the next request from its cache of the previous build. The live checker
therefore retries on a bounded budget of about two minutes, and each attempt
adds its own ordinal to the cache-busting query string so no attempt can be
served the cached response of an earlier one. The comparison never relaxes: a
document that never becomes the built artifact fails at the end of the budget.

A rollout that reached the rollback path had a captured active deployment, so
it was never a partial-first-deploy state and its Worker must not be deleted.
When the rollback itself fails or is refused, the failure names the captured
version to restore manually with the commands below.

For manual recovery, inspect the deployment notes and use the captured version
ID with Wrangler and that target's own Worker name and config file, for
example:

```sh
corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zudo-composer --config wrangler.doc.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zc-sg-sample --config wrangler.sample-sg.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zc-demo-sample --config wrangler.demo-sample.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zc-demo-sample-editor --config wrangler.demo-sample-editor.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zc-demo-shop --config wrangler.demo-shop.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zc-demo-shop-editor --config wrangler.demo-shop-editor.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zc-demo-landing --config wrangler.demo-landing.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zc-demo-landing-editor --config wrangler.demo-landing-editor.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zc-demo-blog --config wrangler.demo-blog.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zc-demo-blog-editor --config wrangler.demo-blog-editor.jsonc --yes
```

Never use an older list entry as an inferred rollback target and never deploy
a directory other than the verified artifact for that exact target (see the
table above).
