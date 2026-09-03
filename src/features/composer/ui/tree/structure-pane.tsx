/** @jsxRuntime automatic */
/** @jsxImportSource preact */
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

import type { ComponentChildren, JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  ComponentCatalog,
  CompositionDocument,
  InsertionTarget,
  LinkedEditorLifecycleActions,
  LinkedEditorPresentation,
} from "../../../../composer/browser";
import { RailCollapseButton, useEditorChrome } from "../../../../components/editor-chrome";
import { ArrowRightIcon, EllipsisIcon, PlusIcon, RefreshIcon } from "../../../../components/icons";
import { OutlineTree, type OutlineInsertTarget, type OutlineNode } from "../../../../components/outline-tree";
import { Banner, Button, Pane, PaneBody, PaneHeader } from "../../../../components/ui";
import type { ComponentDefinition } from "../../active-pack";
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

export interface ComposerStructurePaneProps {
  document: CompositionDocument;
  /** The single app-layer `createComponentCatalog(entries)` derivation — never re-derived here. */
  manifest: ComponentCatalog;
  /** The richer catalog backing component titles — the same array `manifest` came from. */
  entries: readonly ComponentDefinition[];
  selectedId: string | null;
  selectedSlot: SelectedSlot | null;
  /** A component row was chosen; wire to `controller.reveal`. */
  onSelectNode: (nodeId: string) => void;
  /** A slot row was chosen. `null` clears the slot selection. */
  onSelectSlot: (slot: SelectedSlot | null) => void;
  /** The document row was chosen — the virtual-root context. */
  onSelectDocument: () => void;
  onOpenChooser: (target: InsertionTarget) => void;
  /** Opens the node menu (Copy / Cut / Duplicate / Delete). */
  onOpenNodeMenu: (nodeId: string, trigger: HTMLElement) => void;
  /** Opens the insert menu (Add component… / Paste here). */
  onOpenInsertMenu: (target: InsertionTarget, trigger: HTMLElement) => void;
  /** Hides every mutating affordance — Preview mode. */
  readOnly?: boolean;
  /** Linked source status sits outside this strictly local component tree. */
  linkedPresentation?: LinkedEditorPresentation;
  linkedActions?: Pick<LinkedEditorLifecycleActions, "onOpenSource" | "onRetry">;
}

function Legend(): JSX.Element {
  return <span class="cms-tree__hint">Click = select · A = add · ⌫ = delete</span>;
}

function LinkedBanner({
  presentation,
  actions,
}: {
  presentation: LinkedEditorPresentation;
  actions?: Pick<LinkedEditorLifecycleActions, "onOpenSource" | "onRetry">;
}): JSX.Element | null {
  if (presentation.state === "local") return null;
  const openSource: ComponentChildren = actions?.onOpenSource ? (
    <Button size="sm" onClick={() => actions.onOpenSource?.(presentation.sourceRecordId)}>
      <ArrowRightIcon size="sm" />
      Open source
    </Button>
  ) : null;

  if (presentation.state === "resolved") {
    return (
      <Banner tone="info" title="Linked template" action={openSource}>
        {presentation.sourceName} · Outlet: {presentation.outletLabel || presentation.outletId} · Locked
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
            <Button size="sm" onClick={() => actions.onRetry?.()}>
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
  document,
  manifest,
  entries,
  selectedId,
  selectedSlot,
  onSelectNode,
  onSelectSlot,
  onSelectDocument,
  onOpenChooser,
  onOpenNodeMenu,
  onOpenInsertMenu,
  readOnly = false,
  linkedPresentation = { state: "local" },
  linkedActions,
}: ComposerStructurePaneProps): JSX.Element {
  const { setActivePane } = useEditorChrome();
  const catalogById = useMemo(() => buildCatalogById(entries), [entries]);
  const outline = useMemo<ComposerOutline>(
    () => buildComposerOutline({ document, manifest, catalogById, readOnly }),
    [catalogById, document, manifest, readOnly],
  );

  // What the author closed, not what is open: a composition the editor has just
  // loaded shows its whole structure.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const revealed = useRef<string | null>(null);

  useEffect(() => {
    if (selectedId === null || revealed.current === selectedId) return;
    revealed.current = selectedId;
    const ancestors = ancestorRowIds(document, manifest, selectedId);
    setCollapsedIds((current) => {
      if (!ancestors.some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ancestors) next.delete(id);
      return next;
    });
    // Only a selection change reveals; re-running on every document edit would
    // fight an author who deliberately closed the branch they are editing in.
  }, [selectedId]);

  const expandedIds = useMemo(
    () => outline.expandableIds.filter((id) => !collapsedIds.has(id)),
    [collapsedIds, outline],
  );

  function handleExpandedChange(ids: readonly string[]): void {
    const open = new Set(ids);
    setCollapsedIds(new Set(outline.expandableIds.filter((id) => !open.has(id))));
  }

  function handleSelect(rowId: string): void {
    const row = outline.rows.get(rowId);
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
    return !readOnly && insertionTargetFor(outline, target.parentId, target.index) !== null;
  }

  function requestInsert(target: OutlineInsertTarget): void {
    const insertion = insertionTargetFor(outline, target.parentId, target.index);
    if (insertion) onOpenChooser(insertion);
  }

  /** The Add / More pair a row shows on hover and keyboard focus. */
  function renderActions(node: OutlineNode): ComponentChildren {
    if (readOnly) return null;
    const row = outline.rows.get(node.id);
    if (row === undefined) return null;

    if (row.kind === "component") {
      return (
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Open menu for ${node.title}`}
          title="More actions"
          onClick={(event) => onOpenNodeMenu(row.nodeId, event.currentTarget as HTMLElement)}
        >
          <EllipsisIcon size="xs" />
        </Button>
      );
    }

    const target =
      row.kind === "document"
        ? insertionTargetFor(outline, DOCUMENT_ROW_ID, row.childCount)
        : insertionTargetFor(outline, slotRowId(row.parentId, row.slotId), row.childCount);
    if (target === null) return null;
    const where = row.kind === "document" ? "the document" : node.title;
    return (
      <>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Add component to ${where}`}
          onClick={() => onOpenChooser(target)}
        >
          <PlusIcon size="xs" />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Insert options for ${where}`}
          title="Insert options"
          onClick={(event) => onOpenInsertMenu(target, event.currentTarget as HTMLElement)}
        >
          <EllipsisIcon size="xs" />
        </Button>
      </>
    );
  }

  const selectedRowId = selectedSlot
    ? slotRowId(selectedSlot.parentId, selectedSlot.slotId)
    : (selectedId ?? DOCUMENT_ROW_ID);

  return (
    <Pane label="Structure">
      <PaneHeader title="Structure" count={outline.total} actions={<RailCollapseButton rail="nav" />} />
      <PaneBody>
        <LinkedBanner presentation={linkedPresentation} actions={linkedActions} />
        <OutlineTree
          label="Structure"
          prefKey="composer"
          nodes={outline.nodes}
          selectedId={selectedRowId}
          onSelect={handleSelect}
          onOpen={() => setActivePane("insp")}
          expandedIds={expandedIds}
          onExpandedChange={handleExpandedChange}
          canInsert={canInsert}
          onRequestInsert={requestInsert}
          addLabel={() => "Add component"}
          renderActions={renderActions}
          legend={<Legend />}
        />
      </PaneBody>
    </Pane>
  );
}
