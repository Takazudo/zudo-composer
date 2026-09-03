import { Fragment } from "preact";
import type { JSX } from "preact";
import { ChevronDownIcon } from "../icons";
import { cx } from "../ui";
import { useOutlineTree } from "./outline-context";
import type { OutlineTreeContextValue } from "./outline-context";
import { OutlineAddRow, OutlineInsertGap } from "./outline-insert";
import { childrenOf, isExpandable, isLastInList } from "./tree-model";
import type { OutlineNode } from "./types";

interface RowPlacement {
  depth: number;
  index: number;
  siblingCount: number;
  parentId: string | null;
  /** Last element of its children list: the vline stops at the hline. */
  isLast: boolean;
}

/**
 * The ARIA and interaction contract every row button shares. `role="treeitem"`
 * lives on the button rather than on its wrapper so the tree item is the thing
 * that actually takes focus; `aria-level` / `aria-posinset` / `aria-setsize`
 * then carry the structure the wrapper would otherwise have implied.
 */
function useTreeItemProps(node: OutlineNode, placement: RowPlacement, expandable: boolean, expanded: boolean) {
  const tree = useOutlineTree();
  return {
    type: "button",
    role: "treeitem",
    "aria-level": placement.depth + 1,
    "aria-posinset": placement.index + 1,
    "aria-setsize": placement.siblingCount,
    "aria-selected": tree.selectedId === node.id,
    "aria-expanded": expandable ? expanded : undefined,
    tabIndex: tree.tabStopId === node.id ? 0 : -1,
    ref: (element: HTMLButtonElement | null) => tree.registerRow(node.id, element),
    onFocus: () => tree.noteFocus(node.id),
    onClick: () => tree.select(node.id),
    onDblClick: () => tree.open(node.id),
    onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => tree.handleRowKeyDown(event, node.id),
  } as const;
}

/**
 * Right-aligned mono slug and count — both hidden by the toolbar preferences.
 *
 * It renders inside the row's own button on every kind of row: only the
 * `treeitem` is in the accessibility tree, so metadata left beside it would be
 * announced to nobody. The actions and the caret cannot follow it in, being
 * buttons themselves.
 */
function RowMeta({ node }: { node: OutlineNode }) {
  return (
    <Fragment>
      {node.slug === undefined ? null : <span class="cms-tree-slug">{node.slug}</span>}
      {node.count === undefined ? null : <span class="cms-tree-count">({node.count})</span>}
      {node.tag === undefined ? null : <span class="cms-tree-tag">{node.tag}</span>}
      {node.status === undefined ? null : (
        <Fragment>
          <span class={`cms-tree-dot cms-tree-dot--${node.status.tone}`} title={node.status.label} aria-hidden="true" />
          <span class="cms-tree-sr-only">{node.status.label}</span>
        </Fragment>
      )}
    </Fragment>
  );
}

function RowActions({ node }: { node: OutlineNode }) {
  const tree = useOutlineTree();
  if (tree.renderActions === undefined) return null;
  return <span class="cms-tree-acts">{tree.renderActions(node)}</span>;
}

function RowToggle({ node, expanded }: { node: OutlineNode; expanded: boolean }) {
  const tree = useOutlineTree();
  return (
    <button
      class="cms-tree-toggle"
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
      onClick={() => tree.setExpanded(node.id, !expanded)}
    >
      <ChevronDownIcon size="xs" />
    </button>
  );
}

/**
 * A branch that already has children shows them when it is open. An empty one
 * still opens its children list when the host allows an insert there —
 * otherwise a node with no children could never be given any.
 */
function showChildrenList(
  tree: OutlineTreeContextValue,
  node: OutlineNode,
  expandable: boolean,
  expanded: boolean,
): boolean {
  if (expandable) return expanded;
  return tree.canInsert({ parentId: node.id, index: 0 });
}

function RowHint({ node }: { node: OutlineNode }) {
  if (node.hint === undefined) return null;
  return <span class="cms-tree-hint">{node.hint}</span>;
}

