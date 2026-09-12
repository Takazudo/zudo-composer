# Disposable hosted demo

`pnpm build:hosted-demo` builds the explicit demo adapter into `dist-hosted-demo`.
The ordinary `pnpm build`, installed package and local development endpoints keep
their existing behavior. The demo publishes no filesystem APIs or release server.

The demo seeds `src/hosted-demo/sample-project.json`, an explicit public sample
compatible with the configured component pack. It never reads an activated local
SiteProject, arbitrary host directories, or browser databases. Content, Mapping,
Sitemap and Composition records live in this tab's memory. Reloading resets them;
new independent tabs start from the sample. Export working JSON to retain edits.
Review inspection/export works; local staging, build and activation remain disabled.

Assets export is explicit: `scripts/hosted-demo/prepare.ts` allowlists four exact
committed `cms/assets` PNG records and SHA-256 values. It verifies record shape,
MIME signature, length, checksum and real file paths, and exports only those
immutable versions. Committing assets alone does not publish it: the hosted build
must export and deploy the assets. No uploads are sent to a server.

Assets metadata retains the regular canonical `/uploaded-assets/` URLs. The demo-only
service worker holds no data, cache or database. It requests bytes from the exact
requesting client, with a four-second timeout. Unknown authoring URLs and unknown
immutable uploads fail closed; the four immutable bundled assets remain public.
The isolated Composer iframe forwards asset requests only to its matching host.
Setup waits at most ten seconds for control and reports initialization failures.

Same-tab working preview and `/site` keep the current integration. Ctrl/Command-click,
Shift-click or a link targeting a new window opens a one-use, random-token handoff;
the opener validates both origin and window identity, flushes sessions and captures
a coherent current project plus all asset bytes. Other tabs cannot request it.
The bootstrap also exposes `mountPreviewFrame(frame, url)` for the same scoped handoff into an attached working-preview iframe. The preview receives a snapshot, and reloading it resets to the public sample.

Build output includes `hosted-demo-manifest.json` with the full **40-character Git
sourceRevision**, the separate **64-character projectSourceRevision**, and SHA-256 checksums of every final deployable file except the
manifest itself. The workspace baseline is separately computed from canonical
SiteProject JSON as a **64-character SHA-256 project revision**. These are different
identities and must never be substituted for one another.

Verification for the deployment/acceptance lane:

- `pnpm exec vitest run src/hosted-demo scripts/hosted-demo`
- `pnpm build:hosted-demo`
- `pnpm hosted-demo:verify` (optionally pass the artifact directory and expected Git SHA)
- Serve `dist-hosted-demo` with SPA fallback and correct PNG/WASM MIME types on HTTPS
  (or loopback for testing), then verify all manifest hashes including `index.html`.
- Check `/review`, `/composer`, `/assets`, `/website-preview`, `/site` and nested site
  routes at desktop/narrow widths and light/dark themes. Confirm four images, image
  inspector/preview, upload/replace, snapshots, new-window changed project/assets,
  unrelated-tab isolation and reload reset. The browser runner must use the
  machine-wide Playwright guard.
- Run ordinary `pnpm build && pnpm dist:boundary`; ordinary output must contain no
  hosted demo seed, worker, manifest or uploaded demo exports.

Deployment gates must validate this exact artifact before publishing its bytes.

## Four deploy targets, one pipeline

The trusted-run deploy pipeline (`scripts/hosted-demo/deploy.mjs`,
`live-check.mjs` and `scripts/check-hosted-demo.mjs`) deploys four independent
Cloudflare Workers, each on its own custom domain:

| Target key      | Worker                        | Config file                       | Domain                       | Artifact directory                    |
| ---------------- | ------------------------------ | ---------------------------------- | ----------------------------- | -------------------------------------- |
| `zudo-composer`  | `zudo-composer`                | `wrangler.jsonc`                   | `zudo-composer.zudolab.dev`  | `dist-hosted-demo`                     |
| `webshop`        | `zudo-composer-demo-shop`      | `wrangler.demo-shop.jsonc`         | `zc-demo-shop.zudolab.dev`      | `packages/demo-webshop/dist-site`      |
| `landing`        | `zudo-composer-demo-landing`   | `wrangler.demo-landing.jsonc`      | `zc-demo-landing.zudolab.dev`   | `packages/demo-landing/dist-site`      |
| `blog`           | `zudo-composer-demo-blog`      | `wrangler.demo-blog.jsonc`         | `zc-demo-blog.zudolab.dev`      | `packages/demo-blog/dist-site`         |

