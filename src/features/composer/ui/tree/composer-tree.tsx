/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer structure rail (issue Takazudo/zudo-sg#250) — a recursive, fully controlled
// tree over a `CompositionDocument` + the derived Composer catalog. Every row
// is DERIVED from `document` + `manifest`; there is no separate row model to
// drift out of sync (see `TreeNode`'s per-row derivation via `tree-helpers.ts`).
//
// ── The virtual-root pseudo-row ─────────────────────────────────────────────
// `document.root`'s children render below one "Document root" section header.
// That header is an INSERTION TARGET ONLY (`{ parentId: null, slotId:
// VIRTUAL_ROOT_SLOT_ID }`) — it is never a `CompositionNode`, is never itself
// a nested hierarchy level, movable/removable, or collapsible (there is no id
// to track in `expandedIds`). Selecting it calls `onSelect(null)` — the same "clear to
// virtual-root context" state `removeNode`'s selection repair (Takazudo/zudo-sg#245) falls
// back to when nothing remains selected.
//
// ── The reveal contract ─────────────────────────────────────────────────────
// This component is a fully controlled render of `selectedId`/`expandedIds` —
// it never owns selection or expansion state itself. That is what lets a
// FUTURE caller (e.g. the edit-canvas wave) "reveal" a node with no API of its
// own: expand that node's ancestors (`ancestorChainIds` in `tree-helpers.ts`,
// exactly what `controller.reveal()` already does — see Takazudo/zudo-sg#247's
// `controller-model.ts`) and set `selectedId`. Whenever `selectedId` changes to
// an id that is now rendered (its ancestors are in `expandedIds`), this
// component scrolls that row into view — see the `useEffect` below. No ref /
// imperative handle is needed; the two controlled props ARE the reveal API.
//
// Real component rows call `onReveal` (not `onSelect`) on primary click —
// `onReveal` is intended to be wired to `controller.reveal`, which selects AND
// expands ancestors in one action (a no-op beyond selecting for an
// already-visible row, and exactly right for a future canvas-driven selection
// reaching into a collapsed branch of the tree).

import { useEffect, useMemo, useRef } from "preact/hooks";
import type { JSX } from "preact";
import type {
  ComponentCatalog,
  CompositionDocument,
  GlobalTemplateOutletTarget,
  InsertionTarget,
  LinkedEditorLifecycleActions,
  LinkedEditorPresentation,
} from "../../../../composer/browser";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../composer/browser";
import { ArrowRightIcon, EllipsisIcon, PageIcon, PlusIcon, RefreshIcon } from "../../../../components/icons";
import type { ComponentDefinition } from "../../active-pack";
import { buildCatalogById, buildDocumentIndex, countDescendants } from "./tree-helpers";
import { TreeNode } from "./tree-node";
import type { ReuseAuthoringActionResult } from "../shared/reuse-authoring-contract";

export interface ComposerTreeProps {
  document: CompositionDocument;
  /** The single app-layer `createComponentCatalog(entries)` derivation (issue Takazudo/zudo-sg#290) — never re-derived here. */
  manifest: ComponentCatalog;
  /** The richer catalog backing display metadata (title/category/description) — same array `manifest` was derived from. */
  entries: readonly ComponentDefinition[];
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  /** Virtual-root row selection (nodeId is always `null`) — wire to `controller.select`. */
  onSelect: (nodeId: string | null) => void;
  /** Real-node primary selection — wire to `controller.reveal` (selects + expands ancestors). */
  onReveal: (nodeId: string) => void;
  onToggleExpanded: (nodeId: string) => void;
  onOpenChooser: (target: InsertionTarget) => void;
  onReorder: (nodeId: string, direction: "up" | "down") => void;
  onRemove: (nodeId: string) => void;
  /** Opens the node context menu (Copy/Cut/Duplicate/Delete — issue Takazudo/zudo-sg#256). */
  onOpenNodeMenu: (nodeId: string, trigger: HTMLElement) => void;
  /** Opens the insert menu (Add component…/Paste here — issue Takazudo/zudo-sg#256), alongside the direct "+Add". */
  onOpenInsertMenu: (target: InsertionTarget, trigger: HTMLElement) => void;
  /** Hides every mutating affordance (Add/move/remove) — e.g. while in Preview mode. */
  readOnly?: boolean;
  /** Provider-checked publish/reassign operation for a real empty component slot. */
  onSetGlobalTemplateOutlet?: (
    target: GlobalTemplateOutletTarget,
    label: string,
  ) => Promise<ReuseAuthoringActionResult>;
  /** Linked source status sits OUTSIDE this strictly local component tree. */
  linkedPresentation?: LinkedEditorPresentation;
  /** Provider-owning caller injects navigation/retry; this tree owns no lifecycle state. */
  linkedActions?: Pick<LinkedEditorLifecycleActions, "onOpenSource" | "onRetry">;
}

export function ComposerTree({
  document,
  manifest,
  entries,
  selectedId,
  expandedIds,
  onSelect,
  onReveal,
  onToggleExpanded,
  onOpenChooser,
  onReorder,
  onRemove,
  onOpenNodeMenu,
  onOpenInsertMenu,
  readOnly = false,
  onSetGlobalTemplateOutlet,
  linkedPresentation = { state: "local" },
  linkedActions,
}: ComposerTreeProps): JSX.Element {
  const catalogById = useMemo(() => buildCatalogById(entries), [entries]);
  const documentIndex = useMemo(() => buildDocumentIndex(document, manifest), [document, manifest]);

  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const registerRowRef = (nodeId: string, element: HTMLButtonElement | null) => {
    if (element) rowRefs.current.set(nodeId, element);
    else rowRefs.current.delete(nodeId);
  };

  // The reveal contract: whenever the controlled `selectedId` changes to a
  // node that is currently rendered (its row ref is registered — i.e. its
  // ancestors are already in `expandedIds`), scroll it into view. This is the
  // ONLY thing a future caller needs for "reveal" beyond updating
  // `selectedId`/`expandedIds` themselves.
  useEffect(() => {
    if (selectedId === null) return;
    const el = rowRefs.current.get(selectedId);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId, expandedIds]);

  const rootTotal = document.root.reduce((sum, node) => sum + 1 + countDescendants(node), 0);
  const rootSelected = selectedId === null;

  return (
    <div class="sg-composer-tree">
      {linkedPresentation.state === "resolved" && (
        <section class="sg-composer-linked-frame" data-sg-linked-frame="resolved" aria-label="Linked Global template">
          <p>
            <strong>Linked template</strong>
            <span>{linkedPresentation.sourceName}</span>
            <span>Outlet: {linkedPresentation.outletLabel || linkedPresentation.outletId}</span>
            <span>Locked</span>
          </p>
          {linkedActions?.onOpenSource && (
            <button
              type="button"
              class="sg-composer-tree-action sg-composer-linked-open"
              onClick={() => linkedActions.onOpenSource?.(linkedPresentation.sourceRecordId)}
            >
              <ArrowRightIcon size="xs" class="sg-composer-button-icon" />
              Open source
            </button>
          )}
        </section>
      )}
      {linkedPresentation.state === "blocked" && (
        <section class="sg-composer-linked-frame" data-sg-linked-frame="blocked" role="status">
          <p><strong>Linked template unavailable</strong> {linkedPresentation.message}</p>
          <div>
            {linkedActions?.onRetry && (
              <button type="button" class="sg-composer-tree-action" onClick={() => linkedActions.onRetry?.()}>
                <RefreshIcon size="xs" class="sg-composer-button-icon" />
                Retry
              </button>
            )}
            {linkedActions?.onOpenSource && (
              <button
                type="button"
                class="sg-composer-tree-action sg-composer-linked-open"
                onClick={() => linkedActions.onOpenSource?.(linkedPresentation.sourceRecordId)}
              >
                <ArrowRightIcon size="xs" class="sg-composer-button-icon" />
                Open source
              </button>
            )}
          </div>
        </section>
      )}
      <div
        class="sg-composer-tree-row sg-composer-tree-row-root"
        data-sg-selected={rootSelected}
        data-sg-tree-section-header
      >
        <span class="sg-composer-tree-disclosure-spacer" aria-hidden="true" />
        <button
          type="button"
          class="sg-composer-tree-select sg-composer-tree-select-root"
          aria-pressed={rootSelected}
          onClick={() => onSelect(null)}
        >
          <PageIcon size="xs" class="sg-composer-tree-node-icon" />
          <span class="sg-composer-tree-select-title">Document root</span>
          <span class="sg-composer-tree-count" aria-hidden="true">
            {rootTotal}
          </span>
        </button>
        {!readOnly && (
          <div class="sg-composer-tree-row-actions">
            <button
              type="button"
              class="sg-composer-tree-action sg-composer-tree-add"
              aria-label="Add component to document root"
              onClick={() =>
                onOpenChooser({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: document.root.length })
              }
            >
              <PlusIcon size="xs" class="sg-composer-button-icon" />
              <span>Add</span>
            </button>
            <button
              type="button"
              class="sg-composer-tree-action sg-composer-tree-insert-menu"
              aria-label="Insert options for document root"
              title="Insert options"
              onClick={(event) =>
                onOpenInsertMenu(
                  { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: document.root.length },
                  event.currentTarget as HTMLElement,
                )
              }
            >
              <EllipsisIcon size="xs" />
            </button>
          </div>
        )}
      </div>

      {document.root.length === 0 ? (
        <p class="sg-composer-tree-empty">Empty document — add a component to get started.</p>
      ) : (
        <ul class="sg-composer-tree-list">
          {document.root.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              document={document}
              manifest={manifest}
              catalogById={catalogById}
              index={documentIndex}
              selectedId={selectedId}
              expandedIds={expandedIds}
              readOnly={readOnly}
              onReveal={onReveal}
              onToggleExpanded={onToggleExpanded}
              onOpenChooser={onOpenChooser}
              onReorder={onReorder}
              onRemove={onRemove}
              registerRowRef={registerRowRef}
              onOpenNodeMenu={onOpenNodeMenu}
              onOpenInsertMenu={onOpenInsertMenu}
              onSetGlobalTemplateOutlet={onSetGlobalTemplateOutlet}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// Re-exported so Takazudo/zudo-sg#251/other waves can compose the same row-action affordance
// elsewhere (e.g. a future canvas selection toolbar) without reaching into
// this module's internals.
export { TreeRowActions, SubtreeRemovalConfirm } from "./tree-row-actions";
export type { TreeRowActionsProps, SubtreeRemovalConfirmProps } from "./tree-row-actions";
