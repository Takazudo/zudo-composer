/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Structural actions for one structure-rail row (issue Takazudo/zudo-sg#250): sibling
// move-up/move-down (within the node's current slot only — cross-slot
// reparenting/drag-drop are explicitly out of scope, see Takazudo/zudo-sg#245's command
// comments) and subtree removal. Removal is a single action because document
// mutations can be recovered through Composer history.

import type { JSX } from "preact";
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from "../../../../components/icons";
import { InlineConfirm } from "../shared/inline-confirm";

export interface SubtreeRemovalConfirmProps {
  nodeTitle: string;
  descendantCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The inline "Remove X and its N nested components?" confirmation shown
 * before removing a populated subtree. Extracted so issue Takazudo/zudo-sg#256's node
 * context menu can reuse the EXACT same copy/behavior for its Delete item
 * (rendered as the menu's `children`, in place of its item list) instead of
 * re-deriving a second confirmation flow — see `use-composer-menus.ts`.
 *
 * A thin wrapper around the generic `InlineConfirm` (issue Takazudo/zudo-sg#269/#260, which
 * also unified this component's initial focus to land on Cancel — the SAFE
 * action — for both entry points, where before the menu path and this
 * component's own default disagreed).
 */
export function SubtreeRemovalConfirm({
  nodeTitle,
  descendantCount,
  onCancel,
  onConfirm,
}: SubtreeRemovalConfirmProps): JSX.Element {
  return (
    <InlineConfirm
      ariaLabel={`Confirm removing ${nodeTitle}`}
      message={`Remove ${nodeTitle} and its ${descendantCount} nested component${descendantCount === 1 ? "" : "s"}?`}
      confirmLabel="Confirm removal"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export interface TreeRowActionsProps {
  nodeTitle: string;
  descendantCount: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  readOnly?: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

export function TreeRowActions({
  nodeTitle,
  canMoveUp,
  canMoveDown,
  readOnly = false,
  onMoveUp,
  onMoveDown,
  onRemove,
}: TreeRowActionsProps): JSX.Element {
  if (readOnly) return <></>;

  return (
    <div class="sg-composer-tree-row-actions">
      <button
        type="button"
        class="sg-composer-tree-action"
        disabled={!canMoveUp}
        aria-label={`Move ${nodeTitle} up`}
        title="Move up"
        onClick={onMoveUp}
      >
        <ChevronUpIcon size="sm" />
      </button>
      <button
        type="button"
        class="sg-composer-tree-action"
        disabled={!canMoveDown}
        aria-label={`Move ${nodeTitle} down`}
        title="Move down"
        onClick={onMoveDown}
      >
        <ChevronDownIcon size="sm" />
      </button>
      <button
        type="button"
        class="sg-composer-tree-action sg-composer-tree-action-danger"
        aria-label={`Remove ${nodeTitle}`}
        title="Remove"
        onClick={onRemove}
      >
        <TrashIcon size="sm" />
      </button>
    </div>
  );
}
