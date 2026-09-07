# Shared workspace design

See [the final acceptance matrix](./workspace-acceptance.md) for current browser
sources, worker evidence limits and manager-owned integrated completion gates.

The production workspace extends `src/components/ui`, `overlay` and
`outline-tree`. Feature UIs consume these components; do not copy prototype
renderers, add a parallel tree, or import `preact/compat`. The installed component
provider and its preview runtime remain a separate rendering boundary.

## Existing controls and tokens

The audit found these production primitives already meet the workspace contract:

| Need | Shared API and behavior |
| --- | --- |
| Buttons / icon buttons | `Button`: default, primary, ghost, danger; `xs`, `sm`, `md`; icon-only requires an accessible label; `elementRef` reaches the native element |
| Tabs | `PaneTabs`: selected tab, roving keyboard focus and panel identity |
| Segmented options | `SegmentedControl`: radiogroup, controlled value, disabled options and roving focus |
| Badges / statuses | `Chip`, `CountBadge`, `Kbd`, `StatusChip`: semantic tone and named status including loading/error |
| Fields | `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`: native semantics, labels, descriptions/errors and `elementRef` |
| Empty / error / loading | `EmptyState`, `Banner`, `StatusChip`: visible explanation, optional action, live status / alert semantics |
| Menus / dialogs | `useMenu`, `Menu`, `Dialog`, `ConfirmDialog`: body-level portal, focus restoration, viewport placement and keyboard handling |
| Rows / panes | `DataTable`, `Pane`, `PaneHeader`, `PaneBody`, `PaneSection`: shared spacing, selection and scroll structure |

Use the existing `cms-` class namespace and named sizes. Do not introduce numeric
spacing utility classes: the class-name gate checks actual generated utilities.
The app token sheet owns the current A/B spacing ladders (`--sp-*` and
`--sp-b*`), control/row heights, semantic colors, radii and light/dark overrides.
Keep provider tokens in their provider namespace. Shared CSS reads semantic
colors so selected, disabled, error and focus states work in either theme.

`DisclosureButton` adds a square plus/minus glyph to the existing `Button`
contract. Supply `expanded`, an action label such as `Collapse navigation`,
`onClick`, and optionally `aria-controls`, `elementRef`, size and variant.
Use it for tree and shell expansion. Arrows mean navigation or movement; they
do not rotate to indicate disclosure. Leaf rows retain their existing spacing.
The disclosure has no motion; other controls retain reduced-motion rules.

## Outline insertion

`OutlineTree` renders insertion before the first sibling, between every pair,
and at the terminal add row. Empty roots use the root add button; empty branch
or named-slot lists use the child add row. The exact callback target is
`{ parentId: string | null, index: number }`; `null` means the root list.
`canInsert(target)` remains the host's cardinality, locked-outlet and capability
authority. Leaf nodes never acquire child insertion points.

Fine pointers keep the zero-height dashed boundary and hover/focus affordance.
Coarse pointers reserve a separate 44px insertion row with a visible 44×44px
button. Its target fits inside its own row instead of covering adjacent rows.
Opening the editor preserves that reserved geometry. Tree arrows, Home/End,
selection, Enter/open, `a`/`+` sibling insertion and host drag/reorder commands
retain their roles.

Without `onRequestInsert`, the tree opens its inline title editor. A handler may
also return `"inline"`. `onAdd(request)` may return the inserted node ID for
focus restoration; synchronous void handlers also get inserted-row focus when
exactly their newly rendered child can be identified. Escape/Cancel returns to
the originating row or insertion button, with a connected tree fallback if the
origin was removed. Terminal Add controls are resolved by their owning parent
when cancellation recreates the button DOM node. Enter/Escape do not
commit/cancel during IME composition.

An external chooser receives a transaction as the second callback argument:

```tsx
onRequestInsert={(target, session) => {
  openChooser({
    initialTarget: target,
    submit: async (choice) => {
      const current = session.resolveTarget();
      if (!current) {
        showTargetRemovedError(); // Retain the chooser draft for recovery.
        return;
      }
      const insertedId = await addChoice(current, choice);
      closeChooser();
      session.complete(insertedId);
    },
    cancel: () => { closeChooser(); session.cancel(); },
  });
}}
```

