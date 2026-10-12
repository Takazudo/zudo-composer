# Hosted Content adapters

The hosted API provides restricted Content editing over one shared durable draft.
It leaves the installed local Composer application and its filesystem providers
intact. The host owns authentication, storage, policy, renderer, Git integration,
builds and deployment. Composer does not provision or call production providers.

The restricted editor derives permitted controls from the host's Content models
and policy. Its portable service, transactional storage and host-renderer boundary
are separate from the browser presentation.

## Supported imports

```ts
import { createHostedContentService, createHostedSiteProjector } from "zudo-composer/hosted-content";
import { mountHostedContentEditor, hostedEditorLabelsJa } from "zudo-composer/hosted-content/editor";
import "zudo-composer/hosted-content/editor.css";
import { createHostedPreviewHost } from "zudo-composer/hosted-content/preview";
import { runHostedContentConformance } from "zudo-composer/hosted-content/testing";
```

| Entry | Runs in | Contents |
| --- | --- | --- |
| `zudo-composer/hosted-content` | Worker or Node (portable, no Preact) | `createHostedContentService`, `HostedContentError`, the command/state/storage types, `canonicalSerialize`, the preview wire schemas and message builders, and the route projection (`projectHostedSite`, `createHostedSiteProjector`) |
| `zudo-composer/hosted-content/editor` | Browser (Preact peer, CodeMirror) | `mountHostedContentEditor`, `HostedContentSession`, `hostedEditorLabels`, `hostedEditorLabelsJa`, `hostedErrorMessages`, `hostedErrorMessagesJa`, and the parent-side preview controller, host receiver and fullscreen helper |
| `zudo-composer/hosted-content/editor.css` | Browser | Explicit stylesheet; the editor never injects CSS itself |
| `zudo-composer/hosted-content/preview` | Browser, framework-free | `createHostedPreviewController` (parent), `createHostedPreviewHost` (visitor frame), `createHostedPreviewFullscreen`; no Preact, CodeMirror or CSS |
| `zudo-composer/hosted-content/testing` | Node test runner | `runHostedContentConformance`, `createMemoryHostedConformanceFactory`, `createMemoryHostedStorage`, the conformance seed and policy builders |

Every entry ships `.d.mts` declarations. They use DOM types only, with no Node
ambient types. `zudo-composer/site-build` remains the Node compilation boundary;
`zudo-composer/site-project` remains types only. No provider credentials,
filesystem implementation or full application controller enters the new entries.
The portable entry compiles the pure Site Project compiler into its projection
helper, but it compiles no source and reads no files.

Use a reachable full Composer package-root Git SHA and install the independent
contract peer separately. The reproducibility fixture uses Node 24, pnpm 11.5.2,
contract root SHA `c0b452da075b66757c60bd0d721a47062d4354d0` (package 1.0.0,
protocol 2) and Preact 10.29.8. ZFB/zudo-sg belong to the host's own independently
locked projects, never the tool's runtime dependency list. Keep the generated
consumer manifests and locks; a workspace link or copied private source is not
an installed-consumer proof.

## Trust and configuration

Construct a service with a fixed site, exact definition identity, trusted policy,
storage, authorization callback, cryptographic digest, ID factory and clock.
Supply a pure `project(providers, approvedAssets)` function and a whole-candidate
`validateSubmission(snapshot)` callback. Either write the projection yourself or
build it with `createHostedSiteProjector(plan)`. The plan holds the fixed
`SiteProject` (templates, outlets, mappings, sitemap, attachments), the
component-pack manifest and, when Content uses managed Assets, the exact Assets
lock captured with the static build. The projector runs the same pure compiler
as `compileStaticSite` over the snapshot's Entries under release policy, and
returns the neutral routes (compiled routes without generated JSX modules) as
render data. `projectHostedSite(plan, providers)` returns `{ status: "ready",
projectId, navigation, routes }` or, for a type-valid incomplete draft that does
not compile, `{ status: "blocked", diagnostics }` as data, never an exception.
Use the same projection and host component in static compilation, styleguide
stories and the isolated preview. Do not compile source in a Worker request.

