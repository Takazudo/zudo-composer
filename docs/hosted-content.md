# Hosted Content adapters

The hosted API provides restricted Content editing over one shared durable draft.
It leaves the installed local Composer application and its filesystem providers
intact. The host owns authentication, storage, policy, renderer, Git integration,
builds and deployment. Composer does not provision or call production providers.

## Supported imports

```ts
import { createHostedContentService } from "zudo-composer/hosted-content";
import { mountHostedContentEditor } from "zudo-composer/hosted-content/editor";
import "zudo-composer/hosted-content/editor.css";
import { runHostedContentConformance } from "zudo-composer/hosted-content/testing";
```

The domain and testing entries are portable. The editor is a separate browser
entry. `zudo-composer/site-build` remains the Node compilation boundary;
`zudo-composer/site-project` remains types only. No provider credentials,
filesystem implementation or full application controller enters the new entries.

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

Authenticate every request before calling the service. `authorize` must verify
the current actor's access to the fixed site, including receipt and status reads.
Enforce the host's JWT/session expiry and HTTP same-origin/CSRF rules outside this
library. Do not accept a caller's actor, site, policy, model definition, Git
destination, filesystem path, renderer or capability flags as authorization.
Privileged status and integration methods belong only on the trusted provider
boundary; never expose them as browser mutation endpoints.

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
The independent fixture lives at `fixtures/hosted-content-consumer` outside the
root workspace. Its installation runner takes a reachable full package Git SHA,
installs the contract separately at the recorded exact root SHA, and retains its
generated manifest/lock for a fresh frozen reinstall. Fixture providers are local
fakes; no production publication or deployment is authorized by these checks.

Record the installed dependency SHA separately from the PR head or merge commit.
An evidence-only later commit may claim payload equivalence only after comparison
of the complete packed payload, including metadata, README, license, declarations,
chunks and CSS. Keep the tested SHA reachable for downstream pins.
