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
import { createHostedContentService } from "zudo-composer/hosted-content";
import { mountHostedContentEditor } from "zudo-composer/hosted-content/editor";
import "zudo-composer/hosted-content/editor.css";
import { runHostedContentConformance } from "zudo-composer/hosted-content/testing";
```

The domain and testing entries are portable. The editor is a separate browser
entry. Hosts with their own rendering framework import the isolated browser
receiver/controller from `zudo-composer/hosted-content/preview`; this entry has
no Preact/CodeMirror or editor CSS dependency. `zudo-composer/site-build` remains the Node compilation boundary;
`zudo-composer/site-project` remains types only. No provider credentials,
filesystem implementation or full application controller enters the new entries.

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
`validateSubmission(snapshot)` callback. The projection is host-owned: include
fixed routes, linked templates, outlets, mappings and collection order there.
Use the same projection and host component in static compilation, styleguide
stories and the isolated preview. Do not compile source in a Worker request.

The definition identity must bind the project/schema/pack/contract versions,
protected structure, asset catalog and policy revision. A baseline binds an exact
canonical Git SHA and integrated content digest. The storage-issued draft token
covers the entire draft and its baseline association. These are separate
identities; neither a browser edit counter nor a matching text digest replaces CAS.

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

## Restricted editor setup

Mount into a host-owned element with the browser `transport`, presentation `policy`,
an initial permitted `{ entry, fieldId }` selection, a host-owned `routeId` and the
preview controller. Import the explicit editor CSS alongside the editor entry.
The default `presentation: "record"` shows the permitted fields for the selected
record; `presentation: "field"` keeps the one-field checkpoint surface. Optional
`labels` replace visible labels without changing schema or permissions.

Controls reuse the local tool's scalar form controls and CodeMirror Markdown
source editor. Text/long text, numeric zero, boolean false, dates, choices, color
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

`HostedStorage.read` returns one coherent detached aggregate. `transaction` holds
a real storage transaction while its callback examines and changes that aggregate,
then commits all records, identities, snapshots, operations and successful receipts
atomically. Roll back the aggregate on any error, including receipt persistence.
An in-memory mutex is only a deterministic test adapter, not cross-process storage.
The fixture backend uses Node 24 disk-backed SQLite with `BEGIN IMMEDIATE`, bounded
busy handling, independent connections/processes and reopen coverage. D1 remains a
downstream implementation; the same shipped conformance runner tests its adapter.

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
or discard. Definition/baseline changes may require developer reconciliation;
never silently overwrite or seed a replacement draft.

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