Before/between targets follow the next sibling's ID within the same parent
through reorder; terminal targets follow the current list end. A removed or
locked parent/anchor invalidates the transaction permanently. `resolveTarget()`
returns null for invalidated, superseded, completed or unmounted sessions.
The host must revalidate its own mutation atomically if an asynchronous write
can race further changes. `complete(id)` clears the marker, expands the owning
parent and focuses the inserted row once rendered. Call it after committing the
node; use `cancel()` for dismissal. If a chooser's target disappears, the tree
leaves chooser focus and draft intact, and its cancellation still restores a
connected tree focus target. A superseded chooser cannot complete a newer one.

Current external chooser consumers must use the insertion session for anchored
completion/cancellation and stale-target checks. The final browser sources
exercise exact first-sibling insertion, IME and cancellation focus on desktop
and coarse-pointer projects; absence of the approved outline is a failure.

## Rename and nested menus

Supply `OutlineTree.onRename(id, title)` to enable F2 and optionally
`canRename(node)` to gate names. The shared `InlineRename` is also available to
other feature rows: `value`, `label`, `onCommit`, `onCancel`. It focuses/selects
the text on mount, trims nonempty submitted titles, consumes its editor keys,
and preserves IME composition. Blur retains edits; Enter commits, Escape
cancels. Renaming a branch preserves its descendants and row geometry.
`isComposingKey(event)` is exported for additional feature shortcuts.

Use `MenuSubmenu label="Arrange"` inside `Menu`, with ordinary `MenuItem`
children that call the host's actual reorder commands. Right/Enter/Space opens;
Left/Escape closes the innermost surface and focuses its trigger. Selecting an
action or pressing Tab/ShiftTab exits the entire owning menu chain and returns
focus to its root trigger; a following Tab continues through the page. Menu and
section IDs are allocated across portal roots so every ARIA reference resolves
to its own surface. Clicking inside a nested portal does not
dismiss ancestors. Outside pointer dismissal closes the chain without stealing
the pointer's destination focus. Side menus prefer the right and flip/clamp at
viewport edges through the existing placement helper. Portal context is passed
explicitly, without compat or a replacement portal implementation.

## Validation and remaining browser proof

The shared suites cover APIs, ARIA, keyboard/IME, identity-anchored insertion,
focus, nested menu pointer dismissal and pure side-menu placement. The manager
runs `tests/browser-dev/outline-tree.responsive.pw.ts` in desktop/coarse lanes;
its updated source asserts the reserved touch row and target bounds. Visually
check first/last/named-slot insertion, square disclosures, branch rename,
three-level Arrange menus near viewport edges, and light/dark focus styling.
Use the CSS guidance from `accessibility/touch-target-sizing.mdx` and
`states-and-transitions/hover-focus-active-states.mdx` in the CSS Wisdom docs
for touch targets and distinct hover/focus states.

## Content and Media snapshot boundary

Content media-use values carry a stable provider-qualified
`{providerId, assetId}` identity. Working records never persist a byte version:
replacing an asset should update draft previews without rewriting Content.
Release capture reads one validated Media snapshot, resolves each active asset
head to an exact `{providerId, assetId, versionId}`, verifies retained bytes,
builds a deterministic pin manifest, and rechecks the durable Media mutation
token. A changed token invalidates the capture; an older exact pin stays valid
and immutable.

Content and Media stores each expose durable mutation tokens from their
persistence boundary. Notifications are refresh hints only. A coherent
cross-domain capture reads snapshots and checks the persisted tokens again;
missing providers or changed tokens produce unavailable/changed outcomes and
must never be interpreted as “unused.” Workspace coordination extends this
same protocol to Composition, Mapping, and Sitemap stores.

