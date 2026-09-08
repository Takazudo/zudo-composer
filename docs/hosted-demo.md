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

Media export is explicit: `scripts/hosted-demo/prepare.ts` allowlists four exact
committed `cms/media` PNG records and SHA-256 values. It verifies record shape,
MIME signature, length, checksum and real file paths, and exports only those
immutable versions. Committing media alone does not publish it: the hosted build
must export and deploy the assets. No uploads are sent to a server.

Media metadata retains the regular canonical `/uploaded-media/` URLs. The demo-only
service worker holds no data, cache or database. It requests bytes from the exact
requesting client, with a four-second timeout. Unknown authoring URLs and unknown
immutable uploads fail closed; the four immutable bundled assets remain public.
The isolated Composer iframe forwards media requests only to its matching host.
Setup waits at most ten seconds for control and reports initialization failures.

Same-tab working preview and `/site` keep the current integration. Ctrl/Command-click,
Shift-click or a link targeting a new window opens a one-use, random-token handoff;
the opener validates both origin and window identity, flushes sessions and captures
a coherent current project plus all media bytes. Other tabs cannot request it.
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
- Check `/review`, `/composer`, `/media`, `/website-preview`, `/site` and nested site
  routes at desktop/narrow widths and light/dark themes. Confirm four images, image
  inspector/preview, upload/replace, snapshots, new-window changed project/media,
  unrelated-tab isolation and reload reset. The browser runner must use the
  machine-wide Playwright guard.
- Run ordinary `pnpm build && pnpm dist:boundary`; ordinary output must contain no
  hosted demo seed, worker, manifest or uploaded demo exports.

Deployment gates must validate this exact artifact before publishing its bytes.
