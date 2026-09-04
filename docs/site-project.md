# SiteProject operator and API guide

SiteProject is the portable, JSON-safe snapshot that connects the four
authoring products to one publishable site. It is deliberately a whole-project
boundary: a project contains provider declarations, every record those
providers expose, the active Sitemap identity, and the component-pack
requirement used to validate and compile the graph.

## The project graph

The graph is provider-scoped. Every cross-domain reference carries both a
`providerId` and a `recordId`; an ID by itself is never a complete reference.
The `providers` object has four independent domains:

- `compositions`: Composition records and their optional global-template
  bindings.
- `content`: Content models plus their Entry records.
- `mappings`: mappings from Content fields to Composition properties.
- `sitemaps`: page trees whose sources are static Compositions or Mapping route
  families.

Media records and bytes remain global filesystem/provider state in this
milestone. They are not one of the four revision-scoped SiteProject domains and
are outside SiteProject apply/CAS, snapshots, retention, and the JSON-stdin AI
API graph.

`activeSitemap` selects one Sitemap by provider-qualified identity. The
component-pack requirement is checked against the active provider manifest
before any graph is accepted. Validation checks the complete graph, including
provider identities, record envelopes, bindings, fields, mapping targets,
Sitemap sources, and route fields. Compiler diagnostics retain a JSONPath-like
`path`, and may include a route `pathname`, node ID, or selected Entry so an
operator can repair the exact edge that blocked publication.

An `apply` is therefore a complete-project operation. The service validates and
compiles the detached snapshot first, then asks the store to replace one
canonical project revision in one adapter transaction. It never applies one
provider at a time, and a blocked or conflicting apply leaves the prior project
and active pointer unchanged.

## Active identity, revisions, and builds

The local adapter serializes a validated project with canonical UTF-8 JSON and
uses its SHA-256 digest as the revision. Equivalent JSON with different object
key order has the same revision; a real content or graph change gets a new
revision. The active pointer is `{ "projectId", "revision" }` and is compared
with every mutating request using compare-and-swap (CAS) expectations.

Applying an existing project with `expectedRevision` set to its current digest
replaces that exact revision. If the active pointer names the replaced revision,
the pointer advances atomically to the new digest. `activate` changes only the
active pointer after checking that the target revision exists. `discard` deletes
only the expected revision and clears the pointer only when it points at that
target. A stale revision or active expectation returns a `conflict`; fetch a
fresh `list` result and retry with those exact values.

Browser authoring storage is namespaced by the exact active project revision.
Reopening the same revision therefore preserves its local Composer, Content,
Mapping, and Sitemapper edits. Applying a changed snapshot and activating its
new revision selects a clean browser namespace. The local adapter retains only
that current canonical project revision, so the replaced revision is no longer
available through `list`, `get`, `activate`, or `discard`. Its browser namespace
may remain temporarily so reapplying the same digest can recover local edits;
automatic revision-retention cleanup eventually removes inactive namespaces.

Builds are derived artifacts, not mutable project data. `build` reads one exact
project revision, validates and compiles it, and publishes immutable route and
module files under that project/revision identity. A completed build cannot be
silently overwritten by different bytes. Build publication does not change the
active project; call `activate` explicitly when the intended revision is ready.

The CLI writes one canonical JSON response per invocation. Exit status `0`
means `{ "ok": true }`; status `2` means a protocol, validation, compile,
not-found, or CAS conflict response; status `1` means an unavailable storage,
internal, or unexpected CLI failure. An error response always contains the
machine-readable error code and, when applicable, diagnostics.

## JSON-stdin API examples

Run the local adapter with `corepack pnpm site-project:api`. Every request below
is a complete JSON document on stdin. The checked-in sample is a valid input for
the examples that embed `PROJECT_FILE`.

```sh
export PROJECT_FILE=src/site-project/sample/sample-site-project.json
api() { corepack pnpm site-project:api; }
```

Describe the protocol, exact request shapes, capabilities, and active provider
pack:

```sh
api <<'JSON'
{"operation":"describe","protocolVersion":1}
JSON
```

List stored projects, their revisions, and the active identity:

```sh
api <<'JSON'
{"operation":"list","protocolVersion":1}
JSON
```

Fetch one stored revision after setting values from `list` (the revision is a
64-character SHA-256 digest):

```sh
PROJECT_ID=sample-studio-site
REVISION=replace-with-the-64-character-revision
api <<JSON
{"operation":"get","projectId":"$PROJECT_ID","revision":"$REVISION","protocolVersion":1}
JSON
```

Plan an inline project. Planning is read-only and returns the project summary,
route/module summary, empty write diff, and diagnostics:

```sh
node --input-type=module <<'NODE' | api
import { readFileSync } from "node:fs";
const project = JSON.parse(readFileSync(process.env.PROJECT_FILE, "utf8"));
process.stdout.write(JSON.stringify({ protocolVersion: 1, operation: "plan", source: { kind: "inline", project } }));
NODE
```

Plan an already stored revision without sending the project bytes again:

```sh
PROJECT_ID=sample-studio-site
REVISION=replace-with-the-64-character-revision
api <<JSON
{"operation":"plan","protocolVersion":1,"source":{"kind":"stored","projectId":"$PROJECT_ID","revision":"$REVISION"}}
JSON
```