`scripts/hosted-demo/targets.mjs` is the single place naming these four rows
and each target's artifact-verification shape. The `zudo-composer` target
verifies `dist-hosted-demo` against the hosted-demo manifest contract above;
the other three verify a `dist-site` directory (built by `pnpm demo:build-site
<webshop|landing|blog>`, see [`docs/demo-sites/README.md`](./demo-sites/README.md))
against the static-site manifest contract in
[`scripts/site-static/artifact.mjs`](../scripts/site-static/artifact.mjs) —
`site-manifest.json` instead of `hosted-demo-manifest.json`, and a live route
list read from that manifest's own `routes` array instead of the fixed
authoring/sample list. `deploy.mjs`'s `preflightDeployment`/`deployHostedDemo`
and `live-check.mjs`'s `verifyLiveDeployment`/`verifyLiveWithRetries` take an
optional `target` (or the lower-level `manifestFileName`/`artifactVerifier`/
`liveRoutes` a target supplies); every default falls back to the
`zudo-composer` target, so existing single-target calls are unchanged.
`scripts/hosted-demo/workflow-guard.mjs` needed no target parameter at all —
its trusted-run checks (successful same-repo `main` CI run, fresh `main` head)
never touch an artifact, a Worker name or a Cloudflare config, so the same
guard step runs unmodified for every target.

Target selection for the CLIs is the `HOSTED_DEMO_TARGET` environment variable
(default `zudo-composer`): `HOSTED_DEMO_TARGET=webshop pnpm hosted-demo:verify`
and `HOSTED_DEMO_TARGET=webshop pnpm hosted-demo:deploy` operate on the
webshop's Worker, config and artifact directory instead.

## Production rollout

The production workflow is `.github/workflows/hosted-demo-deploy.yml`, run as
a matrix of the four targets above. A successful `main` run of `CI` is its
only automatic trigger. Each matrix leg downloads the artifact whose name
contains that target's prefix (`hosted-demo-` or `demo-site-<name>-`) and that
run's full commit SHA, verifies the artifact again, and passes the matching
directory to Wrangler. Each target has its own concurrency group
(`hosted-demo-production-<target>`), so two rollouts of the *same* target
cannot overlap, but the four targets can roll out concurrently with each
other. A manual run requires both `run_id` and `sha` for a successful
same-repository `main` CI run; the guard is loaded from a fresh trusted `main`
checkout before the selected artifact checkout is used, once per matrix leg.

The deploy step requires both `CLOUDFLARE_ACCOUNT_ID` and a Cloudflare API
token. It fails visibly when either is absent or partial. Local Wrangler OAuth
sessions are useful for read-only checks and must never be copied into GitHub
secrets. The checked-in [`wrangler.jsonc`](../wrangler.jsonc),
[`wrangler.demo-shop.jsonc`](../wrangler.demo-shop.jsonc),
[`wrangler.demo-landing.jsonc`](../wrangler.demo-landing.jsonc) and
[`wrangler.demo-blog.jsonc`](../wrangler.demo-blog.jsonc) each keep
`workers_dev: false`, `preview_urls: false`, and that target's own
custom-domain binding. The compatibility date is pinned in each file; no
account ID or credential is committed to any of them.

Before any upload, the workflow runs `wrangler deploy --dry-run`, checks the
active deployment and its single 100% version, and records that exact version as
the rollback target. It then runs `wrangler versions upload` against the
verified artifact with a unique run tag. Activation is requested only for the
version ID returned by that upload (`versions deploy <id>@100 --yes`). A missing
upload ID stops before activation. A command failure after Cloudflare accepts
the replacement still has the known ID available for the ownership check.

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
| Account › Workers Scripts › Edit        | create/update each Worker and upload its assets             |
| Account › Account Settings › Read       | `wrangler whoami`, the preflight's first call               |
| Zone › Workers Routes › Edit            | attach `*.zudolab.dev` custom domains to a Worker           |
| Zone › DNS › Edit                       | the CNAME record a custom domain creates                    |
| Zone › Zone › Read                      | resolve the zone behind each domain                         |

Zone scopes are needed only on `zudolab.dev`. A custom domain cannot be bound
while a conflicting DNS record for the same hostname already exists — Wrangler
creates the record itself.

After activation, the live checker fetches the manifest, every emitted asset,
and every route over bounded HTTPS requests — the fixed authoring/sample list
for `zudo-composer`, or that target's own manifest `routes` for the three
static sites. Navigation route
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

For manual recovery, inspect the deployment notes and use the captured version
ID with Wrangler and that target's own Worker name and config file, for
example:

```sh
corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zudo-composer --config wrangler.jsonc --yes

corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zudo-composer-demo-shop --config wrangler.demo-shop.jsonc --yes
```

Never use an older list entry as an inferred rollback target and never deploy
a directory other than the verified artifact for that exact target (see the
table above).
