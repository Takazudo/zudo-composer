import { Fragment } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Button, Switch, cx, nextRovingIndex } from "../ui";
import { OutlineTreeProvider } from "./outline-context";
import type { OutlineTreeContextValue } from "./outline-context";
import { OutlineAddRoot, OutlineInsertGap } from "./outline-insert";
import { OutlineNodeRow } from "./outline-rows";
import { readOutlinePrefs, writeOutlinePrefs } from "./prefs";
import type { OutlinePrefs } from "./prefs";
import { collectExpandableIds, flattenVisibleRows, insertTargetAfter, isLastInList } from "./tree-model";
import type { OutlineInsertTarget, OutlineTreeProps } from "./types";

/** Keys the roving helper answers here; Left/Right belong to the tree itself. */
const ROVING_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);
/** Both shorthands for "add a sibling below this row". */
const INSERT_KEYS = new Set(["a", "A", "+"]);

function defaultAddLabel(parent: { title: string } | null): string {
  return parent === null ? "Add root item" : "Add item";
}

/**
 * A toolbar label that shortens below 400px of tree width. The visible text is
 * hidden from assistive technology and a complete copy carries the accessible
 * name, so what the control is called never changes with the width.
 */
function ToolbarLabel({ name, children }: { name: string; children: ComponentChildren }) {
  return (
    <Fragment>
      <span aria-hidden="true">{children}</span>
      <span class="cms-tree-sr-only">{name}</span>
    </Fragment>
  );
}

/**
 * The zudo-doc outline: categories at the root, dashed connectors down to
 * groups and leaves, and a zero-height insert point between every pair of
 * siblings.
 *
 * Selection and expansion are controlled by the host. Expansion falls back to
 * internal state — everything open — when `expandedIds` is omitted, so a tree
 * is useful before its host has any state of its own.
 */