The definition identity must bind the project/schema/pack/contract versions,
protected structure, asset catalog and policy revision. A baseline binds an exact
canonical Git SHA and integrated content digest. The draft revision is an opaque
string issued by `createId()` for every change; compare it only for equality, never
arithmetically. The storage head `version` is a second opaque token compared by
each commit. These are separate identities; neither a browser edit counter nor a
matching text digest replaces CAS.

Public snapshot responses contain the policy-visible record slice and the trusted
host's approved render projection. The complete delivery candidate stays in the
storage adapter for privileged submission/integration. Its digest identifies that
complete immutable stored candidate; it is not a hash of the filtered browser DTO.

Authenticate every request before calling the service. `authorize` must verify
the current actor's access to the fixed site, including receipt and status reads.
Enforce the host's JWT/session expiry and HTTP same-origin/CSRF rules outside this
library. Do not accept a caller's actor, site, policy, model definition, Git
destination, filesystem path, renderer or capability flags as authorization.
Privileged status and integration methods belong only on the trusted provider
boundary; never expose them as browser mutation endpoints.

For example, the trusted Worker/Node host constructs the service once per fixed
site using its own adapter and canonical configuration:

```ts
import { createHostedContentService } from "zudo-composer/hosted-content";

const service = createHostedContentService({
  siteId: trustedSite.id,
  definition: trustedSite.definitionDigest,
  policy: trustedSite.policy,
  storage: siteStorage, // the host's transactional adapter, not browser storage
  authorize: actor => requireCurrentSiteAccess(actor, trustedSite.id),
  digest: async text => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  },
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  project: projectApprovedHostSite,
  validateSubmission: validateWholeApprovedSite,
});
// These names are host-owned bindings, not values accepted in request JSON.
// Resolve actor from the authenticated session for every request.
const result = await service.execute(authenticatedActor, parsedCommand);
```

Translate `HostedContentError.code` and optional diagnostics across HTTP without
changing their meaning. Treat a transport timeout as an uncertain outcome, not a
definite rejection. The browser transport implements `readState`, `execute`,
`readReceipt` and `getPublication`; map authentication expiry through the editor's
`isAuthenticationExpired` / `onAuthenticationExpired` callbacks. No server actor
or privileged publication callback is supplied by the browser.

## Finite operations and permissions

The service accepts exactly six commands, each carrying an `operationKey` and the
`expected` identities (`draftRevision`, `baseline`, `definition`):

| Command | Effect |
| --- | --- |
| `set-fields` | Replace `values` and remove `clear` field IDs of one permitted Entry |
| `create-entry` | Create an Entry in a declared collection (server-issued ID, optional `before`) |
| `add-entry` | Add an existing permitted Entry to a declared collection |
| `reorder` | Replace the exact membership order of a declared ordered reference-list |
| `capture-snapshot` | Capture the current saved draft as an immutable snapshot |
| `begin-publication` | Accept a captured snapshot for submission (one active per site) |

Anything else, including extra keys, is `invalid-request`. There is no delete,
unpublish, upload, schema edit, raw source or JSON Patch operation.

Policy and UI permissions are separate. The `HostedPolicy` (models with
`entryIds` and a field-permission tree, collections, and the pinned asset
catalog) is enforced by the service on every command. The editor derives its
controls from the same policy, but hiding a control is only a convenience;
rejecting a forbidden change is the service's job. The service throws
`HostedContentError` with one of: `invalid-request`, `invalid-value`, `forbidden`,
`not-found`, `revision-conflict`, `baseline-conflict`, `definition-conflict`,
`operation-key-reuse`, `publication-busy`, `incomplete`, `configuration-required`
or `unavailable` (storage kept refusing the commit; nothing was written and the
exact request may be retried). Conflicts carry no current identities; call
`readState` afterwards.

Permissions use provider/model/Entry/field identities. Object children,
replacement, clearing, list actions and asset selection/descriptions are explicit
permissions. A title edit does not derive a slug. Collection order belongs to a
declared ordered Content reference-list, without Mapping or Sitemap writes.
Creation assigns server IDs/metadata and commits the Entry and membership together.
A pure reorder preserves the exact allowed set once. Model/schema editing,
record deletion, unpublish, upload, raw source and arbitrary JSON Patch are absent.

Approved assets pin version and checksum in snapshots. Selection and per-use
alt/caption/label edits are separately permitted. The host may narrow Markdown
policy through `validateMarkdown`; source is never evaluated as MDX/JSX. Rejected
text is reported rather than silently rewritten.

