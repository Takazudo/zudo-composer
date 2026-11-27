import { computed, For, getScope, Show, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { Rebuild } from "../rebuild";
import { DisclosureButton, InlineRename, cx } from "../ui";
import type { OutlineTreeState } from "./outline-tree-state";
import { OutlineAddRow, OutlineInsertGap } from "./outline-insert";
import { childrenOf, isExpandable, isLastInList } from "./tree-model";
import type { OutlineInsertTarget, OutlineNode } from "./types";

interface RowPlacement {
  depth: number;
  index: number;
  siblingCount: number;
  parentId: string | null;
  /** Last element of its children list: the vline stops at the hline. */
  isLast: boolean;
}

interface RowProps {
  tree: OutlineTreeState;
  /** Follows the host's node; the row is keyed by id and kind, so both are fixed. */
  node: ReadonlySignal<OutlineNode>;
  placement: ReadonlySignal<RowPlacement>;
}

/** List keys: a node that changes kind renders a different row component. */
export function nodeKey(node: OutlineNode): string {
  return `${node.id}\u0000${node.kind}`;
}

/**
 * The ARIA and interaction contract every row button shares. `role="treeitem"`
 * lives on the button rather than on its wrapper so the tree item is the thing
 * that actually takes focus; `aria-level` / `aria-posinset` / `aria-setsize`
 * then carry the structure the wrapper would otherwise have implied.
 */
function treeItemProps(
  { tree, node, placement }: RowProps,
  ref: Ref<HTMLButtonElement>,
  expandable: ReadonlySignal<boolean>,
  expanded: ReadonlySignal<boolean>,
) {
  const id = node.value.id;
  getScope().onActivate(() => {
    const element = ref.current;
    return element ? tree.registerRow(id, element) : undefined;
  });
  return {
    ref,
    type: "button",
    role: "treeitem",
    "aria-level": computed(() => String(placement.value.depth + 1)),
    "aria-posinset": computed(() => String(placement.value.index + 1)),
    "aria-setsize": computed(() => String(placement.value.siblingCount)),
    "aria-selected": computed(() => (tree.selectedId.value === id ? "true" : "false")),
    "aria-expanded": computed(() => (expandable.value ? (expanded.value ? "true" : "false") : undefined)),
    tabindex: computed(() => (tree.tabStopId.value === id ? 0 : -1)),
    "on:focus": () => tree.noteFocus(id),
    "on:click": () => tree.select(id),
    "on:dblclick": () => tree.open(id),
    "on:keydown": (event: KeyboardEvent) => tree.handleRowKeyDown(event, id),
  } as const;
}

/**
 * Right-aligned mono slug and count — both hidden by the toolbar preferences.
 *
 * It renders inside the row's own button on every kind of row: only the
 * `treeitem` is in the accessibility tree, so metadata left beside it would be
 * announced to nobody. The actions and the caret cannot follow it in, being
 * buttons themselves. It is rebuilt with the node; the button around it stays.
 */
function RowMeta({ node }: { node: OutlineNode }): Child {
  return (
    <>
      {node.slug === undefined ? null : <span class="cms-tree-slug" title={node.slug}>{node.slug}</span>}
      {node.count === undefined ? null : <span class="cms-tree-count">({node.count})</span>}
      {node.tag === undefined ? null : (
        <span class={cx("cms-tree-tag", node.tagVariant === "rule" && "cms-tree-tag--rule")} title={node.tagDetail}>
          {node.tag}
        </span>
      )}
      {node.status === undefined ? null : (
        <>
          <span class={`cms-tree-dot cms-tree-dot--${node.status.tone}`} title={node.status.label} aria-hidden="true" />
          <span class="cms-tree-sr-only">{node.status.label}</span>
        </>
      )}
    </>
  );
}

function RowHint({ node }: { node: OutlineNode }): Child {
  if (node.hint === undefined) return null;
  return <span class="cms-tree-hint" title={node.hint}>{node.hint}</span>;
}

/** The button's own content: title, hint and metadata, rebuilt as the node changes. */
function RowLabel({ node, mark }: { node: ReadonlySignal<OutlineNode>; mark?: boolean }): Child {
  return (
    <Rebuild value={node}>
      {(current) => (
        <>
          {mark ? <span class="cms-tree-mark" aria-hidden="true">»</span> : null}
          <span class="cms-tree-title">{current.title}</span>
          <RowHint node={current} />
          <RowMeta node={current} />
        </>
      )}
    </Rebuild>
  );
}

function RowActions({ tree, node }: Pick<RowProps, "tree" | "node">): Child {
  const renderActions = tree.renderActions;
  if (renderActions === undefined) return null;
  return <span class="cms-tree-acts"><Rebuild value={node}>{(current) => renderActions(current)}</Rebuild></span>;
}

function RowRename({ tree, node }: Pick<RowProps, "tree" | "node">): Child {
  const id = node.value.id;
  return (
    <Show when={computed(() => tree.renamingId.value === id)}>
      {() => (
        <div class="cms-tree-rename">
          <InlineRename value={node.value.title} label={`Rename ${node.value.title}`}
            onCommit={(title) => tree.commitRename(id, title)} onCancel={tree.cancelRename} />
        </div>
      )}
    </Show>
  );
}

function RowToggle({ tree, node, expanded }: Pick<RowProps, "tree" | "node"> & { expanded: ReadonlySignal<boolean> }): Child {
  const id = node.value.id;
  return (
    <DisclosureButton
      class="cms-tree-toggle"
      expanded={expanded}
      aria-label={computed(() => `${expanded.value ? "Collapse" : "Expand"} ${node.value.title}`)}
      on:click={() => tree.setExpanded(id, !expanded.value)}
    />
  );
}

function rowState({ tree, node }: Pick<RowProps, "tree" | "node">) {
  const id = node.value.id;
  const expandable = computed(() => isExpandable(node.value));
  const expanded = computed(() => expandable.value && tree.expandedIds.value.has(id));
  // A branch that already has children shows them when it is open. An empty
  // one still opens its children list when the host allows an insert there —
  // otherwise a node with no children could never be given any.
  const showChildren = computed(() => (expandable.value ? expanded.value : tree.canInsert({ parentId: id, index: 0 })));
  return { expandable, expanded, showChildren };
}

function warnRail(node: ReadonlySignal<OutlineNode>): ReadonlySignal<boolean> {
  return computed(() => node.value.status?.tone === "warn");
}

function CategoryRow(props: RowProps): Child {
  const { tree, node, placement } = props;
  const { expandable, expanded, showChildren } = rowState(props);
  const ref: Ref<HTMLButtonElement> = { current: null };
  const itemProps = treeItemProps(props, ref, expandable, expanded);
  const warn = warnRail(node);
  return (
    <section class="cms-tree-cat">
      <div class={computed(() => cx("cms-tree-cat__row", warn.value && "cms-tree-row--warn-rail"))}>
        <button class="cms-tree-cat__link" {...itemProps}>
          <RowLabel node={node} mark />
        </button>
        <RowRename tree={tree} node={node} />
        <RowActions tree={tree} node={node} />
        <Show when={expandable}>{() => <RowToggle tree={tree} node={node} expanded={expanded} />}</Show>
      </div>
      <Show when={showChildren}>{() => <OutlineChildren tree={tree} parent={node} depth={placement.value.depth + 1} />}</Show>
    </section>
  );
}

function GroupNode(props: RowProps): Child {
  const { tree, node, placement } = props;
  const { expandable, expanded, showChildren } = rowState(props);
  const ref: Ref<HTMLButtonElement> = { current: null };
  const itemProps = treeItemProps(props, ref, expandable, expanded);
  const warn = warnRail(node);
  const isLast = computed(() => placement.value.isLast);
  const depth = `--depth:${placement.value.depth}`;
  return (
    <div class={computed(() => cx("cms-tree-group", isLast.value && "is-last"))}>
      {/* The spine carries the parent's dashes past this whole subtree, so the
          next sibling still hangs off an unbroken line. A last group closes the
          branch instead, and has none. */}
      <Show when={computed(() => !isLast.value)}>{() => <span class="cms-tree-spine" style={depth} />}</Show>
      <div
        class={computed(() => cx("cms-tree-group__header", isLast.value && "is-last", warn.value && "cms-tree-row--warn-rail"))}
        style={depth}
      >
        <span class="cms-tree-vline" />
        <span class="cms-tree-hline" />
        <button
          class={computed(() => cx("cms-tree-group__row", node.value.variant === "slot" && "cms-tree-group__row--slot"))}
          {...itemProps}
        >
          <RowLabel node={node} />
        </button>
        <RowRename tree={tree} node={node} />
        <RowActions tree={tree} node={node} />
        <Show when={expandable}>{() => <RowToggle tree={tree} node={node} expanded={expanded} />}</Show>
      </div>
      <Show when={showChildren}>{() => <OutlineChildren tree={tree} parent={node} depth={placement.value.depth + 1} />}</Show>
    </div>
  );
}

function LeafRow(props: RowProps): Child {
  const { tree, node, placement } = props;
  const ref: Ref<HTMLButtonElement> = { current: null };
  const never = computed(() => false);
  const itemProps = treeItemProps(props, ref, never, never);
  const warn = warnRail(node);
  return (
    <div
      class={computed(() => cx("cms-tree-leaf-wrap", placement.value.isLast && "is-last", warn.value && "cms-tree-row--warn-rail"))}
      style={`--depth:${placement.value.depth}`}
    >
      <span class="cms-tree-vline" />
      <span class="cms-tree-hline" />
      <button class="cms-tree-leaf" {...itemProps}>
        <RowLabel node={node} />
      </button>
      <RowRename tree={tree} node={node} />
      <RowActions tree={tree} node={node} />
    </div>
  );
}

export function OutlineNodeRow(props: RowProps): Child {
  const kind = props.node.value.kind;
  if (kind === "category") return <CategoryRow {...props} />;
  if (kind === "group") return <GroupNode {...props} />;
  return <LeafRow {...props} />;
}

/**
 * One list of siblings, each preceded by its zero-height insert point. Shared
 * by the root list and every children list.
 */
export function OutlineSiblings({
  tree,
  list,
  parentId,
  depth,
  hasAddRow,
  root,
}: {
  tree: OutlineTreeState;
  list: ReadonlySignal<readonly OutlineNode[]>;
  parentId: string | null;
  depth: number;
  hasAddRow: ReadonlySignal<boolean>;
  root?: boolean;
}): Child {
  return (
    <For each={list} by={nodeKey}>
      {(child, index) => {
        const target = computed<OutlineInsertTarget>(() => ({ parentId, index: index.value }));
        const placement = computed<RowPlacement>(() => ({
          depth,
          index: index.value,
          siblingCount: list.value.length,
          parentId,
          isLast: isLastInList(index.value, list.value.length, hasAddRow.value),
        }));
        return (
          <>
            <OutlineInsertGap tree={tree} target={target} depth={depth} beforeTitle={computed(() => child.value.title)} root={root} />
            <OutlineNodeRow tree={tree} node={child} placement={placement} />
          </>
        );
      }}
    </For>
  );
}

/**
 * One children list: a zero-height insert point between every pair of siblings,
 * then the terminal "Add …" row that closes the branch.
 */
export function OutlineChildren({ tree, parent, depth }: { tree: OutlineTreeState; parent: ReadonlySignal<OutlineNode>; depth: number }): Child {
  const parentId = parent.value.id;
  const children = computed(() => childrenOf(parent.value));
  const addTarget = computed<OutlineInsertTarget>(() => ({ parentId, index: children.value.length }));
  const hasAddRow = computed(() => tree.canInsert(addTarget.value));

  return (
    <div class="cms-tree-children" role="group" aria-label={computed(() => parent.value.title)}>
      <OutlineSiblings tree={tree} list={children} parentId={parentId} depth={depth} hasAddRow={hasAddRow} />
      <OutlineAddRow tree={tree} parent={parent} target={addTarget} depth={depth} />
    </div>
  );
}

export type { RowPlacement };
