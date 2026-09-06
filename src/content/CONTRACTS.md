# Content contracts

All public contracts are exported from `src/content/index.ts`; model and library
subpaths remain headless. This is one current schema, without older-schema
readers or migrations. Model documents require `description`. Entry envelopes
require `lifecycle: "draft" | "published"` and `generation: number`.

## Schema and values

`ContentFieldDefinition` intersects stable `{id,key,label,required}` metadata
with the discriminated `ContentValueSchema`. Keys/labels may be edited; values
are always keyed by field ID, including fields inside objects. Nested schema
depth is bounded at 16. Models retain collection/single cardinality.

- Scalars: text, long-text, markdown, number, boolean, date, slug, color, URL.
- `choice`: nonempty unique `{value,label}` options; stored value is a choice
  string. An empty string can be saved but is incomplete when required.
- `reference`: `target: {providerId,recordId}` identifies the target model.
  Stored value is `{providerId,modelId,recordId}`. Absence means no reference.
- `reference-list`: same target plus required `ordered: boolean`. Values are
  unique references. Stored order is always preserved, including ordered edits.
- `object`: nested `fields`; `list`: recursive `item` schema.
- `media-use`: schema selects `use: "image" | "link" | "card"`. Values contain
  `{kind,asset:{providerId,assetId}}` plus image `{alt,decorative,caption}`, link `{label}`,
  or card `{title,description}`. Decorative image alt must be empty. Asset notes
  never supply alt. The provider-qualified asset identity is stable authoring
  data; it deliberately has no version ID. The Media/release layer resolves the
  current active head under a durable mutation token and pins the exact
  immutable version in a release candidate.

`isValueValidForField` validates saved types and date/URL/choice/ref/media
semantics. Date/URL empty strings and absent required fields remain savable.
`diagnoseContentEntryCompleteness` separately finds required missing/empty
strings and arrays, nested required values, and missing per-use accessible
text. `false` and `0` are complete. An optional absent object does not require
its children, but a present object does. All populated list items are checked.

Optional `presentation` has `groups`, `views`, and `inverses`. Groups/views name
existing top-level field IDs. Inverses name `{source:{providerId,recordId},fieldId}`
on the owning model; the field must be a top-level reference/ref-list targeting
the model showing the inverse. Inverses never store a second relationship.

`createContentValueSchema` supplies usable defaults; reference creation requires
an explicit target. `traverseContentSchema` and `traverseContentValues` preserve
field/list order and report nested paths. `projectContentMediaUse(use,url)`
projects per-use props using a caller-resolved URL, without importing features.
Scalar Mapping explicitly rejects all new rich kinds until its structured
mapping implementation; structured values cannot fall through to stringify.

## Atomic storage and graph

`ContentStore.readAll()` returns `{providerId,mutationToken,models,entries}` from
one IndexedDB transaction. `mutationToken` is a durable, nonnegative safe
integer, updated in the same transaction as every mutation (including seed,
clear, schema edits, inverse batches and publication reconciliation). A no-op
mutation may advance it. Clearing records does not reset the token. Every
changed entry receives the transaction token as its generation. Tokens must be
read from storage; notifications are only optional invalidation hints.

`buildContentGraphIndex(snapshots)` consumes complete snapshots, not UI pages.
It exposes provider-qualified relation owners/targets, incoming edges, media
locations, schema/field dependencies, diagnostics and `complete`. Missing
providers/records or invalid data make the graph incomplete; authoring
completeness diagnostics do not. `getContentDeletionBlockers` explains known
Content dependencies and returns `unknown` if the graph is incomplete.
Mapping/Sitemap/Composition dependencies are checked by whole-project aggregate
validation, outside this Content store's transaction.

`readContentGraph(stores)` reads all snapshots and verifies their durable tokens
with a second read. It returns `ready`, `changed` (retry), or `unavailable`;
`ready.index.complete` still needs checking. This establishes a shared capture
interval and never depends on cross-tab notification timing.