The current authoring transaction boundary is one Content provider. Complete
provider-qualified graph reads are supported, but a relation write requiring
multiple provider transactions fails before the first write. Rich Content
kinds require explicit supported Mapping projections (object field, Media text/
asset, reference identity/list or route link), never silent stringification. Content and Media
schemas fail through their typed recovery paths; there are no compatibility
readers or migrations.

## Workspace lifetime and capture

`ProductionProviderIntegration.workspace` owns mutable identity independently
from active source revision/build. Durable workspace metadata lives in the
host project's files, in one filesystem registry under `<dataDir>/workspaces`
(see [Workspace scoping on the filesystem](#workspace-scoping-on-the-filesystem)
below for its exact shape and locking). The default first open reserves
`initial` once; the fixed seed manifest is persisted before any provider boot.
A failed seed retains its original manifest for retry; ready workspaces never
seed again. Missing selected workspaces, domain directories or malformed
metadata require explicit recovery, never silent reconstruction from activated
source.

`workspace.open(id)` returns an initialized integration for that existing
workspace. `create(project, baselineRevision, options?)` and `loadExample(...)`
create or resume an explicit seeding attempt; `reset()` creates a new workspace from the source supplied to this
integration. They return the replacement integration only after provider
initialization and atomic registry selection succeed. The shell swaps integration
then; an old integration continues to address its old drafts. Failed provisional
seeds are cleaned up under the workspace initialization lock. Blocked/uncertain
deletion retains one cleanup-pending attempt and retries finish deletion before
reseeding; ready or selected workspaces are never deleted. A persisted
before-complete guard cannot be bypassed by an ordinary open after a crash.
The
`initialization.startFresh()` entry point fails with `code: "reset-required"`
without writes; recovery UI uses `workspace.reset()` and handles its returned
integration. An unavailable source can still open the selected existing workspace;
to reset it, supply a valid project to `workspace.create`.

`workspace.metadata()` returns authored project metadata and its durable token.
`updateMetadata(expectedToken, {name?, activeSitemap?})` persists changes with a
metadata transaction precondition. `getCurrentSiteProject()` composes that
metadata with a coherent four-provider capture, so active Sitemap selection is
real authoring data. It deliberately does not require Media for ordinary live
project preview. `captureWorkspace()` additionally requires Media and returns
`{status: "ready", project, capture}` or explicit `changed`, `unavailable`, or
`save-failed` outcomes. `capture.values` includes the metadata, domain snapshots
and Media snapshot under `workspace`, `compositions:<logical-id>`,
`content:<logical-id>`, `mappings:<logical-id>`, `sitemaps:<logical-id>` and
`media:<provider-id>`; Media is not a fifth SiteProject provider.

Feature controllers register with the application-owned `integration.sessions`:

```ts
const session = integration.sessions.register(
  { feature: "Content", providerId, recordId, workspaceId: integration.workspace.id },
  { flush: () => queue.flush(), retry: () => queue.retry() },
);
// Every accepted draft, before its debounce/write:
session.changed();
// Unmount: detach presentation; the registry retains outstanding flush handles.
session.detach();
void queue.close();
```

`SaveQueue.close()` refuses further edits and drains the newest queued draft even
behind an active write. Closed queues retain error state and support flush/retry.
The registry retains failed detached handles and reports feature/provider/record
details. Its barrier retries if session generations change during flushing.
Later feature UI integrations must register all debounced saves and Media
operations; an unregistered in-memory edit cannot be observed by storage.
Replacement integrations share the same registry, so outstanding old-workspace
handles and failures remain reachable after a workspace switch too.

Composition, Mapping and Sitemap stores implement optional `snapshot()` and
`mutationToken()` capabilities. A snapshot contains `{records, mutationToken}`
from one transaction; every committed record mutation, including
seed/delete/clear, advances the token in the same transaction. Abort preserves
both, clear never resets it, and safe-integer exhaustion fails closed. Content's
`readAll()` and Media's `snapshot()` supply their existing durable tokens.
Filesystem Composition uses validated, sorted canonical content SHA-256
fingerprints, repeated reads and bounded conflict detection, including external
same-inode edits. This is a content precondition, not a filesystem transaction;
it neither emits derived JSX nor claims a lock over external editors.

Capture reads all durable tokens before any snapshots, checks embedded tokens,
then reads all tokens again. Any difference retries up to three times or returns
`changed`; flush and notifications alone never establish coherence. A provider
without these capabilities is unavailable for coherent capture. The capture
remains an immutable point-in-time value; `isCaptureCurrent(capture)` checks its
workspace/session/provider tokens as a release precondition. Call it before
approval/apply, then pin the approved capture for build/activation. Changes after
staging invalidate currentness but never mutate the staged capture. Baseline-only
`reconcileBaseline(capture, revision)` skips when its checked generations changed
and CAS-updates only workspace metadata; it never writes any provider record.
Content lifecycle reconciliation separately uses Content's atomic per-record
generation plus digest preconditions. There is no cross-provider write
transaction and no release activation or hosted transport here.

Committed storage notifications and session changes invalidate cached summaries
through `subscribeChanges`; `WorkspaceSummary.dispose?.()` removes its listener.
BroadcastChannel messages are refresh hints. Delayed/dropped messages cannot
bypass persisted-token checks. Direct external filesystem changes are caught on
the next capture/read; external processes do not promise browser wakeups.
Sidebar/theme/pin preferences never enter metadata or capture tokens.

## Workspace scoping on the filesystem

The registry is one `TransactionalRecordStore` under the host's CMS root
(`<dataDir>/workspaces`): `meta` carries the layout marker, `selection` carries
the active pointer, and each workspace is one document holding the same
`WorkspaceRecord` — schema, per-record `mutationToken` precondition and refusals
all live in `workspace-record.ts`, independent of where the bytes go.
Because the store commits the whole record set behind one pointer swap, a
workspace record and the selection pointer can never disagree after a crash.

Scoping is a *directory* prefix: each of the four authoring domain roots gains one
`workspace-v1-<id>/` subdirectory. Scoping per domain root rather than
re-rooting the CMS tree is what keeps a host's independently configured
`compositionsDir`/`contentDir`/`mappingsDir`/`sitemapsDir` meaningful. Media is
not scoped: no workspace owns its bytes. Workspace ids are filenames, so they
are held to the record-id rule — lower-case and case-stable — which keeps two
workspaces from colliding on a case-insensitive filesystem.

Web Locks cannot reach across two dev-server processes, so once-only seeding is
serialized by the shared kernel `O_EXCL` mutation lock instead, one lock
directory per workspace beneath the registry root. The lock is never stolen: a
holder that dies leaves the file behind and every later seed of that workspace
fails closed until a human verifies no writer is running. Capture is unchanged
— token → read → token, three attempts — because `WorkspaceToken` already
admits the filesystem's generation values.

## Browser-local preferences (exempt from the filesystem rule)

Every authored record, workspace snapshot, precondition and digest lives in
project files behind the file-provider protocol. `localStorage` is the one
exception, and only for per-browser ergonomics that satisfy all four invariants:

1. the value never enters authored/CMS data, a workspace snapshot, a
   precondition, or a digest;
2. the application behaves identically when the value is absent or cleared;
3. every read and write is wrapped in `try`/`catch` (privacy modes, sandboxed
   documents);
4. keys are prefixed `zudo-composer`.

The complete permitted inventory:

| Preference | Owner |
| --- | --- |
| Theme | `src/theme/theme.ts` |
| Content navigation pins | `src/app/navigation-preferences.ts` |
| Rail widths and collapse | `src/app/rail.tsx`, `src/components/editor-chrome/resizer-contract.ts` |
| Outline slug/count preferences | `src/components/outline-tree/prefs.ts` |
| Composer canvas viewport | `src/features/composer/app/viewport.ts` |
| Composer provider preference | `src/features/composer/routing/provider-preference.ts` (adapter in `src/features/composer/app/production-composer-app.tsx`; the coordinator guards both read and write) |
| Media grid/list view | `src/features/media/media-app.tsx` |

Anything not listed here is a violation. `scripts/check-headless-boundary.mjs`
enforces the boundary directly: no `localStorage`, `sessionStorage` or IndexedDB
global may appear anywhere under the domain storage trees, `src/site-project`,
`src/features/release`, `src/shared`, `server`, `plugins`, or in the workspace
storage/seeding/snapshot and provider-integration modules of `src/app`.

The `BroadcastChannel` refresh-hint bus in `src/shared/persistence-generation.ts`
is not storage and is unaffected.

## Generic workspace shell

The shell owns Overview, Content, Media, Compositions, Mappings, Sitemaps,
Review & release and Website preview. Content navigation reads the complete
provider-qualified catalog, resolves each model's declarative views and renders
collections and singletons in the same dashed nested list. Failed sources remain
explicitly unavailable. Model actions pin a model or view; pin actions rename,
reorder and remove it. Stale pins stay visibly unavailable and removable.
`zudo-composer-navigation-pins-v1` and `zudo-composer-rail` are browser preferences,
outside project metadata, save sessions and review generations.

Desktop widths are 244px, 218px at 761–1100px, and 56px when compact. The shared
square `DisclosureButton` changes only geometry; the routed editor DOM persists.
Ctrl/Meta+Backslash ignores handled events, IME, menus and native dialogs. Browse
opens complete temporary navigation beside the compact rail, without changing
the saved width. Keep expanded commits it. Outside pointer dismissal leaves
destination focus alone; Close/Escape restores Browse. At 760px and below an
initially closed native modal drawer uses `min(320px, 100vw - 48px)`, `100dvh`,
a sticky close toolbar, 44px targets and contained scrolling. Breakpoint changes
close temporary UI, restore visible focus and release scroll locking. Menus
inside native dialogs mount their portals in the owning dialog's top layer.
The precise pixel geometry comes from the approved shell contract; focus,
touch-safe hover and scrolling follow CSS Wisdom's
`responsive/media-query-best-practices.mdx`,
`states-and-transitions/hover-focus-active-states.mdx` and
`scroll/overscroll-behavior.mdx`.

All record links use strict single-valued query intents in `route-intents.ts`:
provider plus composition/model/mapping/sitemap/asset; Content can additionally
name entry/view, and Sitemap can name page. Hashes, duplicate/unknown parameters,
missing providers and unsafe IDs are invalid; there is no fallback record.
Composer now uses the same query contract. `/composer/preview` keeps its isolated
entry graph. An editor's accepted history selection calls `notifyRouteSelection`
so the host updates navigation without remounting that editor.

`useWorkspace()` exposes the current integration, `navigate`, `reset`, `open`,
busy state and visible failure. Feature factories consume `integration.sessions`
as described above. Current Mapping and Content controllers, Composition queues
and pending props, Sitemap queues and debounced props, and Media upload batches
register live flush handles. Detaching presentation retains pending writes and
failures. Shell navigation and browser traversal await this shared barrier before
changing route. A document-level listener covers body-portaled menu links too.
Rejected browser traversal returns to the current history entry without replacing
its destination, preserving usable Back/Forward history. Mapping and Sitemap wrappers route imperative
navigation through the same callback. Summary subscriptions refresh Overview and
rail counts after integration change notifications; subscriptions are disposed
on replacement. Retry opens existing data. Reset swaps the integration only after
`workspace.reset()` returns its initialized replacement; failure preserves the
old workspace. Active Sitemap selection uses metadata CAS and registers its
pending write with shared sessions.

Content keeps the selected declarative `viewId` in presentation state. The Entry
form follows its ordered field IDs without changing model data or completeness
checks. Missing views remain explicit errors with the original query available
for repair. A model/entry/view intent must finish successfully before selection
updates rewrite the address bar.

Review & release explicitly reports its unavailable release services until the
release integration lands. Website preview labels the current visitor route as
live draft input and does not claim approval or activated immutable delivery.
Notifications continue to disclose disabled, unconnected delivery capabilities.
