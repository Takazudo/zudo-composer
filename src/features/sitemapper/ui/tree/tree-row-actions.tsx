/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Actions attached to one Sitemapper outline row (issue #410).
//
// Deleting a populated page never jumps to a modal. The inline confirmation is
// rendered in the row's action area, preserving the page title and its place
// in the outline while putting initial focus on the safe Cancel action.

import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX, Ref } from "preact";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from "../icons";

export interface DeleteConfirmProps {
  nodeTitle: string;
  descendantCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Inline confirmation for deleting one page subtree. */
export function DeleteConfirm({
  nodeTitle,
  descendantCount,
  onCancel,
  onConfirm,
}: DeleteConfirmProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const suffix = descendantCount === 1 ? "sub-page" : "sub-pages";

  return (
    <div
      class="sg-sitemapper-tree-confirm"
      role="group"
      aria-label={`Confirm deleting ${nodeTitle}`}
    >
      <span class="sg-sitemapper-tree-confirm-text">
        Delete {nodeTitle} and its {descendantCount} {suffix}?
      </span>
      <button
        ref={cancelRef}
        type="button"
        class="sg-sitemapper-tree-action"
        onClick={onCancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        class="sg-sitemapper-tree-action sg-sitemapper-tree-action-danger"
        onClick={onConfirm}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        Delete
      </button>
    </div>
  );
}

export interface TreeRowActionsProps {
  nodeTitle: string;
  isRoot: boolean;
  descendantCount: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  editing?: boolean;
  renameButtonRef?: Ref<HTMLButtonElement>;
  onAddChild: () => void;
  onAddSibling: () => void;
  onStartRename: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onSaveRename?: () => void;
  onCancelRename?: () => void;
  /** Stable id prefix for the row's root-action descriptions. */
  reasonId?: string;
}

function rootReasonId(nodeTitle: string, action: "sibling" | "delete"): string {
  // Titles are not guaranteed to be id-safe. The title is only a fallback for
  // this standalone component; SitemapTree supplies the stable node id via
  // `reasonId` below when it renders the row-level help text.
  return `sg-sitemapper-tree-${action}-help-${nodeTitle.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * All mutation affordances for one row. Root protection is expressed with
 * native disabled controls plus an aria-describedby explanation; controls are
 * never removed just because an action is unavailable.
 */
export function TreeRowActions({
  nodeTitle,
  isRoot,
  descendantCount,
  canMoveUp,
  canMoveDown,
  editing = false,
  renameButtonRef,
  onAddChild,
  onAddSibling,
  onStartRename,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDelete,
  onSaveRename,
  onCancelRename,
  reasonId,
}: TreeRowActionsProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const siblingHelpId = reasonId
    ? `${reasonId}-sibling-help`
    : rootReasonId(nodeTitle, "sibling");
  const deleteHelpId = reasonId
    ? `${reasonId}-delete-help`
    : rootReasonId(nodeTitle, "delete");

  if (editing) {
    return (
      <div class="sg-sitemapper-tree-row-actions sg-sitemapper-tree-row-actions-editing">
        <button
          type="button"
          class="sg-sitemapper-tree-action sg-sitemapper-tree-action-primary"
          onClick={onSaveRename}
        >
          Save
        </button>
        <button type="button" class="sg-sitemapper-tree-action" onClick={onCancelRename}>
          Cancel
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <DeleteConfirm
        nodeTitle={nodeTitle}
        descendantCount={descendantCount}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onDelete();
        }}
      />
    );
  }

  return (
    <div class="sg-sitemapper-tree-row-actions">
      <button
        type="button"
        class="sg-sitemapper-tree-action sg-sitemapper-tree-action-add"
        aria-label="Add child"
        title={`Add child to ${nodeTitle}`}
        onClick={onAddChild}
      >
        <PlusIcon size="xs" />
        <span class="sg-sitemapper-tree-action-label">Add child</span>
      </button>
      <button
        type="button"
        class="sg-sitemapper-tree-action sg-sitemapper-tree-action-add"
        disabled={isRoot}
        aria-describedby={isRoot ? siblingHelpId : undefined}
        aria-label="Add sibling"
        title={isRoot ? "The root page cannot have a sibling" : `Add sibling to ${nodeTitle}`}
        onClick={isRoot ? undefined : onAddSibling}
      >
        <PlusIcon size="xs" />
        <span class="sg-sitemapper-tree-action-label">Add sibling</span>
      </button>
      <button
        ref={renameButtonRef}
        type="button"
        class="sg-sitemapper-tree-action"
        aria-label="Rename"
        title={`Rename ${nodeTitle}`}
        onClick={onStartRename}
      >
        Rename
      </button>
      <button
        type="button"
        class="sg-sitemapper-tree-action"
        aria-label="Duplicate"
        title={`Duplicate ${nodeTitle}`}
        onClick={onDuplicate}
      >
        <CopyIcon size="xs" />
        <span class="sg-sitemapper-tree-action-label">Duplicate</span>
      </button>
      <button
        type="button"
        class="sg-sitemapper-tree-action"
        disabled={!canMoveUp}
        aria-label="Move up"
        title={canMoveUp ? `Move ${nodeTitle} up` : "Already first among siblings"}
        onClick={canMoveUp ? onMoveUp : undefined}
      >
        <ChevronUpIcon size="xs" />
        <span class="sg-sitemapper-tree-action-label">Move up</span>
      </button>
      <button
        type="button"
        class="sg-sitemapper-tree-action"
        disabled={!canMoveDown}
        aria-label="Move down"
        title={canMoveDown ? `Move ${nodeTitle} down` : "Already last among siblings"}
        onClick={canMoveDown ? onMoveDown : undefined}
      >
        <ChevronDownIcon size="xs" />
        <span class="sg-sitemapper-tree-action-label">Move down</span>
      </button>
      <button
        type="button"
        class="sg-sitemapper-tree-action sg-sitemapper-tree-action-danger"
        disabled={isRoot}
        aria-describedby={isRoot ? deleteHelpId : undefined}
        aria-label="Delete"
        title={isRoot ? "The root page cannot be deleted" : `Delete ${nodeTitle}`}
        onClick={() => {
          if (isRoot) return;
          if (descendantCount > 0) setConfirming(true);
          else onDelete();
        }}
      >
        <TrashIcon size="xs" />
        <span class="sg-sitemapper-tree-action-label">Delete</span>
      </button>
    </div>
  );
}

export default TreeRowActions;