The built-in check parses the value as CommonMark and rejects raw HTML/JSX nodes,
images, link destinations other than `http(s):`, `mailto:`, `tel:`, a
site-relative path or a fragment, and top-level MDX `import`/`export` statements. Ordinary prose such as
"Our metadata: refreshed weekly", "Big data: trends" or "Use {name} here" is
accepted; braces are literal because hosts must render the value as Markdown
text, not MDX.

## Restricted editor setup

Mount into a host-owned element with the browser `transport`, presentation `policy`,
an initial permitted `{ entry, fieldId }` selection, a host-owned `routeId` and the
preview controller. Import the explicit editor CSS alongside the editor entry.
The default `presentation: "record"` shows the permitted fields for the selected
record; `presentation: "field"` keeps the one-field checkpoint surface. Optional
`labels` replace visible labels without changing schema or permissions.
English is the default. `hostedEditorLabelsJa` is a complete Japanese label set
(pass it as `labels`), and `hostedErrorMessages` / `hostedErrorMessagesJa` are
routine messages per error code (pass either as `errorMessages`). `formatError`
overrides both for host-specific mapping and receives typed diagnostics and
transport failures.

The save state is one of `loading`, `clean`, `dirty`, `saving`, `saved`,
`recovering`, `conflict`, `blocked` or `failed`. `conflict` means the draft,
baseline or definition identity moved and the retained values await review;
`blocked` means the service answered `configuration-required` (the stored
definition differs from the running one), which keeps the values and waits for
the host to adopt the new canonical definition. Any other rejection is `failed`.
Draft, preview and submission are separate facts: the draft is saved or unsaved,
a preview approval is bound to one exact saved snapshot, and a submission is a
separate publication status.

Controls reuse the local tool's scalar form controls and CodeMirror Markdown
source editor; object, list and asset controls are hosted-specific because the
local ones take the full authoring controller, route intents and upload. Text/long text, numeric zero, boolean false, dates, choices, color
and safe URL values remain typed. Objects expose only permitted descendants;
lists respect separate item editing/add/remove/reorder permissions and cardinality
limits. A container `maxLength` does not restrict each item's text. Slugs and
fixed reference structure have no editable control. Collection membership changes
use the declared create/add/reorder commands, not arbitrary reference replacement.
Approved asset selection and per-use descriptions are separate controls. The
Markdown source toolbar does not import the host's ProseMd component or evaluate
MDX/JSX; the full approved site is rendered through the host preview instead.

The handle exposes `ready`, `state`, `subscribe`, `flush`, `navigate`, `refresh`,
`preview`, `submit`, `refreshPublication` and `dispose`. Navigation flushes the
active immutable operation before switching record presentation. It cannot open
the local Composer, Mapping, Sitemap, Assets or schema/developer tools. Create
assigns no browser identity; the service returns the durable new Entry reference
and inserts it into the allowed owning collection atomically.

Provide a `createOperationKey` factory and `persistRecovery` callback that finishes
its durable host checkpoint write before resolving. Restore that checkpoint through
`recovery` on reopen, scoped to the same authenticated site/editor. A successful
submission's operation identity survives reopen so the host can refresh its status.
Preview approval never survives reopen as an acknowledgement of a fresh iframe.
Conflict UI compares retained and authoritative values before explicit reapply or
discard; it cannot discard an unresolved operation that might still commit.
Authentication recovery and provider errors retain the draft and its operation key.
Incomplete numeric typing stays in the mounted control and blocks saving,
preview and navigation until corrected. That transient invalid text is not a
typed Content value or a durable recovery checkpoint; valid edits, staged new
Entries and immutable pending operations are checkpointed.

## Transaction adapter and recovery

`HostedStorage` is four keyed reads plus one conditional write; no transaction stays
open across host code, so it maps directly onto D1 `batch()`:

- `readHead()` returns the single mutable row: an opaque `version`, the working
  `state`, the `baselineProviders` and the active publication ID. Its size follows
  the content, never the history.
- `readReceipt(actorId, operationKey)`, `readSnapshot(id)` and
  `readPublication(id)` read insert-only keyed rows.
