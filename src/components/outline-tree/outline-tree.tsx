import { Fragment } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Button, Switch, cx, isComposingKey, nextRovingIndex } from "../ui";
import { OutlineTreeProvider } from "./outline-context";
import type { OutlineTreeContextValue } from "./outline-context";
import { OutlineAddRoot, OutlineInsertGap } from "./outline-insert";
import { OutlineNodeRow } from "./outline-rows";
import { readOutlinePrefs, writeOutlinePrefs } from "./prefs";
import type { OutlinePrefs } from "./prefs";
import {
  collectExpandableIds,
  collectNodeIds,
  flattenVisibleRows,
  insertTargetAfter,
  isLastInList,
  insertSiblings,
  indexInsertLists,
  resolveInsertAnchor,
} from "./tree-model";
import type { OutlineInsertAnchor } from "./tree-model";
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
    onRename,
    canRename,
    addLabel = defaultAddLabel,
    showToolbar = true,
    prefKey,
    legend,
    class: className,
  } = props;

  const expandableIds = useMemo(() => collectExpandableIds(nodes), [nodes]);
  const nodeIds = useMemo(() => collectNodeIds(nodes), [nodes]);
  const [ownExpandedIds, setOwnExpandedIds] = useState<readonly string[] | null>(null);
  const currentExpandedIds = expandedIds ?? ownExpandedIds ?? expandableIds;
  const expandedSet = useMemo(() => new Set(currentExpandedIds), [currentExpandedIds]);
  const rows = useMemo(() => flattenVisibleRows(nodes, expandedSet), [nodes, expandedSet]);
  const insertLists = useMemo(() => indexInsertLists(nodes), [nodes]);

  const [prefs, setPrefs] = useState<OutlinePrefs>(() => readOutlinePrefs(prefKey));
  const [pending, setPending] = useState<{ anchor: OutlineInsertAnchor; inline: boolean; invalidated: boolean } | null>(null);
  const pendingRef = useRef(pending);
  const latest = useRef({ nodes, insertLists, canInsert, onAdd, onRequestInsert });
  latest.current = { nodes, insertLists, canInsert, onAdd, onRequestInsert };
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const rowElements = useRef(new Map<string, HTMLElement>());
  /** The row an insert was requested from, so Escape puts focus back. */
  const editOriginId = useRef<string | null>(null);
  const restoreFocusId = useRef<string | null>(null);
  const originElement = useRef<HTMLElement | null>(null);
  const originTerminal = useRef<string | null | undefined>(undefined);
  const terminalElements = useRef(new Map<string | null, HTMLElement>());
  const rootElement = useRef<HTMLDivElement>(null);
  const expandParent = useRef<(id: string) => void>(() => {});
  expandParent.current = (id) => setExpanded(id, true);
  const restoreOrigin = useRef(false);
  const addedFrom = useRef<{ parentId: string | null; ids: Set<string> } | null>(null);

  useEffect(() => () => { pendingRef.current = null; }, []);

  useEffect(() => {
    setPrefs(readOutlinePrefs(prefKey));
  }, [prefKey]);

  useEffect(() => {
    if (addedFrom.current) {
      const { parentId, ids } = addedFrom.current;
      const inserted = insertSiblings(nodes, parentId)?.filter((node) => !ids.has(node.id));
      if (inserted?.length === 1 && restoreOrigin.current) restoreFocusId.current = inserted[0].id;
      addedFrom.current = null;
    }
    const id = restoreFocusId.current;
    if (id !== null && rowElements.current.has(id)) {
      restoreFocusId.current = null;
      rowElements.current.get(id)?.focus();
    } else if (restoreOrigin.current) {
      restoreFocusId.current = null;
      if (originElement.current?.isConnected) originElement.current.focus();
      else if (originTerminal.current !== undefined && terminalElements.current.has(originTerminal.current)) {
        terminalElements.current.get(originTerminal.current)?.focus();
      } else (rowElements.current.get(editOriginId.current ?? "") ?? rootElement.current)?.focus();
    }
    restoreOrigin.current = false;
  });

  function focusRow(id: string) {
    rowElements.current.get(id)?.focus();
  }

  function applyExpanded(nextIds: readonly string[]) {
    // Ordered by the tree itself and filtered to nodes that still exist, so the
    // list a host stores never drifts as the outline changes. The filter is
    // every node rather than every branch: a node with no children yet is not
    // expandable, and dropping it here would silently close it again the moment
    // it is given one.
    const wanted = new Set(nextIds);
    const ordered = nodeIds.filter((id) => wanted.has(id));
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
    const state = latest.current;
    const siblings = state.insertLists.get(target.parentId);
    if (siblings === undefined || !Number.isInteger(target.index) || target.index < 0 || target.index > siblings.length) return false;
    if (state.canInsert === undefined) return state.onAdd !== undefined || state.onRequestInsert !== undefined;
    return state.canInsert(target);
  }

  function requestInsert(target: OutlineInsertTarget, originId: string | null = null) {
    if (!canInsertAt(target)) return;
    setRenamingId(null);
    editOriginId.current = originId;
    originElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    originTerminal.current = originId === null && target.index === insertLists.get(target.parentId)?.length
      ? target.parentId : undefined;
    const transaction = {
      anchor: { parentId: target.parentId, beforeId: insertSiblings(nodes, target.parentId)?.[target.index]?.id ?? null },
      inline: onRequestInsert === undefined,
      invalidated: false,
    };
    pendingRef.current = transaction;
    setPending(transaction);
    const resolveTarget = () => {
      if (pendingRef.current !== transaction || transaction.invalidated) return null;
      const resolved = resolveInsertAnchor(latest.current.nodes, transaction.anchor);
      return resolved && canInsertAt(resolved) ? resolved : null;
    };
    const outcome = onRequestInsert?.(target, {
      resolveTarget,
      cancel: () => { if (pendingRef.current === transaction) closeEdit(); },
      complete: (insertedId) => {
        if (pendingRef.current !== transaction) return;
        if (transaction.anchor.parentId !== null) expandParent.current(transaction.anchor.parentId);
        closeEdit(insertedId);
      },
    });
    if (outcome === "inline" && pendingRef.current === transaction) {
      transaction.inline = true;
      setPending({ ...transaction });
    }
  }

  function closeEdit(insertedId?: string) {
    restoreFocusId.current = insertedId ?? editOriginId.current;
    restoreOrigin.current = insertedId === undefined;
    pendingRef.current = null;
    setPending(null);
  }

  function commitAdd(target: OutlineInsertTarget, title: string) {
    if (!canInsertAt(target)) return;
    // An empty branch is not expandable, so nothing holds it open; without this
    // the child about to arrive would make it expandable-and-collapsed and the
    // node the user just added would never appear.
    if (target.parentId !== null && !expandedSet.has(target.parentId)) setExpanded(target.parentId, true);
    addedFrom.current = { parentId: target.parentId, ids: new Set(insertSiblings(nodes, target.parentId)?.map((node) => node.id)) };
    const insertedId = onAdd?.({ ...target, title });
    closeEdit(insertedId || undefined);
  }

  const pendingTarget = pending === null ? null : resolveInsertAnchor(nodes, pending.anchor);
  const validPendingTarget = !pending?.invalidated && pendingTarget && canInsertAt(pendingTarget) ? pendingTarget : null;
  const editing = pending?.inline ? validPendingTarget : null;

  // A chooser may retain its draft and report an invalid target via resolveTarget().
  // Inline editors cannot outlive their row: restore a stable tree focus target.
  useEffect(() => {
    if (pending?.inline && validPendingTarget === null) closeEdit();
    else if (pending && validPendingTarget === null) {
      pending.invalidated = true;
      if (pendingRef.current) pendingRef.current.invalidated = true;
    }
    if (renamingId !== null && !nodeIds.includes(renamingId)) cancelRename();
  });

  function cancelRename() {
    restoreFocusId.current = renamingId;
    restoreOrigin.current = true;
    setRenamingId(null);
  }

  function handleRowKeyDown(event: KeyboardEvent, id: string) {
    const index = rows.findIndex((row) => row.node.id === id);
    if (index === -1) return;
    const row = rows[index];
    // A shortcut of the host or the browser — Cmd+A, Ctrl+Home — is not a tree
    // key. `a` in particular would otherwise open an insert editor on Select all.
    if (event.altKey || event.ctrlKey || event.metaKey || isComposingKey(event)) return;
    if (event.key === "F2" && onRename && (canRename?.(row.node) ?? true)) {
      event.preventDefault();
      event.stopPropagation();
      originElement.current = rowElements.current.get(id) ?? null;
      originTerminal.current = undefined;
      pendingRef.current = null;
      setPending(null);
      setRenamingId(id);
      return;
    }

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
    pending: validPendingTarget,
    renamingId,
    commitRename: (id, title) => {
      const node = rows.find((row) => row.node.id === id)?.node;
      if (node && (canRename?.(node) ?? true)) onRename?.(id, title);
      cancelRename();
    },
    cancelRename,
    cancelEdit: closeEdit,
    addLabel,
    registerRow: (id, element) => {
      if (element === null) rowElements.current.delete(id);
      else rowElements.current.set(id, element);
    },
    registerTerminal: (parentId, element) => {
      if (element === null) terminalElements.current.delete(parentId);
      else terminalElements.current.set(parentId, element);
    },
    handleRowKeyDown,
    tabStopId,
    noteFocus: (id) => setFocusedId((current) => (current === id ? current : id)),
  };

  return (
    <div
      ref={rootElement}
      tabIndex={-1}
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
              <OutlineInsertGap target={{ parentId: null, index }} depth={0} beforeTitle={node.title} root />
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
