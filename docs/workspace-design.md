# Shared workspace design

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
origin was removed. Enter/Escape do not commit/cancel during IME composition.

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

Existing one-argument chooser callbacks remain callable but do not participate
in completion/cancellation or resolve stale positions. Composer's external
chooser must adopt the session when its workspace integration is updated
(issue #234); all new chooser consumers must use it. Sitemap's existing inline
handler already uses the complete inline path; its later chooser integrations
must use the same transaction API (issue #239).

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
action closes the owning menu chain; clicking inside a nested portal does not
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