- `commit({ expectedVersion, head, receipt?, snapshot?, publication? })` writes
  everything or nothing. It resolves `false`, writing nothing, when the stored
  head version differs from `expectedVersion` or the receipt `(actorId,
  operationKey)` or snapshot ID already exists. It throws only when the outcome
  is unknown or storage failed; a throw after a durable write is recovered
  through the receipt.

The service prepares each change from detached reads, then commits. A refused
commit is retried from fresh reads (at most 16 attempts), where it finds the
newer revision or the committed receipt; exhaustion is the typed `unavailable`
error with nothing written. Every read must return detached data.

D1 mapping: `hosted_head(id = 1, version, state, baseline_providers,
active_publication_id)`; `hosted_receipt` keyed by `(actor_id, operation_key)`;
`hosted_snapshot` and `hosted_publication` keyed by `id`, bodies as JSON text.
Send one `batch()` per commit: an `UPDATE hosted_head … WHERE id = 1 AND version =
?expected`; a guard `INSERT` into an always-empty table that aborts the batch when
that update did not apply (D1 cannot branch in JavaScript between statements);
`INSERT` for the receipt and snapshot; and an upsert for the publication. A
constraint failure rolls the batch back and the adapter resolves `false`.
`fixtures/hosted-content-consumer/sqlite-storage.mjs` shows the exact static
statement list. A receipt stores a copy of the scoped result state, so plan row
size and retention; keys are never pruned or recycled in this version.

The fixture backend uses Node 24 disk-backed SQLite with the same statements in one
short `BEGIN IMMEDIATE` transaction, independent connections/processes and reopen
coverage. D1 remains a downstream implementation. `runHostedContentConformance`
takes a factory whose `create(seed, scenario)` returns a backend with `open()` (an
independent handle exposing `faultNextCommit`, `holdNextCommit` and `dump`),
`restart()` and `close()`. It runs the same scenarios against any adapter,
including commit refusal after an interleaved writer, faults before commit, in
receipt persistence and after a lost acknowledgement, coherent capture,
duplicate creation, competing reorder, two integrations, and external baseline
and definition adoption. A CAS adapter passes the hold/interleave scenarios by
refusing the held commit.

Operation keys are unique within the site and authenticated actor. Fingerprints
bind the exact verb, target, payload and expected identities. Shape validation and
authorization precede receipt recovery. Exact committed replay precedes fresh
model/graph/CAS validation, and the transaction repeats that lookup to resolve
concurrent duplicates. Same key with different bytes is rejected. Do not prune or
recycle keys without a durable expired-key policy; this initial adapter retains them.

A lost response is uncertain. Keep and recover/retry the same original request
before sending a newer dependent edit. A missing receipt alone cannot prove an
in-flight request will never commit. The editor keeps newer local values while
acknowledging older saves and supports host-owned recovery checkpoints. Presentation
disposal does not cancel a server commit. Local unsaved text is not durable until
the host checkpoint or a successful save proves persistence.

Conflicts retain local values. Review authoritative state before explicit reapply
or discard. A definition or baseline change is recovered by the host, never by a
silent overwrite or replacement draft:

- When the running definition differs from the stored one, every write answers
  `configuration-required` (editor phase `blocked`) and the values are retained.
- When canonical Git changed outside a publication (or a new definition was
  deployed), the trusted host calls `service.adoptCanonicalBaseline({ expected:
  { baseline, definition }, baseline, providers, draft: "rebase" | "discard",
  apply })`. `expected` must match the stored identity or it answers
  `baseline-conflict`. An active non-terminal publication answers
  `publication-busy`; record its outcome first. `providers` are the complete
  canonical providers at the new commit and must satisfy the current definition,
  otherwise `configuration-required`.
- `rebase` carries each retained field change that still validates and reports
  every drop with a reason (`entry-removed`, `model-removed`, `field-removed`,
  `canonical-changed`, `invalid-value`, `forbidden`); canonical values changed
  in Git are never overwritten. A draft-created collection Entry whose owner
  membership change is dropped is dropped too (`canonical-changed`), never
  carried as an unlisted orphan. `discard` resets the draft to canonical content.
  `apply: false` returns the same `{ applied, state, carried, dropped }` report
  and writes nothing, so run a dry run first.
- An applied adoption issues a new draft revision, advances the integration fence
  and replaces the baseline providers; editors then `refresh` the state.