export function OutlineTree(props: OutlineTreeProps) {
  const {
    nodes,
    label = "Outline",
    selectedId,
    onSelect,
    onOpen,
    expandedIds,
    onExpandedChange,
    renderActions,
    canInsert,
    onRequestInsert,
    onAdd,
    addLabel = defaultAddLabel,
    showToolbar = true,
    prefKey,
    legend,
    class: className,
  } = props;

  const expandableIds = useMemo(() => collectExpandableIds(nodes), [nodes]);
  const [ownExpandedIds, setOwnExpandedIds] = useState<readonly string[] | null>(null);
  const currentExpandedIds = expandedIds ?? ownExpandedIds ?? expandableIds;
  const expandedSet = useMemo(() => new Set(currentExpandedIds), [currentExpandedIds]);
  const rows = useMemo(() => flattenVisibleRows(nodes, expandedSet), [nodes, expandedSet]);

  const [prefs, setPrefs] = useState<OutlinePrefs>(() => readOutlinePrefs(prefKey));
  const [editing, setEditing] = useState<OutlineInsertTarget | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const rowElements = useRef(new Map<string, HTMLElement>());
  /** The row an insert was requested from, so Escape puts focus back. */
  const editOriginId = useRef<string | null>(null);
  const restoreFocusId = useRef<string | null>(null);

  useEffect(() => {
    setPrefs(readOutlinePrefs(prefKey));
  }, [prefKey]);

  useEffect(() => {
    const id = restoreFocusId.current;
    if (id === null) return;
    restoreFocusId.current = null;
    rowElements.current.get(id)?.focus();
  });

  function focusRow(id: string) {
    rowElements.current.get(id)?.focus();
  }

  function applyExpanded(nextIds: readonly string[]) {
    // Ordered by the tree itself and filtered to nodes that still exist, so the
    // list a host stores never drifts as the outline changes.
    const wanted = new Set(nextIds);
    const ordered = expandableIds.filter((id) => wanted.has(id));
    if (expandedIds === undefined) setOwnExpandedIds(ordered);
    onExpandedChange?.(ordered);
  }

  function setExpanded(id: string, expanded: boolean) {
    const next = new Set(currentExpandedIds);
    if (expanded) next.add(id);
    else next.delete(id);
    applyExpanded([...next]);
  }

  function updatePrefs(next: OutlinePrefs) {
    setPrefs(next);
    writeOutlinePrefs(prefKey, next);
  }

  function canInsertAt(target: OutlineInsertTarget): boolean {
    // With no gate of its own a tree offers insert points wherever it can act
    // on them — that is, as soon as the host handed it a way to add a node.
    if (canInsert === undefined) return onAdd !== undefined || onRequestInsert !== undefined;
    return canInsert(target);
  }

  function requestInsert(target: OutlineInsertTarget, originId: string | null = null) {
    if (!canInsertAt(target)) return;
    editOriginId.current = originId;
    const outcome = onRequestInsert?.(target);
    setEditing(onRequestInsert === undefined || outcome === "inline" ? target : null);
  }

  function closeEdit() {
    restoreFocusId.current = editOriginId.current;
    editOriginId.current = null;
    setEditing(null);
  }

  function commitAdd(target: OutlineInsertTarget, title: string) {
    onAdd?.({ ...target, title });
    closeEdit();
  }

  function handleRowKeyDown(event: KeyboardEvent, id: string) {
    const index = rows.findIndex((row) => row.node.id === id);
    if (index === -1) return;
    const row = rows[index];

    if (event.key === "ArrowRight") {
      if (row.expandable && !row.expanded) {
        event.preventDefault();
        setExpanded(id, true);
      } else if (row.expanded) {
        event.preventDefault();
        focusRow(rows[index + 1].node.id);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      if (row.expandable && row.expanded) {
        event.preventDefault();
        setExpanded(id, false);
      } else if (row.parentId !== null) {
        event.preventDefault();
        focusRow(row.parentId);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onSelect?.(id);
      onOpen?.(id);
      return;
    }
    if (INSERT_KEYS.has(event.key)) {
      const target = insertTargetAfter(row);
      if (!canInsertAt(target)) return;
      event.preventDefault();
      requestInsert(target, id);
      return;
    }
    if (!ROVING_KEYS.has(event.key)) return;
    const next = nextRovingIndex(event.key, index, rows.length, { orientation: "both" });
    if (next === null) return;
    event.preventDefault();
    focusRow(rows[next].node.id);
  }

  const visibleIds = useMemo(() => new Set(rows.map((row) => row.node.id)), [rows]);
  const tabStopId =
    focusedId !== null && visibleIds.has(focusedId)
      ? focusedId
      : selectedId !== undefined && visibleIds.has(selectedId)
        ? selectedId
        : (rows[0]?.node.id ?? null);

  const context: OutlineTreeContextValue = {
    selectedId,
    expandedIds: expandedSet,
    setExpanded,
    select: (id) => onSelect?.(id),
    open: (id) => onOpen?.(id),
    renderActions,
    canInsert: canInsertAt,
    requestInsert,
    commitAdd,
    editing,
    cancelEdit: closeEdit,
    addLabel,
    registerRow: (id, element) => {
      if (element === null) rowElements.current.delete(id);
      else rowElements.current.set(id, element);
    },
    handleRowKeyDown,
    tabStopId,
    noteFocus: (id) => setFocusedId((current) => (current === id ? current : id)),
  };

  return (
    <div
      class={cx(
        "cms-tree",
        prefs.slug && "cms-tree--show-slug",
        prefs.count && "cms-tree--show-count",
        className,
      )}
    >
      <OutlineTreeProvider value={context}>
        {showToolbar ? (
          <div class="cms-tree__toolbar">
            <Button variant="ghost" size="sm" onClick={() => applyExpanded([])}>
              <ToolbarLabel name="Collapse all">
                Collapse<span class="cms-tree__opt"> all</span>
              </ToolbarLabel>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => applyExpanded(expandableIds)}>
              <ToolbarLabel name="Open all">
                Open<span class="cms-tree__opt"> all</span>
              </ToolbarLabel>
            </Button>
            <span class="cms-tree__spacer" />
            <Switch
              checked={prefs.slug}
              onCheckedChange={(checked) => updatePrefs({ ...prefs, slug: checked })}
              label={
                <ToolbarLabel name="Show slug">
                  <span class="cms-tree__opt">Show </span>slug
                </ToolbarLabel>
              }
            />
            <Switch
              checked={prefs.count}
              onCheckedChange={(checked) => updatePrefs({ ...prefs, count: checked })}
              label={
                <ToolbarLabel name="Show count">
                  <span class="cms-tree__opt">Show </span>count
                </ToolbarLabel>
              }
            />
          </div>
        ) : null}

        {/*
          Only the rows carry `role="tree"`: the toolbar, the root add button and
          the legend are chrome around the tree, not items in it.
        */}
        <div class="cms-tree__nodes" role="tree" aria-label={label}>
          {nodes.map((node, index) => (
            <Fragment key={node.id}>
              {index === 0 ? null : (
                <OutlineInsertGap target={{ parentId: null, index }} depth={0} beforeTitle={node.title} root />
              )}
              <OutlineNodeRow
                node={node}
                placement={{
                  depth: 0,
                  index,
                  siblingCount: nodes.length,
                  parentId: null,
                  isLast: isLastInList(index, nodes.length, false),
                }}
              />
            </Fragment>
          ))}
        </div>

        <OutlineAddRoot target={{ parentId: null, index: nodes.length }} />
        {legend === undefined ? null : <div class="cms-tree__legend">{legend}</div>}
      </OutlineTreeProvider>
    </div>
  );
}
