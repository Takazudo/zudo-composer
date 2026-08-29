/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// One recursive Sitemapper page row (issue Takazudo/zudo-sg#410).

import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type {
  SitemapDocument,
  SitemapDocumentIndex,
  SitemapNode,
} from "../../../../sitemapper/model";
import { ChevronDownIcon, ChevronRightIcon, PageIcon } from "../icons";
import { countDescendants, siblingBounds } from "./tree-helpers";
import { TreeRowActions } from "./tree-row-actions";

export interface TreeNodeCallbacks {
  onSelect: (nodeId: string) => void;
  onToggleExpanded: (nodeId: string) => void;
  onAddChild: (nodeId: string) => void;
  onAddSibling: (nodeId: string) => void;
  onRename: (nodeId: string, title: string) => void;
  onDuplicate: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onReorder: (nodeId: string, direction: "up" | "down") => void;
  registerRowRef: (nodeId: string, element: HTMLButtonElement | null) => void;
}

export interface TreeNodeProps extends TreeNodeCallbacks {
  node: SitemapNode;
  document: SitemapDocument;
  index: SitemapDocumentIndex;
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  depth: number;
  isRoot?: boolean;
}

function childListId(nodeId: string): string {
  return `sg-sitemapper-tree-children-${nodeId}`;
}

export function TreeNode({
  node,
  document,
  index,
  selectedId,
  expandedIds,
  depth,
  isRoot = false,
  onSelect,
  onToggleExpanded,
  onAddChild,
  onAddSibling,
  onRename,
  onDuplicate,
  onDelete,
  onReorder,
  registerRowRef,
}: TreeNodeProps): JSX.Element {
  const hasChildren = node.children.length > 0;
  const isExpanded = hasChildren && expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const bounds = siblingBounds(document, index, node.id);
  const descendants = countDescendants(node);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameTriggerRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef(false);

  useEffect(() => {
    if (editing) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing && returnFocusRef.current) {
      returnFocusRef.current = false;
      // Let the editing controls leave the DOM before restoring focus to the
      // action that opened them.
      const timer = setTimeout(() => renameTriggerRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraftTitle(node.title);
  }, [node.title, editing]);

  function startRename(): void {
    setDraftTitle(node.title);
    setEditing(true);
  }

  function cancelRename(): void {
    setEditing(false);
    returnFocusRef.current = true;
  }

  function saveRename(): void {
    // The persisted contract accepts any string title (including an empty
    // string); validation, if a product surface wants it, belongs to the
    // controller/inspector rather than silently rewriting inline input.
    const nextTitle = draftTitle;
    setEditing(false);
    returnFocusRef.current = true;
    if (nextTitle !== node.title) onRename(node.id, nextTitle);
  }

  function onRenameKeyDown(event: JSX.TargetedKeyboardEvent<HTMLInputElement>): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      saveRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  const rowStyle = {
    "--sg-sitemapper-tree-depth": depth,
  } as JSX.CSSProperties;

  return (
    <li
      class="sg-sitemapper-tree-node"
      data-sg-tree-node-id={node.id}
      data-sg-tree-depth={depth}
      data-sg-tree-root={isRoot ? "true" : undefined}
      style={rowStyle}
    >
      <div
        class="sg-sitemapper-tree-row"
        data-sg-selected={isSelected ? "true" : undefined}
        data-sg-tree-branch-open={isExpanded ? "true" : undefined}
        data-sg-tree-editing={editing ? "true" : undefined}
      >
        {hasChildren ? (
          <button
            type="button"
            class="sg-sitemapper-tree-disclosure"
            aria-expanded={isExpanded}
            aria-controls={childListId(node.id)}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.title}`}
            onClick={() => onToggleExpanded(node.id)}
          >
            {isExpanded ? <ChevronDownIcon size="xs" /> : <ChevronRightIcon size="xs" />}
          </button>
        ) : (
          <span class="sg-sitemapper-tree-disclosure-spacer" aria-hidden="true" />
        )}

        {editing ? (
          <div class="sg-sitemapper-tree-edit">
            <label class="sg-sitemapper-tree-sr-only" for={`sg-sitemapper-tree-rename-${node.id}`}>
              Page title
            </label>
            <input
              ref={renameInputRef}
              id={`sg-sitemapper-tree-rename-${node.id}`}
              class="sg-sitemapper-tree-rename-input"
              type="text"
              value={draftTitle}
              aria-label={`Rename ${node.title}`}
              onInput={(event) => {
                setDraftTitle(event.currentTarget.value);
              }}
              onKeyDown={onRenameKeyDown}
            />
          </div>
        ) : (
          <button
            ref={(element) => registerRowRef(node.id, element)}
            type="button"
            class="sg-sitemapper-tree-select"
            aria-pressed={isSelected}
            title={node.slug ? `${node.title} (${node.slug})` : node.title}
            onClick={() => onSelect(node.id)}
          >
            <PageIcon size="xs" class="sg-sitemapper-tree-node-icon" />
            <span class="sg-sitemapper-tree-select-title">{node.title}</span>
            {node.slug && <span class="sg-sitemapper-tree-select-slug">/{node.slug}</span>}
            {node.composition && (
              <span class="sg-sitemapper-tree-composition-badge" title="Composition assigned">
                Composition
              </span>
            )}
            {descendants > 0 && (
              <span class="sg-sitemapper-tree-count" aria-hidden="true">
                {descendants}
              </span>
            )}
          </button>
        )}

        <TreeRowActions
          nodeTitle={node.title}
          isRoot={isRoot}
          descendantCount={descendants}
          canMoveUp={bounds.canMoveUp}
          canMoveDown={bounds.canMoveDown}
          editing={editing}
          renameButtonRef={renameTriggerRef}
          reasonId={`sg-sitemapper-tree-${node.id}`}
          onAddChild={() => onAddChild(node.id)}
          onAddSibling={() => onAddSibling(node.id)}
          onStartRename={startRename}
          onDuplicate={() => onDuplicate(node.id)}
          onMoveUp={() => onReorder(node.id, "up")}
          onMoveDown={() => onReorder(node.id, "down")}
          onDelete={() => onDelete(node.id)}
          onSaveRename={saveRename}
          onCancelRename={cancelRename}
        />
      </div>

      {isRoot && (
        <>
          <span id={`sg-sitemapper-tree-${node.id}-sibling-help`} class="sg-sitemapper-tree-sr-only">
            The root page cannot have a sibling.
          </span>
          <span id={`sg-sitemapper-tree-${node.id}-delete-help`} class="sg-sitemapper-tree-sr-only">
            The root page cannot be deleted.
          </span>
        </>
      )}

      {isExpanded && (
        <ul id={childListId(node.id)} class="sg-sitemapper-tree-list sg-sitemapper-tree-list-nested">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              document={document}
              index={index}
              selectedId={selectedId}
              expandedIds={expandedIds}
              depth={depth + 1}
              onSelect={onSelect}
              onToggleExpanded={onToggleExpanded}
              onAddChild={onAddChild}
              onAddSibling={onAddSibling}
              onRename={onRename}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onReorder={onReorder}
              registerRowRef={registerRowRef}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default TreeNode;
