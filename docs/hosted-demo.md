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

## Production rollout

The production workflow is `.github/workflows/hosted-demo-deploy.yml`. A
successful `main` run of `CI` is its only automatic trigger. It downloads the
artifact whose name contains that run's full commit SHA, verifies the artifact
again, and passes the same `dist-hosted-demo` directory to Wrangler. The
workflow is serialized so two production changes cannot overlap. A manual run
requires both `run_id` and `sha` for a successful same-repository `main` CI run;
the guard is loaded from a fresh trusted `main` checkout before the selected
artifact checkout is used.

The deploy step requires both `CLOUDFLARE_ACCOUNT_ID` and a Cloudflare API
token. It fails visibly when either is absent or partial. Local Wrangler OAuth
sessions are useful for read-only checks and must never be copied into GitHub
secrets. The checked-in [`wrangler.jsonc`](../wrangler.jsonc) keeps the
`zudo-composer` Worker, `workers_dev: false`, `preview_urls: false`, and the
existing `zudo-composer.zudolab.dev` custom-domain binding. The compatibility
date is pinned in that file; no account ID or credential is committed.

Before any upload, the workflow runs `wrangler deploy --dry-run`, checks the
active deployment and its single 100% version, and records that exact version as
the rollback target. It then runs `wrangler versions upload` against the
verified artifact with a unique run tag. Activation is requested only for the
version ID returned by that upload (`versions deploy <id>@100 --yes`). A missing
upload ID stops before activation. A command failure after Cloudflare accepts
the replacement still has the known ID available for the ownership check.

After activation, the live checker fetches the manifest, every emitted asset,
and every authoring/sample route over bounded HTTPS requests. Navigation route
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
ID with Wrangler, for example:

```sh
corepack pnpm exec wrangler rollback <captured-version-id> \
  --name zudo-composer --config wrangler.jsonc --yes
```

Never use an older list entry as an inferred rollback target and never deploy a
directory other than the verified `dist-hosted-demo` artifact.
