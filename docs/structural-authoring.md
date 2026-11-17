# Structural authoring and host ownership

Composer is a reusable authoring product. Pinsel is the acceptance consumer for
[full adoption](https://github.com/zudolab/pinsel/issues/51). A generic feature is
not accepted for that effort until an independent immutable install uses it in
Pinsel's real scenario. The component contract establishes schema compatibility;
it does not establish rendering compatibility between Preact and another runtime.

## Ownership before editing

A Sitemap describes route-backed pages and hierarchy. Internal compositions,
patterns, and Mapping fragments are not additional public pages. A semantic
component instance has an ID independent of order, typed fields, and named slots
with constraints. Its parent owns arrangement and slot order; the child owns its
supported content and presentation properties. Decorative wrappers do not need
to become prominent authoring nodes.

Content records own shared values. A placement references those records through
Mapping; it must not silently copy a bound value to Composition props. Show the
source record and affected uses when editing a shared value. A live reference and
a detached pattern copy have different semantics and must be distinguishable.
Identify selections by provider, composition record and canonical node ID, using
materialization provenance for repeated rendered nodes. A node ID alone is not
globally unique. Route and positional context belong to the trusted host renderer.

See [Mapping entry identity and explicit pins](mapping-entry-identity.md) for
read-only record identity bindings and strict pinned selection semantics.
[Qualified reference query filters](mapping-reference-queries.md) describes typed
reference membership selection without replacing live queries with finite pins.

## Native authority and capture

A host explicitly selects native workspace authority. Generated build artifacts
must neither make that workspace read-only nor reseed it during startup.
Initialization imports Composition, Content, Mapping and Sitemap into staged
native filesystem stores. It is not a transaction across all four domains and
is not a hybrid D1 Content/filesystem structure adapter. A failed stage cannot be
represented as an activated complete workspace.

A reviewable capture must bind workspace/schema identity, all four domains,
component and renderer identity, and referenced Assets. Reuse durable mutation
tokens and session coordination. Flush or refuse unsaved editor sessions; verify
a common stable read interval, refuse or retry changed state, and build from the
reviewed immutable capture rather than recapturing current state. Snapshot A must
remain buildable after later draft B without changing B. Do not expose private
storage paths or require hosts to assemble snapshots through unrelated reads.

A saved unassigned Sitemap page can be captured and reopened before its source
is chosen. Capture retains that exact unassigned node; it does not declare the
workspace render-ready. Assets inspection still covers every saved Content entry,
Composition and component default, plus all materialized routes. The only tolerated
source exception during authoring capture is an `unassigned-page` for an actual
unassigned node in the active Sitemap: that node has no source to materialize.
A new blank-slug child inherits its parent's path. Capture can tolerate the
resulting collision group only when every participant is such an unassigned
placeholder or the one successfully materialized assigned destination at that
exact path. Multiple assigned destinations remain blocked, including expanded
Mapping entries sharing one Sitemap node ID. No route or node is removed from
the captured project, and ordinary compiler collision diagnostics are unchanged.
Unknown managed references, missing/corrupt Assets, other route errors and changed
state still refuse capture. Release compilation, exact snapshot build and Assets
trash inspection keep their strict completeness rules. Assign a source and capture
again before building; never rewrite an earlier incomplete snapshot to make it pass.

For a staged pack/schema migration, `isAuthoringWorkspaceSourceCurrent` from
`zudo-composer/authoring` checks the original snapshot digest, full native source
project and tokens, Assets and prepared public bytes without requiring the new
runtime to match the old renderer identity. Its `pack` is the currently installed
pack used to open inspection; this check does not compile or certify compatibility.
Keep the original writer stopped, check before staging and again before selecting
the staged authority. Refusal leaves the original authority intact. Normal capture,
`isAuthoringWorkspaceSnapshotCurrent` and exact build still require matching pack
and renderer identities. A source check alone is never an activation transaction
or proof that a migrated project renders correctly.

## Host document preview

A trusted host document adapter renders the entire compiled route with the host's
production renderer. Composer does not acquire a dependency on that application
runtime and does not require a handwritten Preact duplicate. Keep preview CSS and
assets in the isolated document. Bind render acknowledgements and selected owners
to the exact workspace revision, route, component pack and renderer identity.
Check the iframe sender and origin and reject stale or foreign messages.

### Semantic tree and explicit local edits

Trusted `hostDocument.componentPresentation` maps installed component IDs to
`{ labelProp?: string, transparent?: boolean }`. For example, a host may declare
`section: { labelProp: "title" }` and `group: { transparent: true }`. Unknown
components, undeclared/nontextual label properties and arbitrary callbacks are
rejected. Text and string-enum labels use captured rendered values, are escaped
by the UI and bounded to 160 characters; blank values fall back to the component
title. This display configuration is part of the attested host config graph.

Transparency only projects the displayed tree. Canonical parents, named slots,
owner coordinates and placement targets remain unchanged. Empty wrappers stay
visible for insertion, selected wrappers reveal themselves, and **Show structural
wrappers** exposes the complete tree. Keyboard parent navigation follows visible
parents. Repeated placements and duplicate titles retain independent identities.

The host Inspector uses the installed field schema and label order for typed
controls. One top-level field is staged at a time; **Save field** submits the
complete value through the validated owner operation. Keystrokes never write
canonical state. **Discard local draft** is explicit. Pending drafts block page
refresh, selection changes and workspace-session flush/navigation. Stale preview
invalidation disables Save while retaining the draft for inspection/discard.
Invalid numeric input cannot accidentally save its previous valid value. Optional
top-level omission remains read-only here; it is never converted to JSON null.
Local unsaved drafts are memory state with an unload warning, not a durable draft
store. Once submitted, the exact operation is durably retained for receipt-based
recovery across reload/restart; another operation's recovery cannot clear a local
draft silently.

Server-derived capabilities distinguish local Composition fields/arrangement,
shared Mapping/global sources, and page-owned placement. The Inspector shows
captured affected routes and real Content source links. **Arrangement owner uses**
refers to the selected Composition owner. **Bound field sources** separately lists
each declared bound property's qualified Content record and field, plus its uses
across the captured active Sitemap. For example, a shared course price can affect
Home and Lessons even when the selected presentation occurs only on Lessons.
Discovery follows the actual Mapping/attachment provenance; an unused Mapping
cannot add a source or affected use. These informational details are independent
of Assistant allowlists and do not grant editing capabilities. Transformed values,
entry identity and unavailable sources have explicit explanations. Source links
are withheld when the preview is stale or editing is otherwise blocked; retained
source details describe the saved capture. Shared bound fields are
never copied into local props. Local insertion offers declared named slots and
components whose defaults yield a complete valid Composition; Mapping-populated
slots are unavailable. The server revalidates the exact revision, owner, slot,
component defaults and whole project before writing. A new UUID is retained with
the request so lost-response retries cannot insert a second child. Insertion is
at the start of the canonical slot. Page creation, root insertion and root removal are
not offered in this panel; unsupported operations are stated rather than inferred
from a flattened display parent.

## AI uses the same ownership and validation

The in-product Assistant must receive the current selection, owners, references,
architectural constraints and supported capabilities through its actual provider
context/tool path. This Markdown is development guidance, not proof that a
restricted model receives it. Proposals do not mutate canonical data before
explicit Apply. Human and AI edits use the same validators and owner domains.
Refuse stale proposals, recover lost responses through receipts, and guard Undo
against subsequent edits. Mixed-domain requests require proven atomicity or
separate clearly reviewed operations; never silently apply only half a request.
Unsupported requests must explain the missing capability.

## Cross-repository acceptance workflow

1. Specify a Pinsel scenario and reproduce the generic limitation.
2. Implement and document the smallest justified generic capability in Composer.
3. Review it, generate public façades, and run focused and current-head gates.
4. The integration manager pins the exact immutable package and contract revisions
   in Pinsel, updates its lockfile and compatibility ledger, and frozen-installs.
5. Verify the same Pinsel scenario through its renderer, persistence, restart and
   exact static output. Independent review follows executable docs without chat.
6. Merge eligible reviewed work under repository policy, confirm integration and
   record actual source/package/workspace/scenario/check evidence in task issues.

The manager owns root manifests, lockfiles, dependency pins and shared public
exports. Parallel workers own disjoint files; shared schema changes are serialized.
Preserve demo regeneration and installed boundary gates. Historical fixtures stay
as historical migration proof while newly authored states use stronger current
contracts. Never weaken a test merely to obtain green CI.

## Data and delivery holds

Composer demo clean-break authority does not authorize deletion of consumer data.
Pinsel's Git baseline is not the owner's current local D1 draft. Actual cutover
needs the exact export and an authorized reachable host: rehearse, fence legacy
writes, capture final revision, stage and validate, then switch one authority.
Retain original stores/history/snapshots as read-only recovery and restore original
authority on failure. Cloud implementation does not imply owner-data cutover.

Fake providers prove deterministic integration, not authenticated inference.
Record unavailable live-provider acceptance as NOT_RUN with the exact missing
configuration; preserve the owner's model, effort and service tier. Current work
authorizes no deployment, package publication, remote D1 changes, domain changes
or real inquiry delivery. Production delivery remains stopped.

## Host preview destinations

When a trusted host document renderer is configured, **Saved host page preview**
opens the existing native page authoring view. Its iframe renders a captured saved
workspace through the host renderer; it does not promise unsaved live output.
Existing session flush and dirty-input refusal still precede capture.

The active Sitemap Inspector offers **Open page authoring** when the selected page
has exactly one resolved concrete route. The link qualifies Sitemap provider,
Sitemap record, page ID and visitor path; the server checks that tuple against the
captured active Sitemap. Inactive, unresolved and multi-route families explain why
this shortcut is unavailable rather than guessing a route or Content entry. The
source Composition link remains a separate provider-qualified source action.
Deliberately choosing a different page in native authoring clears the original
handoff constraint while retaining normal exact-snapshot capture validation.

Local release compilation/activation remains available, but **activated-release
preview is unavailable** for host document rendering until an exact-release adapter
exists. It must never show newer working state under the immutable release label.
Direct `/site` and `/website-preview` bookmarks show this boundary before loading
the Preact visitor renderer. Use the host's independently verified exact-snapshot
static build for release rendering evidence. Ordinary Preact hosts and static
builds retain their existing visitor routes.

## Host Content value policy

A host can configure `contentValidation: { module: "my-site/content-policy",
id: "my-site-content", version: "1" }` independently of Assistant availability.
The public package module exports a synchronous `validateContentField` function.
Import `ContentFieldValidationInput`, `ContentPolicyIssue`, or
`ContentValidationModule` as types from `zudo-composer/authoring`.

The callback receives a deeply frozen clone of `{ providerId, model, entry,
field, value, previousValue, purpose }` and returns an array of `{ code, message }`
diagnostics (empty means accepted). The owning store supplies the actual model,
field and provider after built-in schema/reference validation; a value-write
request cannot supply its own schema. Removing an optional value supplies
`undefined`. Required-field completeness remains Composer's existing contract.
Callbacks cannot transform data, perform inference or return promises; thrown,
async or malformed results refuse without a canonical write. Treat the callback
as trusted deterministic host code, not a sandbox for untrusted code.

This is **field-local validation**, not a cross-field or cross-store transaction
API. During writes, only changed values and entries affected by a model schema
change are checked. Do not use unrelated values in the context to implement
cross-field invariants. Model changes remain separately owned schema operations.
Human entry writes, batch transactions, native editorial saves, AI staging and
Apply, and new restore/Undo operations share this policy. AI allowlists continue
to control which fields the model may propose; they do not grant permission to
violate the host value policy. A new Undo restoring a forbidden historical value
refuses and preserves history rather than silently changing the stored revision.

Existing records, revisions, receipts, captures and immutable releases remain
readable. Editorial published-value reads use verified immutable Content data
without requiring the current visitor runtime to match an older release; visitor
rendering retains its strict runtime compatibility check. Explicit initialization/import can preserve known historical inputs;
startup never rewrites, rejects or reseeds a whole store because of the new
policy. Unchanged historical values may remain while unrelated fields are edited.
Before a new publication, all values of the selected published entries are
checked, even if their draft values were imported unchanged. Correct an invalid
selected value explicitly before publishing it. Retained unselected published
entries are not rewritten. Exact rendering of an old capture remains separate
from authorization to publish new content.

Policy source identity includes transitive module dependencies and host config.
It participates in renderer/capture and release toolchain identities, including
caller-supplied release toolchains. A supplied `installedPackDigest` describes the
base pack identity; the Content-policy marker is always derived from the current
host configuration, never accepted from a caller. Native Content-AI proposals also persist that
identity in their rendered-candidate digest; fresh Apply after a policy change
requires another review. Loaded policy source changes require a process restart,
including when another loader is created, because native ESM dependencies can
remain cached. Validation repeats inside the Content writer and before release
stage/activation; it is not an atomic transaction across stores. Already committed
Apply/Undo receipts and already active release retries remain recovery-first.
A fresh activation of an older release with a different policy identity refuses;
retain that release as recovery evidence and review a new candidate explicitly.

### Workspace summary inventory

The dashboard and shell use an optional Composition store `snapshot()` capability
for canonical metadata and their own Mapping source diagnostics. This snapshot
must return validated records and the real mutation token; it does not generate,
repair, or attest derived JSX. Qualified provider identity is preserved, and the
inventory cache is discarded on Composition persistence changes, workspace changes,
or an explicit summary refresh. Failed/invalid snapshots remain visible failures;
they do not fall back to a derived write. Providers without this capability retain
their existing catalog behavior. Composition editors and their derived-output
validation still use the normal `list`/`get` APIs. This keeps read-only workspace
chrome from initiating JSX repair while an exact host preview freezes admission.


The summary also accepts the complete configured Mapping provider inventory.
Snapshot-capable providers supply both metadata and diagnostic records from the
same validated canonical snapshot; unsupported providers retain catalog behavior.
A failed snapshot is a visible error, never a reason to fall back to per-record
reads. Mapping snapshots refresh on Mapping or workspace changes. Each Mapping
summary evaluation memoizes Content-model resolution by full provider/model
identity, preserving missing/invalid/provider-error outcomes and dropping the memo
after that evaluation. Content persistence changes recompute those diagnostics;
Content completeness and semantic-error checks are preserved when deriving summaries
from a single Content snapshot, as described below.


The summary can also use its Content store's optional `readAll()` capability.
Each summary refresh reads one provider-qualified snapshot with its durable token,
validates the record envelopes and known-model values, and derives model ordering,
entry ordering/labels, counts and completeness diagnostics using the same model
helpers as `scanEntries`. Invalid snapshots and semantic-invalid model members
remain unavailable; failures never trigger a per-model fallback. The snapshot is
also checked with the same graph diagnostics as native `listModels`: orphan entries,
dangling local references, invalid inverses and cardinality errors are unavailable;
`incomplete` and `missing-provider` diagnostics remain non-fatal, as before. This
validation runs on each refreshed snapshot even if initialization is already ready. Stores
without `readAll` retain their `listModels`/`scanEntries` path. Content persistence,
workspace changes and explicit refresh discard the summary cache; an old pending
read cannot repopulate a newer cache.

### Content preview discovery

Mapping catalogs may expose `readInventory()`. `createMappingCatalog` builds it
from optional provider `snapshot()` capabilities, retaining each provider's real
mutation token and validated canonical records. Snapshot-capable provider entries
use the native updated-at descending / ID ascending ordering; provider order is
preserved. Providers without snapshots retain their own list order and normal
resolve behavior. Snapshot failure/invalid records remain visible provider failures,
never a reason to silently fall back to individual reads.

Content preview uses that per-load inventory to filter qualified Content-model
owners before definition resolution. It memoizes each qualified Content-model
resolution, including missing/error outcomes, only for that load. Compatible
Composition targets still use their actual provider resolution and derived-output
challenge path. Draft typing still evaluates the already-resolved definition
without provider I/O. Each new entry/model load obtains a new inventory and model
memo; late results cannot replace a newer selection. Custom Mapping catalogs with
only list/resolve continue to work. These independent provider snapshots do not
establish cross-domain atomicity and are never mutation preconditions or exact
static-build captures. Pinsel must verify the same retained readonly Content
scenario after an independently installed immutable package before acceptance.

### Saved affected-page previews for host-rendered Content

When `hostDocument` is configured, the Content inspector does not send the host's
components to the Preact fragment renderer. It offers **Saved page preview** through
the same trusted `renderDocument` module as native pages. Mapping definitions and
model Usage remain visible; they are not proof that a fragment is placed on a page.
The ordinary Preact-compatible Content preview continues to evaluate local drafts.

The readonly native operations `content-preview-context` and
`content-document-preview` require the connected client/capability/epoch. They use
provider admission and the server's live authoring lease, without a browser
prepare challenge or queue flush. Each reads one coherent persisted workspace and
compiles it once. Durable tokens/assets/public files are rechecked before returning;
this is a saved-state read, not permission to omit flush guards for edits or builds.
No draft is saved to obtain a preview. A stale context revision or foreign owner,
Sitemap, page or route refuses before publishing a document.

Context discovery resolves the complete provider/model/entry identity and follows
actual compiled Mapping materialization and field-source provenance. It does not
infer routes from record names or from unused Mapping definitions. The selector
requires an explicit captured affected page, even when only one is available.
Multiple uses retain qualified Sitemap/page and rendered owner identities. The
inventory covers compiled bindings, not arbitrary dependencies read privately by
the host renderer (such as metadata-only lookups); no-use entries report that limit.

The frame's ready state requires its original window, origin, revision, route,
pack/renderer identity and document marker. Workspace/session invalidation or
navigation away clears that state. Pending or different Content input is labelled
as excluded from the saved snapshot; refresh never substitutes an unsaved candidate.
Standalone host fragment and unsaved host Content preview are explicitly unsupported
by this capability. Saved authoring state is also distinct from an activated release
or deployed site. The Assistant's proposal/apply/undo validation and permissions do
not change, and these reads grant no Content or Composition mutation authority.

Installed acceptance must use a real host renderer and an actual bound Content use,
check the qualified context and original frame acknowledgement, preserve the entire
workspace across reload/restart, and verify the rendered production semantics.
Source/unit tests alone do not complete a consumer scenario.

### Qualified Mapping navigation

Opening a provider-qualified Mapping deep link resolves the selected definition
after loading catalogs and Mapping summaries. It does not wait for every unrelated
library definition before opening the editor. Attachment checks still precede
the deep-link handoff. The selected
editor still performs its normal Content and Composition resolution and validation.
Returning to the library resolves its complete diagnostics; pending rows are shown
as checking rather than incorrectly reporting missing sources.

Within one library refresh, qualified Content-model and Composition reads are
shared across definitions and scheduled with bounded concurrency. Failed reads
retain their diagnostic outcomes, admitted work settles before an error returns,
and caches are discarded after that refresh. Selected-editor reads never reuse
this library cache. Creation and duplication retain their existing durable-write
and navigation order. These reads do not establish a coherent build snapshot.