## Review and submit an exact snapshot

The sequence is flush → capture saved snapshot → render → matching rendered
acknowledgement → submit that snapshot. Connection readiness alone proves no
render. The protocol checks exact origin/window, protocol, pack/renderer,
frame/session, request, snapshot, route and content identities. Reload invalidates
readiness and replays only the latest request. Disposal clears listeners/timers;
fullscreen retains one iframe and restores focus on close.

The parent owns the iframe element and a `createHostedPreviewController` configured
with that exact window/origin, pack and renderer identity. The visitor frame imports
the isolated preview entry and supplies its real renderer:

```ts
import { createHostedPreviewHost } from "zudo-composer/hosted-content/preview";

const receiver = createHostedPreviewHost({
  hostWindow: window, parent: window.parent, origin: location.origin,
  pack: approvedPackIdentity, renderer: approvedRendererIdentity,
  frameSession: crypto.randomUUID(),
  async render(request, context) {
    // Validate the host-owned route/projection, then use the same component and
    // styles as the real static document and the registered styleguide story.
    if (!context.isCurrent()) return;
    await mountApprovedDocument(request.renderData, request.routeId, context.signal);
    await decodeApprovedImages(context.signal);
    // Resolve only after the actual document and dependencies have committed.
    // Throw on failure; a handshake or a scheduled render is insufficient.
  },
});
receiver.ready();
window.addEventListener("pagehide", () => receiver.dispose(), { once: true });
```

Here `mountApprovedDocument` and `decodeApprovedImages` are host implementation
functions. They must stop stale work when aborted and never replace the snapshot
with a fresh read. The receiver sends the exact bound rendered acknowledgement
after the callback resolves; the parent rejects an obsolete result.

New edits or saves invalidate the old review. A fresh submission checks snapshot
revision, expected revision and live revision inside the storage transaction.
An intervening save conflicts without creating a publication. Exact replay of an
already accepted submission still recovers its original immutable snapshot.

Type-valid incomplete drafts can be saved. Submission additionally enforces
required/nested/accessibility completeness, references and the host's whole fixed
candidate checks. New Entries in allowed collections are included in delivery
copies even while their working lifecycle remains draft. Saving does not publish.

At most one publication is active per site. Saves can continue while it runs.
Status versions are monotonic and facts remain distinct: saved, rendered,
submitted, building, verified, integrated and deployed. Provider uncertainty is
not fabricated success. A build, export or Git merge does not establish deployment.

`begin-publication` commits the accepted operation and its receipt; it does not
perform a Git export or deploy. The host starts/restarts its publisher using that
persisted operation identity after commit. A subsequent provider failure must not
erase or falsify the original accepted command response. Return/recover the same
receipt and report current provider availability separately. In the remote-success
reconciliation gap, recover authenticated exact integration evidence before
recording integrated status; do not infer integration from a browser request.

On privileged exact integration evidence, advance the baseline and draft token
while preserving the latest working values. Only matching submitted generations
and content can become clean. Subsequent publication uses the new baseline.
Duplicate/older callbacks cannot regress the baseline or clear newer work.
The host enforces the exact canonical Git base separately: Git and the database
do not share a transaction. Recover remote success after a host crash from the
original operation's exact commit/content evidence; do not blindly resubmit.

## Unsupported features

These are deliberately absent, not pending:

- Model or schema editing, record deletion, unpublish, upload, raw source or
  JSON Patch, and any route to the local Composer, Mapping, Sitemap or Assets tools.
- Authentication, sessions, CSRF, a hosted HTTP API, a production D1 or other
  database adapter, and production Git, build or deploy providers. The host
  owns all of them; fixtures use loopback fakes and SQLite only.
- Mapping or Sitemap writes. Collection order is a Content reference-list only.
- Evaluating Markdown as MDX/JSX, raw HTML, images in prose (use approved asset
  fields) and executable URL schemes.
- Concurrent publications for one site, and pruning or recycling operation keys.
- Several preview routes per editor mount (one `routeId` per mount), and a
  model-grouped record selector (the selector is flat).
- Conflict resolution actions on the handle: review, reapply and discard are
  editor UI only.
- Compiling source in a Worker request. The projection supports the compiler's
  current limits on global-template collections, single-model attachment,
  `list<text>` binding and static conditions.