function CategoryRow({ node, placement, expanded }: { node: OutlineNode; placement: RowPlacement; expanded: boolean }) {
  const tree = useOutlineTree();
  const expandable = isExpandable(node);
  const itemProps = useTreeItemProps(node, placement, expandable, expanded);
  return (
    <section class="cms-tree-cat">
      <div class="cms-tree-cat__row">
        <button class="cms-tree-cat__link" {...itemProps}>
          <span class="cms-tree-mark" aria-hidden="true">
            »
          </span>
          <span class="cms-tree-title">{node.title}</span>
          <RowHint node={node} />
          <RowMeta node={node} />
        </button>
        <RowActions node={node} />
        {expandable ? <RowToggle node={node} expanded={expanded} /> : null}
      </div>
      {showChildrenList(tree, node, expandable, expanded) ? (
        <OutlineChildren parent={node} depth={placement.depth + 1} />
      ) : null}
    </section>
  );
}

function GroupNode({ node, placement, expanded }: { node: OutlineNode; placement: RowPlacement; expanded: boolean }) {
  const tree = useOutlineTree();
  const expandable = isExpandable(node);
  const itemProps = useTreeItemProps(node, placement, expandable, expanded);
  const depth = String(placement.depth);
  return (
    <div class={cx("cms-tree-group", placement.isLast && "is-last")}>
      {/* The spine carries the parent's dashes past this whole subtree, so the
          next sibling still hangs off an unbroken line. A last group closes the
          branch instead, and has none. */}
      {placement.isLast ? null : <span class="cms-tree-spine" style={{ "--depth": depth }} />}
      <div class={cx("cms-tree-group__header", placement.isLast && "is-last")} style={{ "--depth": depth }}>
        <span class="cms-tree-vline" />
        <span class="cms-tree-hline" />
        <button
          class={cx("cms-tree-group__row", node.variant === "slot" && "cms-tree-group__row--slot")}
          {...itemProps}
        >
          <span class="cms-tree-title">{node.title}</span>
          <RowHint node={node} />
          <RowMeta node={node} />
        </button>
        <RowActions node={node} />
        {expandable ? <RowToggle node={node} expanded={expanded} /> : null}
      </div>
      {showChildrenList(tree, node, expandable, expanded) ? (
        <OutlineChildren parent={node} depth={placement.depth + 1} />
      ) : null}
    </div>
  );
}

function LeafRow({ node, placement }: { node: OutlineNode; placement: RowPlacement }) {
  const itemProps = useTreeItemProps(node, placement, false, false);
  return (
    <div class={cx("cms-tree-leaf-wrap", placement.isLast && "is-last")} style={{ "--depth": String(placement.depth) }}>
      <span class="cms-tree-vline" />
      <span class="cms-tree-hline" />
      <button class="cms-tree-leaf" {...itemProps}>
        <span class="cms-tree-title">{node.title}</span>
        <RowHint node={node} />
        <RowMeta node={node} />
      </button>
      <RowActions node={node} />
    </div>
  );
}

export function OutlineNodeRow({ node, placement }: { node: OutlineNode; placement: RowPlacement }) {
  const tree = useOutlineTree();
  const expanded = isExpandable(node) && tree.expandedIds.has(node.id);
  if (node.kind === "category") return <CategoryRow node={node} placement={placement} expanded={expanded} />;
  if (node.kind === "group") return <GroupNode node={node} placement={placement} expanded={expanded} />;
  return <LeafRow node={node} placement={placement} />;
}

/**
 * One children list: a zero-height insert point between every pair of siblings,
 * then the terminal "Add …" row that closes the branch.
 */
export function OutlineChildren({ parent, depth }: { parent: OutlineNode; depth: number }) {
  const tree = useOutlineTree();
  const children = childrenOf(parent);
  const addTarget = { parentId: parent.id, index: children.length };
  const hasAddRow = tree.canInsert(addTarget);

  return (
    <div class="cms-tree-children" role="group" aria-label={parent.title}>
      {children.map((child, index) => (
        <Fragment key={child.id}>
          {index === 0 ? null : (
            <OutlineInsertGap
              target={{ parentId: parent.id, index }}
              depth={depth}
              beforeTitle={child.title}
            />
          )}
          <OutlineNodeRow
            node={child}
            placement={{
              depth,
              index,
              siblingCount: children.length,
              parentId: parent.id,
              isLast: isLastInList(index, children.length, hasAddRow),
            }}
          />
        </Fragment>
      ))}
      <OutlineAddRow parent={parent} target={addTarget} depth={depth} />
    </div>
  );
}

export type { RowPlacement };