Create or replace a project with a guarded whole-project apply. Use `null` for
both expectations only when creating a project and when the active pointer is
known to be empty:

```sh
node --input-type=module <<'NODE' | api
import { readFileSync } from "node:fs";
const project = JSON.parse(readFileSync(process.env.PROJECT_FILE, "utf8"));
process.stdout.write(JSON.stringify({
  protocolVersion: 1,
  operation: "apply",
  project,
  expectedRevision: null,
  expectedActive: null,
}));
NODE
```

Build an exact stored revision and receive its immutable route/module plan:

```sh
PROJECT_ID=sample-studio-site
REVISION=replace-with-the-64-character-revision
api <<JSON
{"operation":"build","protocolVersion":1,"projectId":"$PROJECT_ID","revision":"$REVISION"}
JSON
```

Activate a built (or otherwise stored) revision with an active-pointer CAS:

```sh
PROJECT_ID=sample-studio-site
REVISION=replace-with-the-64-character-revision
EXPECTED_ACTIVE=null
api <<JSON
{"operation":"activate","protocolVersion":1,"projectId":"$PROJECT_ID","revision":"$REVISION","expectedActive":$EXPECTED_ACTIVE}
JSON
```

Guarded discard removes one exact revision. It does not discard any other
project or revision:

```sh
PROJECT_ID=sample-studio-site
REVISION=replace-with-the-64-character-revision
EXPECTED_ACTIVE='{"projectId":"sample-studio-site","revision":"replace-with-the-64-character-revision"}'
api <<JSON
{"operation":"discard","protocolVersion":1,"projectId":"$PROJECT_ID","expectedRevision":"$REVISION","expectedActive":$EXPECTED_ACTIVE}
JSON
```

When a mutation returns exit `2` with `error.code` `conflict`, do not guess a
revision. Run `list`, choose the desired project and its current revision,
reuse the returned active object as `expectedActive`, then retry `apply`,
`activate`, or `discard`. A `not-found` response means the requested revision
was removed or never existed; re-list before retrying. Validation and compile
responses include diagnostics; repair the referenced path and plan again before
applying.

## Checked-in sample and local development

The canonical sample lives at
`src/site-project/sample/sample-site-project.json`. After an intentional edit,
run the focused SiteProject tests and inspect the deterministic serialization:

```sh
corepack pnpm site-project:check
node --input-type=module <<'NODE' | corepack pnpm site-project:api
import { readFileSync } from "node:fs";
const project = JSON.parse(readFileSync(process.env.PROJECT_FILE, "utf8"));
process.stdout.write(JSON.stringify({ protocolVersion: 1, operation: "plan", source: { kind: "inline", project } }));
NODE
```

For a real plan/apply, use the inline Node request shown above with that file,
capture its returned `projectId` and `revision`, run the stored `build` example,
then run the guarded `activate` example with that revision before opening the
dev browser flow:

```sh
corepack pnpm build
corepack pnpm deployment:manifest
corepack pnpm smoke:local
```

During `vite` development, the read-only virtual source resolves the active
local project. The machine-isolated browser lane sets
`ZUDO_SITE_PROJECT_ROOT` to a disposable root, applies and activates the
sample through the JSON CLI, starts Vite, and checks that the virtual module and
`/site` use that active revision. The Vite watcher follows that same root, so a
later guarded CLI activation can invalidate the virtual source as well. To run
the same flow manually, export the root for both CLI and Vite processes:

```sh
export ZUDO_SITE_PROJECT_ROOT=/absolute/path/to/a-disposable-site-project-root
corepack pnpm dev
```

The path may sit behind a symlinked ancestor directory (macOS `TMPDIR`
resolves this way); only the final path component itself must be a real
directory, not a symlink.

Production `vite build` always serializes the bundled sample passed in
`vite.config.ts`; it does not read the local store, active pointer, Vite dev
bridge, CLI, Node modules, or arbitrary local project files.

The checked-in sample is reviewable production input. Local project files and
derived builds are disposable operator state under the ignored
`.zudo-site-project/` layout (or the explicitly supplied disposable root).
They are not deployment inputs and must not be committed. Cloudflare-backed
persistence, a hosted SiteProject API, and authentication/authorization are
future adapter work; they are not claims made by this local CLI or the
assets-only Worker.

## Browser acceptance commands

The dev acceptance helper provisions an isolated root, performs CLI apply and
activate, and runs the Vite development virtual-source crawl. The production
helper provisions a different disposable active project but serves the one
already-built `dist` through local Wrangler, proving that production still
renders the bundled sample:

```sh
bash "$HOME/.claude/scripts/playwright-guard.sh" --wait 300 -- \
  corepack pnpm test:browser:site-project

# Run only after the one production build; this lane does not rebuild.
bash "$HOME/.claude/scripts/playwright-guard.sh" --wait 300 -- \
  corepack pnpm test:browser:site-project:dist
```

The normal production command remains `corepack pnpm test:browser:dist`; its
direct-preview test keeps `/composer/preview` isolated from host navigation.
The acceptance crawl checks `/site` plus every canonical nested sample route:
`/site/about`, `/site/services`, `/site/journal`,
`/site/journal/map-the-moving-parts`,
`/site/journal/review-in-small-loops`, and
`/site/journal/start-with-the-question`.
