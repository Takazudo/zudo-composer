// The Composer structure rail, on the shared `OutlineTree` (epic #156).
//
// Every row is derived from `document` + `manifest` through
// `buildComposerOutline`, so there is no second row model to drift out of sync.
// The outline ids it renders are not all document ids — a slot has no id of its
// own — so `outline.rows` is the one place an id turns back into the thing it
// stands for, and every callback here goes through it.
//
// ── Expansion ───────────────────────────────────────────────────────────────
// A freshly opened composition shows its whole structure, so this pane tracks
// what the author CLOSED rather than what is open. The selected row is revealed
// by dropping its ancestor chain from that set, which is all the reveal
// contract needs: the canvas and the add flows already move `selectedId`.

import { computed, getScope, signal, type Child } from "@takazudo/zfb/zudo-react";
import type {
  ComponentCatalog,
  CompositionDocument,
  InsertionTarget,
  LinkedEditorLifecycleActions,
  LinkedEditorPresentation,
  RootPolicy,
} from "../../../../composer/browser";
import { RailCollapseButton, type EditorChromeController, type EditorRailsController } from "../../../../components/editor-chrome";
import { ArrowRightIcon, EllipsisIcon, PlusIcon, RefreshIcon } from "../../../../components/icons";
import { OutlineTree, type OutlineInsertSession, type OutlineInsertTarget, type OutlineNode } from "../../../../components/outline-tree";
import { read, toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { Banner, Button, Pane, PaneBody, PaneHeader } from "../../../../components/ui";
import type { ComponentDefinition } from "../../active-pack";
import { memo } from "../../reactive/memo";
import { buildCatalogById } from "./tree-helpers";
import {
  ancestorRowIds,
  buildComposerOutline,
  DOCUMENT_ROW_ID,
  insertionTargetFor,
  slotRowId,
  type ComposerOutline,
} from "./outline-model";

/** The slot an author has selected, when the selected row is a slot rather than a component. */
export interface SelectedSlot {
  parentId: string;
  slotId: string;
}

interface ComposerTreeInsertSession {
  resolveTarget: () => InsertionTarget | null;
  complete: (insertedId?: string) => void;
  cancel: () => void;
}

type LinkedActions = Pick<LinkedEditorLifecycleActions, "onOpenSource" | "onRetry">;

export interface ComposerStructurePaneProps {
  document: MaybeSignal<CompositionDocument>;
  /** The single app-layer `createComponentCatalog(entries)` derivation — never re-derived here. */
  manifest: MaybeSignal<ComponentCatalog>;
  /** The richer catalog backing component titles — the same array `manifest` came from. */
  entries: MaybeSignal<readonly ComponentDefinition[]>;
  /** The document's effective root policy — drives the root row's own rule tag/hint. */
  rootPolicy?: MaybeSignal<RootPolicy | undefined>;
  selectedId: MaybeSignal<string | null>;
  /** Bumped on every reveal, including a repeat of the current selection. */
  revealEpoch?: MaybeSignal<number>;
  selectedSlot: MaybeSignal<SelectedSlot | null>;
  /** A component row was chosen; wire to `controller.reveal`. */
  onSelectNode: (nodeId: string) => void;
  /** A slot row was chosen. `null` clears the slot selection. */
  onSelectSlot: (slot: SelectedSlot | null) => void;
  /** The document row was chosen — the virtual-root context. */
  onSelectDocument: () => void;
  onOpenChooser: (target: InsertionTarget, session?: ComposerTreeInsertSession) => void;
  /** Opens the node menu (Copy / Cut / Duplicate / Delete). */
  onOpenNodeMenu: (nodeId: string, trigger: HTMLElement) => void;
  /** Opens the insert menu (Add component… / Paste here). */
  onOpenInsertMenu: (target: InsertionTarget, trigger: HTMLElement, addComponent?: () => void) => void;
  /** Hides every mutating affordance — Preview mode. */
  readOnly?: MaybeSignal<boolean>;
  /** Linked source status sits outside this strictly local component tree. */
  linkedPresentation?: MaybeSignal<LinkedEditorPresentation>;
  linkedActions?: MaybeSignal<LinkedActions | undefined>;
  /** The editor chrome whose narrow-screen pane Enter switches to the inspector. */
  chrome?: EditorChromeController;
  /** The rails shared with the editor body; without it the pane has no collapse control. */
  rails?: EditorRailsController;
}

function Legend(): Child {
  return <span class="cms-tree__hint">Click = select · A = add · ⌫ = delete</span>;
}

function LinkedBanner({
  presentation,
  actions,
}: {
  presentation: LinkedEditorPresentation;
  actions?: LinkedActions;
}): Child {
  if (presentation.state === "local") return null;
  const openSource: Child = actions?.onOpenSource ? (
    <Button size="sm" on:click={() => actions.onOpenSource?.(presentation.sourceRecordId)}>
      <ArrowRightIcon size="sm" />
      Open source
    </Button>
  ) : null;

  if (presentation.state === "resolved") {
    return (
      <Banner tone="info" title="Linked template" action={openSource}>
        {`${presentation.sourceName} · Outlet: ${presentation.outletLabel || presentation.outletId} · Locked`}
      </Banner>
    );
  }
  return (
    <Banner
      tone="err"
      title="Linked template unavailable"
      action={
        <>
          {actions?.onRetry ? (
            <Button size="sm" on:click={() => actions.onRetry?.()}>
              <RefreshIcon size="sm" />
              Retry
            </Button>
          ) : null}
          {openSource}
        </>
      }
    >
      {presentation.message}
    </Banner>
  );
}

export function ComposerStructurePane({
  document: documentProp,
  manifest: manifestProp,
  entries: entriesProp,
  rootPolicy: rootPolicyProp,
  selectedId: selectedIdProp,
  revealEpoch: revealEpochProp = 0,
  selectedSlot: selectedSlotProp,
  onSelectNode,
  onSelectSlot,
  onSelectDocument,
  onOpenChooser,
  onOpenNodeMenu,
  onOpenInsertMenu,
  readOnly: readOnlyProp = false,
  linkedPresentation: linkedPresentationProp = { state: "local" },
  linkedActions: linkedActionsProp,
  chrome,
  rails,
}: ComposerStructurePaneProps): Child {
  const scope = getScope();
  const document = toSignal(documentProp);
  const manifest = toSignal(manifestProp);
  const entries = toSignal(entriesProp);
  const selectedId = toSignal(selectedIdProp);
  const selectedSlot = toSignal(selectedSlotProp);
  const catalogById = computed(() => buildCatalogById(entries.value));
  const outline = computed<ComposerOutline>(() =>
    buildComposerOutline({
      document: document.value,
      manifest: manifest.value,
      catalogById: catalogById.value,
      catalog: entries.value,
      rootPolicy: read(rootPolicyProp),
      readOnly: read(readOnlyProp),
    }),
  );
  const treeHost: { current: HTMLDivElement | null } = { current: null };
  let pendingDirectFocusId: string | null = null;

  // What the author closed, not what is open: a composition the editor has just
  // loaded shows its whole structure.
  const collapsedIds = signal<ReadonlySet<string>>(new Set());

  // Keyed on the selection and the reveal epoch alone: re-running on every
  // document edit would fight an author who deliberately closed the branch
  // they are editing in.
  let seenSelection: string | null | undefined;
  let seenEpoch: number | undefined;
  scope.effect(() => {
    const id = selectedId.value;
    const epoch = read(revealEpochProp);
    if (Object.is(id, seenSelection) && Object.is(epoch, seenEpoch)) return;
    seenSelection = id;
    seenEpoch = epoch;
    if (id === null) return;
    const ancestors = ancestorRowIds(document.value, manifest.value, id);
    const current = collapsedIds.value;
    if (!ancestors.some((ancestor) => current.has(ancestor))) return;
    const next = new Set(current);
    for (const ancestor of ancestors) next.delete(ancestor);
    collapsedIds.value = next;
  });

  const expandedIds = computed(() => outline.value.expandableIds.filter((id) => !collapsedIds.value.has(id)));

  function handleExpandedChange(ids: readonly string[]): void {
    const open = new Set(ids);
    collapsedIds.value = new Set(outline.value.expandableIds.filter((id) => !open.has(id)));
  }

  function handleSelect(rowId: string): void {
    const row = outline.value.rows.get(rowId);
    if (row === undefined) return;
    if (row.kind === "document") {
      onSelectSlot(null);
      onSelectDocument();
      return;
    }
    if (row.kind === "slot") {
      onSelectSlot({ parentId: row.parentId, slotId: row.slotId });
      onSelectNode(row.parentId);
      return;
    }
    onSelectSlot(null);
    onSelectNode(row.nodeId);
  }

  function canInsert(target: OutlineInsertTarget): boolean {
    return !read(readOnlyProp) && insertionTargetFor(outline.value, target.parentId, target.index) !== null;
  }

  function requestInsert(target: OutlineInsertTarget, session: OutlineInsertSession): void {
    const insertion = insertionTargetFor(outline.value, target.parentId, target.index);
    if (insertion) {
      onOpenChooser(insertion, {
        resolveTarget: () => {
          const resolved = session.resolveTarget();
          return resolved
            ? insertionTargetFor(outline.value, resolved.parentId, resolved.index)
            : null;
        },
        complete: (insertedId) => session.complete(insertedId),
        cancel: session.cancel,
      });
    }
  }

  function openTerminalChooser(rowId: string, initialTarget: InsertionTarget, origin: HTMLElement): void {
    let active = true;
    onOpenChooser(initialTarget, {
      resolveTarget: () => {
        if (!active) return null;
        const current = outline.value.rows.get(rowId);
        if (!current || (current.kind !== "document" && current.kind !== "slot")) return null;
        return current.kind === "document"
          ? insertionTargetFor(outline.value, DOCUMENT_ROW_ID, current.childCount)
          : insertionTargetFor(outline.value, slotRowId(current.parentId, current.slotId), current.childCount);
      },
      complete: (insertedId) => {
        if (!active) return;
        active = false;
        pendingDirectFocusId = insertedId ?? null;
      },
      cancel: () => {
        if (!active) return;
        active = false;
        if (origin.isConnected) origin.focus();
      },
    });
  }

  scope.effect(() => {
    void outline.value;
    const id = selectedId.value;
    if (pendingDirectFocusId === null || pendingDirectFocusId !== id) return;
    pendingDirectFocusId = null;
    treeHost.current?.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')?.focus();
  });

  /** The Add / More pair a row shows on hover and keyboard focus. */
  function renderActions(node: OutlineNode): Child {
    if (read(readOnlyProp)) return null;
    const current = outline.value;
    const row = current.rows.get(node.id);
    if (row === undefined) return null;

    if (row.kind === "component") {
      // The title alone collides across duplicate component types (two Box
      // leaves, say). The hint is the row's own distinguisher, so the action
      // borrows it to stay uniquely nameable.
      const displayName = node.hint === undefined ? node.title : `${node.title} ${node.hint}`;
      return (
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Open menu for ${displayName}`}
          title="More actions"
          on:click={(event: MouseEvent) => onOpenNodeMenu(row.nodeId, event.currentTarget as HTMLElement)}
        >
          <EllipsisIcon size="xs" />
        </Button>
      );
    }

    const target =
      row.kind === "document"
        ? insertionTargetFor(current, DOCUMENT_ROW_ID, row.childCount)
        : insertionTargetFor(current, slotRowId(row.parentId, row.slotId), row.childCount);
    if (target === null) return null;
    const where = row.kind === "document" ? "the document" : node.title;
    return (
      <>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Add component to ${where}`}
          on:click={(event: MouseEvent) => openTerminalChooser(node.id, target, event.currentTarget as HTMLElement)}
        >
          <PlusIcon size="xs" />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Insert options for ${where}`}
          title="Insert options"
          on:click={(event: MouseEvent) => {
            const trigger = event.currentTarget as HTMLElement;
            onOpenInsertMenu(target, trigger, () => openTerminalChooser(node.id, target, trigger));
          }}
        >
          <EllipsisIcon size="xs" />
        </Button>
      </>
    );
  }

  const selectedRowId = computed(() => {
    const slot = selectedSlot.value;
    return slot ? slotRowId(slot.parentId, slot.slotId) : (selectedId.value ?? DOCUMENT_ROW_ID);
  });
  const nodes = computed(() => outline.value.nodes);
  const total = computed(() => outline.value.total);
  const linked = memo(() => ({ presentation: read(linkedPresentationProp), actions: read(linkedActionsProp) }));
  // The tree's insert gate and row actions read the outline at call time, so a
  // read-only switch remounts the tree to re-evaluate both.
  const readOnly = computed(() => read(readOnlyProp));

  return (
    <Pane label="Structure">
      <PaneHeader title="Structure" count={total} actions={rails ? <RailCollapseButton rail="nav" rails={rails} /> : undefined} />
      <PaneBody>
        <Rebuild value={linked}>
          {(current) => <LinkedBanner presentation={current.presentation} actions={current.actions} />}
        </Rebuild>
        <div ref={treeHost}>
          <Rebuild value={readOnly}>
            {() => (
              <OutlineTree
                label="Structure"
                prefKey="composer"
                nodes={nodes}
                selectedId={selectedRowId}
                onSelect={handleSelect}
                onOpen={() => chrome?.setActivePane("insp")}
                expandedIds={expandedIds}
                onExpandedChange={handleExpandedChange}
                canInsert={canInsert}
                onRequestInsert={requestInsert}
                addLabel={() => "Add component"}
                renderActions={renderActions}
                legend={<Legend />}
              />
            )}
          </Rebuild>
        </div>
      </PaneBody>
    </Pane>
  );
}
