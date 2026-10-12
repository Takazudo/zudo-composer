# Hosted content authoring

The portable half of hosted content authoring (Takazudo/zudo-composer#903):
the public entries a host such as Pinsel uses to validate, project, authorize,
store, preview and export Content edits from a browser or a Worker, without
the Node filesystem tool. The restricted editor mount is milestone 2 and will
be documented here when it lands.

Nothing in this document changes the locally installed tool. Hosted
persistence, authentication, the actual D1 schema, the Git/PR workflow and
deployment remain the host's responsibility; Composer defines the contracts and
proves them with a memory reference implementation and a conformance suite.

## Public entries

| Subpath | Runs in | Contents |
| --- | --- | --- |
| `zudo-composer/content` | browser, Worker, Node | Content/SiteProject validation, canonical serialization, portable route projection, the restricted mutation boundary, the Markdown safety policy |
| `zudo-composer/host-storage` | browser, Worker, Node | `ContentDraftStorageAdapter` contract, the memory reference adapter, the conformance suite and its fixture baseline |
| `zudo-composer/preview-protocol` | browser (parent and iframe) | strict preview envelope/guards, message constructors, `createHostPreviewBridge` |
| `zudo-composer/export` | browser, Worker, Node | `ContentExportAdapter` contract, submission validation, deterministic fake |

All four are built by `pnpm build:public` with the platform-neutral profile:
no Node target, no Node externals, and declarations emitted against
`ES2023 + WebWorker` only (`tsconfig.public-portable.json`). The committed
output is proven by `pnpm portable:scan`, which reads the emitted
`server/*.mjs` graph and asserts that every import is relative or one of
`@zudo-composer/component-contract`, `zod`, `@lezer/markdown`, and that the
whole graph type-checks with no free reference to any non-Worker global
(`window`, `document`, `localStorage`, `process`, `require`, `Buffer`, …).
`pnpm typecheck:public` pins every value and type name of the four entries in
`type-tests/public-entry-exports.json`; a new export is a deliberate review.

The Node entries (`zudo-composer/authoring`, `zudo-composer/site-build`,
`zudo-composer/editing`, `zudo-composer/vite`, the bin) are unchanged.
`validateSiteProject` and `canonicalStringifyJson` are the same functions on
both `authoring` and `content`.

## Route projection

`compileSiteProjectPlan(project, componentPack, { policy, assetLock })`
validates an untrusted project value against the pack manifest and runs the
same compiler the Node `compileStaticSite` façade runs, returning a
`SiteProjectPlan`: `navigation`, `activeSitemap` and `routes[]` with
`composition.document`, `composition.linkedSource`, `materializationSources`,
`selectedEntry`, `ancestors` and `displayTitle`. It never generates
`modules[].code`: the compiler receives the JSX planner only through the Node
index wrapper, so the portable graph does not carry the generator. A Worker
projects a saved snapshot to route documents; the host's own renderer turns a
document into HTML.

Parity is tested: for the same project, `compileSiteProjectPlan` equals
`compileStaticSite(...).build` with modules stripped
(`server/__tests__/portable-parity.test.ts`,
`src/hosted-content/__tests__/compile.test.ts`, and the installed-host probe).
`compileStaticSite` remains the build-time facade and the release gate: it
captures the asset lock from the host asset store and still runs module
generation, whose failures are release diagnostics the portable plan does not
report. Under the default `release` policy every managed asset reference must
be pinned by the `assetLock` the host passes; `authoring-preview` renders
drafts and unpinned assets.

## Restricted mutation and host policy

`authorizeContentMutation(policy, actor, request, snapshot, { now })` is pure.
Inputs:

- `HostContentPolicy` — trusted host configuration: `projectId`,
  `providerId`, per-model `fields` (editable field ids) and `operations`
  (a subset of `put-entry-values`, `create-entry`, `delete-entry`, `reorder`),
  an optional approved asset allowlist (`assets.providerId`, `assets.assetIds`)
  and optional Markdown policy overrides.
- `HostContentActor` — `{ subject }` verified by the host before the request is
  read. A missing actor is `forbidden`.
- `request` — untrusted JSON. Exactly the keys of one request kind, with
  stable ids and the `expectedRevision` (the Content snapshot mutation token)
  it was prepared against. Any extra key, including `role`, `policy`,
  `actor`, `schema`, `model` or `capabilities`, is `malformed-request`.
- `snapshot` — the current `ContentSnapshot` of the draft.

Request kinds:

| Kind | Effect |
| --- | --- |
| `put-entry-values` | merges permitted field values into an existing entry |
| `create-entry` | creates a draft entry under a caller-supplied safe id |
| `delete-entry` | deletes an entry nothing else references |
| `reorder` | rewrites one permitted top-level `number` field across every entry of the model, in the listed order |

Refusal codes: `malformed-request`, `forbidden`, `wrong-project`, `stale`,
`unknown-model`, `unknown-field`, `not-found`, `conflict`, `invalid-value`,
`unsafe-reference`. A model outside the policy is `forbidden` whether or not it
exists; a policy-listed model missing from the snapshot is `unknown-model`.
References must target existing entries of the same provider and never the
entry itself; `asset-use` values must name an approved catalog asset; typed
values go through the real `isValueValidForField`. The result on success is a
`ContentMutation` of `put-entry`/`delete-entry` operations only: component,
schema, template, mapping and sitemap records are unreachable from this role.

### Markdown

`markdown` values (including those nested in `object` and `list` fields) pass
`diagnoseMarkdownValue` under `DEFAULT_MARKDOWN_CONTENT_POLICY` unless the
policy overrides it: raw HTML, comments and processing instructions are
refused (`allowHtml` is the literal `false`), images are refused unless
`allowImages`, link destinations in inline links, reference definitions and
autolinks must be relative or use one of `allowedLinkProtocols`
(`http:`, `https:`, `mailto:`, `tel:`), protocol-relative and entity/control
obfuscated schemes are refused, and `maxLength` bounds the text. This is a
textual policy, not a renderer sanitizer: the host renderer must still produce
sanitized HTML.

## Storage adapter contract

`ContentDraftStorageAdapter` (`zudo-composer/host-storage`):

| Method | Responsibility |
| --- | --- |
| `readBaseline()` | the integrated project and its `baselineRevision` (host identity, e.g. a Git commit) |
| `readDraft()` | the draft `ContentSnapshot`, its `draftRevision` and the baseline it tracks |
| `apply({ operationId, actor, mutation, expectedDraftRevision, expectedBaselineRevision })` | compare both revisions and the operation id, then write, under one transaction boundary |
| `readReceipt(operationId)` | the durable receipt of an applied operation |
| `snapshot({ expectedDraftRevision })` | capture an immutable project at that revision, named by content digest |
| `readSnapshot(snapshotId)` | read a captured snapshot |
| `advanceBaseline({ baseline, expectedBaselineRevision, integratedSnapshotId })` | move the integrated base after the host proved integration |

Results reuse the release adapter vocabulary: `ok`, `not-found`,
`unavailable`, `conflict` (with `reason` `draft-revision` /
`baseline-revision` / `operation-id` and the current identities), plus
`rejected` (the storage transaction refused the mutation; nothing written) and
`uncertain` (the write may have reached storage; recover through
`readReceipt`).

Rules the conformance suite enforces:

- A losing precondition writes nothing: no revision, no receipt, no partial
  collection change. Both revisions and the operation id are compared in the
  same critical section as the write.
- A duplicate `operationId` with an identical request replays the receipt
  (`replayed: true`) and never applies twice; the same id with a different
  request is a conflict. A lost acknowledgement is recovered through
  `readReceipt` and an idempotent retry.
- Concurrent saves against one revision admit exactly one winner.
- Snapshots are immutable, content-addressed (`sha256` of the canonical
  project) and bound to one draft revision; a snapshot against a superseded
  revision conflicts.
- `advanceBaseline` always moves the draft revision. A draft at the integrated
  snapshot's revision is rebuilt from the new baseline; a draft with newer
  unsent edits keeps them and only adopts the new baseline identity. A save
  racing an advance loses cleanly.

Two independent writes are never one transaction and an in-memory queue is not
a cross-process guarantee. The memory adapter
(`createMemoryContentDraftStorage`) proves the semantics on the real
`TransactionalContentStore` over an in-memory record store; a host proves its
own durability by running
`runContentStorageConformance(factory, { test: it })` against its real adapter
(for example D1, with every statement gated on the precondition inside one
batch). The suite is dependency-free; without a harness it runs sequentially
and throws the first failure. `createContentStorageConformanceBaseline()` is
the fixture project each factory seeds from.

## Preview protocol

`zudo-composer/preview-protocol` carries identities only. The parent posts
`render { snapshotId, revision, route, frameLoadId }`; the iframe fetches the
rendered document for that snapshot/route from the host and answers
`ready { frameLoadId }` on every load, `rendered { snapshotId, revision, route,
frameLoadId }` or `error { …, message, recoverable }`. Every inbound message
passes the source gate, then the exact-origin gate, then a strict zod schema
(any extra key, a wrong channel or protocol version, or a mismatched pack
identity is dropped). Outbound messages use the exact iframe origin.

`createHostPreviewBridge({ frame, origin, hostWindow, pack, … })`:

- `preview(target)` retains the newest target. Before the frame's `ready`, it
  is held, not queued: a newer target replaces an older one.
- `ready` carries the frame's own `frameLoadId`; the bridge adopts it and
  replays the retained target under it, so a reload is answered.
- `rendered` is accepted only when `snapshotId`, `revision`, `route` and
  `frameLoadId` all equal the outstanding request. A late acknowledgement from
  a previous load, route or revision is reported through `onStale` and changes
  nothing, so it can never mark a newer edit as previewed.
- A matching `error` moves the state to `error`; an error about another
  identity is reported but does not alter the state. A pack mismatch makes the
  bridge terminal.

`state` is `idle | pending | rendered | error` with the exact request, which is
the truthful source for "previewed" in a UI.

## Export / status adapter

`ContentExportAdapter` (`zudo-composer/export`): `submit({ snapshotId,
projectRevision, baselineRevision, packageIdentity, idempotencyKey })` →
`{ operationId }`, `status(operationId)` → `{ state, snapshotId,
baselineRevision, evidence?, message?, updatedAt }` with `state` one of
`submitted | building | verified | integrated | deployed | failed | conflict`.
`validateContentExportSubmission` accepts exactly those keys: digests must be
`sha256` hex, revisions and keys are short opaque tokens, and the package
identity is a package-like id. No repository name, branch, path, command or
URL is representable, so editable content cannot steer an export. Evidence
(`commit`, `pr`, `buildId`, `checks`) is whatever the host proved; no state
name alone implies a live website.

`createFakeContentExportAdapter()` is the deterministic sink for tests: ids
derive from the idempotency key, a repeated identical submission replays, a
different one under the same key conflicts, and states move only through
`advance()`.

## Verification

```sh
corepack pnpm public:check          # committed Node and portable outputs are current
corepack pnpm portable:scan         # emitted portable graph is Worker/browser-safe
corepack pnpm typecheck:public      # public type and value surfaces are pinned
corepack pnpm test                  # policy, protocol, storage conformance, export, projection parity
corepack pnpm public:installed      # packed install outside the repository runs the extended probe
corepack pnpm verify-root-git-install [-- --sha <40-hex>]
```

`verify-root-git-install` proves the whole-root Git install Pinsel pins: in a
temporary directory outside the repository it runs
`pnpm add zudo-composer@git+https://github.com/Takazudo/zudo-composer.git#<sha>`
together with the component contract's package-root commit from
`contract-handoff.json`, asserts the lockfile records both full commits and no
`file:`/`link:`/`workspace:`/`path:` entry, reinstalls with
`--frozen-lockfile`, imports every public subpath, checks the installed
portable output byte for byte against the checkout, and runs the same probe
and strict consumer type checks as `public:installed`. The commit must already
be reachable on GitHub; the proof reports the exact spec it installed.
