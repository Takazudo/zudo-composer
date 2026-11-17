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