`store.transactionScope` truthfully reports `provider` or `unsupported`.
IndexedDB supports one provider's models and entries in one transaction:

```ts
const snapshot = await store.readAll();
const next = await store.transact({
  expectedMutationToken: snapshot.mutationToken,
  operations: [
    { kind: "put-entry", record: changedOwner },
    { kind: "delete-entry", id: removedTargetId },
  ],
});
```

Operations are put-model, put-entry, delete-model (including its entries),
delete-entry, remove-field (definition plus all values), and unpublish-entry.
The final graph is validated before commit. A missing target/dependency or
cardinality violation aborts every write and its token; single-record methods
use the same final graph checks. IDs/createdAt/model membership/cardinality
cannot be changed; used field kinds cannot be changed. Explicit remove-field
is required for top-level field removal. Update dependent presentation metadata
in the same transaction before removing a field.

The native IndexedDB store rejects foreign-provider relation schemas before
writes with `unsupported-transaction`. It cannot lock another provider or
prove foreign deletion safety. Complete multi-provider snapshots remain
supported by graph/aggregate import validation. A future atomic coordinator
can implement those authoring capabilities; supplied stale snapshots cannot.

`planContentInverseMutation(snapshots,edits)` accepts final owning targets for
top-level fields and combines repeated edits to each entry into one put. All
owners must share one provider. `applyContentInverseMutation` checks provider
capability and commits that plan with the captured token. Multi-provider owner
batches reject before invoking any store. Failed provider/transaction data is
preserved; the existing explicit recovery/startFresh flow remains available.

## Publication selection and reconciliation

`createContentEntryRecord` always creates draft/generation 0. A regular save
cannot publish or unpublish; it preserves stored lifecycle intent, including a
save made from a stale pre-activation editor. `unpublish-entry` is the explicit
working intent operation. Saving edits to a published entry keeps it published
but pending relative to the immutable activated baseline.

`getContentPublicationChanges(working,baseline)` reports new/changed/deleted/
unpublish candidates. `selectContentPublicationCandidate(working,baseline,
selections)` overlays only selected publish/delete/unpublish entry actions onto
published baseline entries. Unselected published entries retain baseline
values; unselected new drafts are excluded. It takes all schemas from working.
Selection actions must match current state: publish accepts entries absent from
the published baseline, or changed entries that retain published intent; delete
requires a baseline entry absent from working; unpublish requires a baseline
entry whose current working lifecycle is draft. Publishing an unchanged baseline
entry or overriding explicit unpublish intent is rejected. A stale unpublish
selection cannot remove an entry whose published intent was restored. An entry
absent from baseline remains eligible as new even if its working published
intent survived a previous generation-guarded reconciliation.
The caller must validate the resulting whole-project candidate, including
retained baseline records, before review/build/activation. An incompatible
schema change must block that release. These helpers do not activate anything.

`contentEntryDigest(entry)` is an exact canonical content fingerprint (a string,
not a cryptographic hash). It includes identity/createdAt/values and excludes
generation, updatedAt, lifecycle. Release compares approved generation plus
digest with current working state when calling:

```ts
await store.reconcilePublication([{
  ref: {providerId,modelId,recordId},
  expectedGeneration: approvedEntry.generation,
  expectedDigest: contentEntryDigest(approvedEntry),
  lifecycle: "published",
}], activationGeneration);
```

`activationGeneration` is the release store's positive monotonic activation
fence. The Content metadata transaction advances it even for empty batches;
older or equal generations make no writes. This prevents a late callback for A
from changing lifecycle after B has reconciled. Missing or changed entries are
skipped, preserving edits made after review.
Matching lifecycle metadata changes receive a new generation in the same
transaction. Activation/release workflow, mutable workspace lifetime and
immutable build/media identities remain the downstream owners' responsibilities.