- Cross-process correctness from an in-memory test adapter; use a real
  conditional-commit store and run the shipped conformance runner against it.

## Local verification

`pnpm build:hosted` emits committed JavaScript, declarations, chunks and CSS.
`pnpm hosted:check` checks emitted drift, focused scenarios and graph boundaries.
`pnpm hosted:durable` runs the SQLite and persisted local publication-provider
proofs. `pnpm hosted:installed <full-sha> <directory>` creates an independent
consumer, verifies the Worker/Node/durable/shared-renderer boundaries, performs a
fresh frozen reinstall, and runs the real browser checkpoint. `--no-browser`
records that the browser checkpoint remains unverified; it is not a full pass.
The independent fixture lives at `fixtures/hosted-content-consumer` outside the
root workspace. Its installation runner takes a reachable full package Git SHA,
installs the contract separately at the recorded exact root SHA, and retains its
generated manifest/lock for a fresh frozen reinstall. Fixture providers are local
fakes; no production publication or deployment is authorized by these checks.

The independent HTTP transport proof runs real loopback requests against separate
SQLite connections and a persisted synthetic host publication provider. It checks
restart receipts, creation/order, exact saved A while newer B remains editable,
remote integration recovery and baseline advancement. This proves the transport
and provider boundaries; it does not prove DOM interaction or iframe execution.
The non-browser consumer run also bundles the actual public editor/CSS and inspects
the complete esbuild graph for Node, virtual/private application, host-renderer and
host-pack leaks. It checks DOM-only public declarations without Node ambient types
and requires the real CodeMirror Markdown source controls in that bundle.

Record the installed dependency SHA separately from the PR head or merge commit.
An evidence-only later commit may claim payload equivalence only after comparison
of the complete packed payload, including metadata, README, license, declarations,
chunks and CSS. Keep the tested SHA reachable for downstream pins.

## Migrating from the #904 reference API

This section is for hosts, such as Pinsel, that built an adapter on the earlier
#904 reference API (`zudo-composer/content`, `/host-storage`, `/preview-protocol`,
`/export`, `/content-editor`, including its later `preview.sandbox` addition)
and move to the API documented above. Repinning the dependency, the D1 changes
and the downstream Gate-1 revalidation are separate work in the host; nothing
here performs them. The verified package commit for this API is recorded in the
non-shipped handoff record (the evidence directory, the PR body and the #903
comment), not in this file.

### Import and entry mapping

| #904 | Current |
| --- | --- |
| `zudo-composer/content`, `/host-storage`, `/export` | `zudo-composer/hosted-content` (portable service, types, projection) |
| `zudo-composer/preview-protocol` | `zudo-composer/hosted-content/preview` (receiver and controller) and the wire schemas from `zudo-composer/hosted-content` |
| `zudo-composer/content-editor` (TypeScript source, `contentEditorPlugins()` from `zudo-composer/vite`) | `zudo-composer/hosted-content/editor` (prebuilt ESM, Preact peer); drop the Vite plugin and import `zudo-composer/hosted-content/editor.css` explicitly |
| `runContentStorageConformance`, `createMemoryContentDraftStorage` | `zudo-composer/hosted-content/testing` |

The #904 content utilities (`validateSiteProject`, entry validation, digests,
traversal) are no longer public; every check runs inside `service.execute` and the
`validateSubmission` callback. Only `canonicalSerialize` is exported.

### Identities and requests

- `draftRevision` is an opaque string from your `createId()`. Compare it only for
  equality. Remove numeric increments and the `?revision=N` preview URL scheme.
- `snapshot.id` is `createId()` and `snapshot.digest` comes from the injected
  SHA-256, no longer a content-addressed ID.
- The definition identity is a host-computed digest string binding the project,
  schema, pack, contract, asset catalog and policy revision.
- Requests are strict `{ kind, operationKey, expected: { draftRevision, baseline:
  { gitSha, contentDigest }, definition }, … }`; extra keys are rejected.
  `projectId`, `providerId` and `modelId` are no longer request fields: the site
  is fixed in the service and the provider is inside Entry references.
- The actor is `{ id }`. Map the verified subject to `id` and move the allowlist
  check into `authorize(actor)`, which runs on every read including receipts.
