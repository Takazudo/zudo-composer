/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Structural actions for one structure-rail row (issue Takazudo/zudo-sg#250): sibling
// move-up/move-down (within the node's current slot only — cross-slot
// reparenting/drag-drop are explicitly out of scope, see Takazudo/zudo-sg#245's command
// comments) and subtree removal. Removal is a single action because document
// mutations can be recovered through Composer history.

import type { JSX } from "preact";
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from "../../../../components/icons";

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