- Operations: `put-entry-values` becomes `set-fields` (`values` plus `clear[]`);
  `create-entry` takes no client-minted ID (the server issues it) and a
  `collectionId`; add `add-entry`; `reorder` replaces the exact membership of an
  ordered Content reference-list owned by a declared collection, so replace
  `<model>-order` number fields with that list and read order from it in the
  projection; `delete-entry` is gone.
- Results are no longer status unions. The service resolves a result or throws
  `HostedContentError` with a code (see Finite operations); map codes to HTTP and
  call `readState` after a conflict.
- Policy: rewrite the per-model field list as `HostedPolicy` (`models` with an
  explicit `entryIds` allowlist and a field-permission tree, `collections`, and a
  `assets` catalog pinning `versionId`, `checksum` and `url`). The browser uses
  the same type, so the separate editor policy shape goes away.

### Storage transaction contract

The #904 adapter (`readBaseline`, `readDraft`, `apply`, `readReceipt`, `snapshot`,
`readSnapshot`, `advanceBaseline`) is replaced by `HostedStorage` (`readHead`,
`readReceipt`, `readSnapshot`, `readPublication`, one conditional `commit`). The
commit shape maps to one D1 `batch()` (see Transaction adapter and recovery), but
the narrow #904 operations do not carry over: the service decides what to write
and the adapter only applies it conditionally. A receipt is now `{ actorId,
operationKey, fingerprint, result }` where `result` embeds the scoped state, and
recovery re-executes the exact request. Rewrite the conformance harness around
`runHostedContentConformance`; replace the lock assumption of the old held
transaction with `holdNextCommit` (the held commit must be refused and retried).
Baseline advance moves from `advanceBaseline` to the privileged
`recordConfirmedIntegration({ publicationId, snapshotId, expectedBaseline,
gitSha, contentDigest })`; external Git drift uses `adoptCanonicalBaseline`.

### Mount contract

`mountContentEditor(root, { project, revision, storage, … })` becomes
`mountHostedContentEditor(container, { transport, createOperationKey,
persistRecovery, recovery, isAuthenticationExpired, onAuthenticationExpired,
preview, policy, selection, presentation, routeId, labels, errorMessages,
formatError, onNavigate })`. The handle gains `ready`, `navigate`, `refresh`,
`preview`, `submit` and `refreshPublication`. The `transport` implements
`readState`, `execute`, `readReceipt` and `getPublication`; persist the recovery
checkpoint durably before `persistRecovery` resolves. Save states are `loading`,
`clean`, `dirty` (was `unsaved`), `saving`, `saved`, `recovering`, `conflict`,
`blocked` and `failed`; `load-failed` is not a phase, so surface load errors from
`ready`. Labels: pass `hostedEditorLabelsJa` and `hostedErrorMessagesJa` in place
of `CONTENT_EDITOR_LABELS_JA`.

The host now owns the iframe element. Port the preview client to
`createHostedPreviewController` (parent) and `createHostedPreviewHost` (frame).
Set `sandbox` on the iframe you create and keep it same-origin, because the exact
origin guard needs that. For an SSR-navigation design, a navigation yields a new
`frameSession`: the parent replays the latest request, and the navigated
document's render callback resolves once its server-rendered snapshot equals
`request.snapshotId` (`renderData` may be ignored). Never acknowledge from readiness.
Route projection: replace `compileSiteProjectPlan` / `projectWithContentSnapshot`
with `createHostedSiteProjector(plan)` as the service `project` callback, and
re-run the host's Worker SSR byte-equality check against it.

### D1 adapter obligations

1. Store the head, receipts, snapshots and publications as described above; the
   head `UPDATE … WHERE version = ?` plus an abort-on-miss guard statement must
   be in the same `batch()` as the inserts.
2. `commit` resolves `false`, writing nothing, on a stale head version, or a
   duplicate receipt key or snapshot ID; it throws only for unknown outcomes.
3. All reads return detached data; retain receipts and snapshots and do not
   recycle operation keys; budget row size for the result copy in each receipt.
4. Run `runHostedContentConformance` against the real D1 adapter. A pass against
   a mock does not verify D1.

Pinsel follow-ups outside this API: repin the package, apply the D1 migration,
rebuild the policy and definition digest, and rerun the Gate-1 checks.
