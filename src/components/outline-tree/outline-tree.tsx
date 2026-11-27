import { computed, getScope, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { toSignal } from "../reactive";
import { Button, Switch, cx, isComposingKey, nextRovingIndex } from "../ui";
import type { OutlineTreeState } from "./outline-tree-state";
import { OutlineAddRoot } from "./outline-insert";
import { OutlineSiblings } from "./outline-rows";
import { readOutlinePrefs, writeOutlinePrefs } from "./prefs";
import type { OutlinePrefs } from "./prefs";
import {
  collectExpandableIds,
  collectNodeIds,
  flattenVisibleRows,
  insertTargetAfter,
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
function ToolbarLabel({ name, children }: { name: string; children: Child }) {
  return (
    <>
      <span aria-hidden="true">{children}</span>
      <span class="cms-tree-sr-only">{name}</span>
    </>
  );
}

interface PendingInsert {
  anchor: OutlineInsertAnchor;
  inline: boolean;
  invalidated: boolean;
}

/**
 * The zudo-doc outline: categories at the root, dashed connectors down to
 * groups and leaves, and a zero-height insert point between every pair of
 * siblings.
 *
 * Selection and expansion are controlled by the host. Expansion falls back to
 * internal state — everything open — when `expandedIds` is omitted, so a tree
 * is useful before its host has any state of its own.
 *
 * Rows are keyed by node id, so a row element — and the focus on it — survives
 * every change of the outline that keeps the node.
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
  const scope = getScope();

  const nodeList = toSignal(nodes);
  const selected = toSignal(selectedId);
  const controlledExpanded = expandedIds === undefined ? null : toSignal(expandedIds);
  const expandableIds = computed(() => collectExpandableIds(nodeList.value));
  const nodeIds = computed(() => collectNodeIds(nodeList.value));
  const ownExpandedIds = signal<readonly string[] | null>(null);
  const currentExpandedIds = computed(() => controlledExpanded?.value ?? ownExpandedIds.value ?? expandableIds.value);
  const expandedSet = computed<ReadonlySet<string>>(() => new Set(currentExpandedIds.value));
  const rows = computed(() => flattenVisibleRows(nodeList.value, expandedSet.value));
  const insertLists = computed(() => indexInsertLists(nodeList.value));

  const prefs = signal<OutlinePrefs>(readOutlinePrefs(prefKey));
  const pending = signal<PendingInsert | null>(null);
  let pendingRef: PendingInsert | null = null;
  const renamingId = signal<string | null>(null);
  const focusedId = signal<string | null>(null);

  const rowElements = new Map<string, HTMLElement>();
  /** The row an insert was requested from, so Escape puts focus back. */
  let editOriginId: string | null = null;
  let restoreFocusId: string | null = null;
  let originElement: HTMLElement | null = null;
  let originTerminal: string | null | undefined = undefined;
  const terminalElements = new Map<string | null, HTMLElement>();
  const rootElement: Ref<HTMLDivElement> = { current: null };
  let restoreOrigin = false;
  let addedFrom: { parentId: string | null; ids: Set<string> } | null = null;
  let awaitingRow: string | null = null;

  scope.onCleanup(() => { pendingRef = null; });

  // After every structural change (what used to be "after every render"):
  // land focus on the inserted row, the origin of a closed editor, or the tree.
  scope.effect(() => {
    const currentNodes = nodeList.value;
    void pending.value;
    void renamingId.value;
    void expandedSet.value;
    if (addedFrom) {
      const { parentId, ids } = addedFrom;
      const inserted = insertSiblings(currentNodes, parentId)?.filter((node) => !ids.has(node.id));
      if (inserted?.length === 1 && restoreOrigin) restoreFocusId = inserted[0]!.id;
      addedFrom = null;
    }
    const id = restoreFocusId;
    if (id !== null && rowElements.has(id)) {
      restoreFocusId = null;
      rowElements.get(id)?.focus();
    } else if (id !== null && rows.value.some((row) => row.node.id === id)) {
      // A row inside a nested list can mount after this pass; it takes the
      // focus itself as it registers.
      awaitingRow = id;
      restoreFocusId = null;
    } else if (restoreOrigin) {
      restoreFocusId = null;
      if (originElement?.isConnected) originElement.focus();
      else if (originTerminal !== undefined && terminalElements.has(originTerminal)) {
        terminalElements.get(originTerminal)?.focus();
      } else (rowElements.get(editOriginId ?? "") ?? rootElement.current)?.focus();
    }
    restoreOrigin = false;
  });

  function focusRow(id: string) {
    rowElements.get(id)?.focus();
  }

  function applyExpanded(nextIds: readonly string[]) {
    // Ordered by the tree itself and filtered to nodes that still exist, so the
    // list a host stores never drifts as the outline changes. The filter is
    // every node rather than every branch: a node with no children yet is not
    // expandable, and dropping it here would silently close it again the moment
    // it is given one.
    const wanted = new Set(nextIds);
    const ordered = nodeIds.value.filter((id) => wanted.has(id));
    if (expandedIds === undefined) ownExpandedIds.value = ordered;
    onExpandedChange?.(ordered);
  }

  function setExpanded(id: string, expanded: boolean) {
    const next = new Set(currentExpandedIds.value);
    if (expanded) next.add(id);
    else next.delete(id);
    applyExpanded([...next]);
  }

  function updatePrefs(next: OutlinePrefs) {
    prefs.value = next;
    writeOutlinePrefs(prefKey, next);
  }

  function canInsertAt(target: OutlineInsertTarget): boolean {
    // With no gate of its own a tree offers insert points wherever it can act
    // on them — that is, as soon as the host handed it a way to add a node.
    const siblings = insertLists.value.get(target.parentId);
    if (siblings === undefined || !Number.isInteger(target.index) || target.index < 0 || target.index > siblings.length) return false;
    if (canInsert === undefined) return onAdd !== undefined || onRequestInsert !== undefined;
    return canInsert(target);
  }

  function requestInsert(target: OutlineInsertTarget, originId: string | null = null) {
    if (!canInsertAt(target)) return;
    renamingId.value = null;
    editOriginId = originId;
    originElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    originTerminal = originId === null && target.index === insertLists.value.get(target.parentId)?.length
      ? target.parentId : undefined;
    const transaction: PendingInsert = {
      anchor: { parentId: target.parentId, beforeId: insertSiblings(nodeList.value, target.parentId)?.[target.index]?.id ?? null },
      inline: onRequestInsert === undefined,
      invalidated: false,
    };
    pendingRef = transaction;
    pending.value = transaction;
    const resolveTarget = () => {
      if (pendingRef !== transaction || transaction.invalidated) return null;
      const resolved = resolveInsertAnchor(nodeList.value, transaction.anchor);
      return resolved && canInsertAt(resolved) ? resolved : null;
    };
    const outcome = onRequestInsert?.(target, {
      resolveTarget,
      cancel: () => { if (pendingRef === transaction) closeEdit(); },
      complete: (insertedId) => {
        if (pendingRef !== transaction) return;
        if (transaction.anchor.parentId !== null) setExpanded(transaction.anchor.parentId, true);
        closeEdit(insertedId);
      },
    });
    if (outcome === "inline" && pendingRef === transaction) {
      transaction.inline = true;
      pending.value = { ...transaction };
    }
  }

  function closeEdit(insertedId?: string) {
    restoreFocusId = insertedId ?? editOriginId;
    restoreOrigin = insertedId === undefined;
    pendingRef = null;
    pending.value = null;
  }

  function commitAdd(target: OutlineInsertTarget, title: string) {
    if (!canInsertAt(target)) return;
    // An empty branch is not expandable, so nothing holds it open; without this
    // the child about to arrive would make it expandable-and-collapsed and the
    // node the user just added would never appear.
    if (target.parentId !== null && !expandedSet.value.has(target.parentId)) setExpanded(target.parentId, true);
    addedFrom = { parentId: target.parentId, ids: new Set(insertSiblings(nodeList.value, target.parentId)?.map((node) => node.id)) };
    const insertedId = onAdd?.({ ...target, title });
    closeEdit(insertedId || undefined);
  }

  const pendingTarget = computed(() => {
    const current = pending.value;
    return current === null ? null : resolveInsertAnchor(nodeList.value, current.anchor);
  });
  const validPendingTarget = computed(() => {
    const target = pendingTarget.value;
    return !pending.value?.invalidated && target && canInsertAt(target) ? target : null;
  });
  const editing = computed(() => (pending.value?.inline ? validPendingTarget.value : null));

  // A chooser may retain its draft and report an invalid target via resolveTarget().
  // Inline editors cannot outlive their row: restore a stable tree focus target.
  scope.effect(() => {
    const current = pending.value;
    const valid = validPendingTarget.value;
    const renaming = renamingId.value;
    const ids = nodeIds.value;
    if (current?.inline && valid === null) closeEdit();
    else if (current && valid === null) {
      current.invalidated = true;
      if (pendingRef) pendingRef.invalidated = true;
    }
    if (renaming !== null && !ids.includes(renaming)) cancelRename();
  });

  function cancelRename() {
    restoreFocusId = renamingId.value;
    restoreOrigin = true;
    renamingId.value = null;
  }

  function handleRowKeyDown(event: KeyboardEvent, id: string) {
    const visible = rows.value;
    const index = visible.findIndex((row) => row.node.id === id);
    if (index === -1) return;
    const row = visible[index]!;
    // A shortcut of the host or the browser — Cmd+A, Ctrl+Home — is not a tree
    // key. `a` in particular would otherwise open an insert editor on Select all.
    if (event.altKey || event.ctrlKey || event.metaKey || isComposingKey(event)) return;
    if (event.key === "F2" && onRename && (canRename?.(row.node) ?? true)) {
      event.preventDefault();
      event.stopPropagation();
      originElement = rowElements.get(id) ?? null;
      originTerminal = undefined;
      pendingRef = null;
      pending.value = null;
      renamingId.value = id;
      return;
    }

    if (event.key === "ArrowRight") {
      if (row.expandable && !row.expanded) {
        event.preventDefault();
        setExpanded(id, true);
      } else if (row.expanded) {
        event.preventDefault();
        focusRow(visible[index + 1]!.node.id);
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
    const next = nextRovingIndex(event.key, index, visible.length, { orientation: "both" });
    if (next === null) return;
    event.preventDefault();
    focusRow(visible[next]!.node.id);
  }

  const tabStopId = computed(() => {
    const visibleIds = new Set(rows.value.map((row) => row.node.id));
    const focused = focusedId.value;
    const chosen = selected.value;
    if (focused !== null && visibleIds.has(focused)) return focused;
    if (chosen !== undefined && visibleIds.has(chosen)) return chosen;
    return rows.value[0]?.node.id ?? null;
  });

  const tree: OutlineTreeState = {
    selectedId: selected,
    expandedIds: expandedSet,
    setExpanded,
    select: (id) => onSelect?.(id),
    open: (id) => onOpen?.(id),
    ...(renderActions ? { renderActions } : {}),
    canInsert: canInsertAt,
    requestInsert,
    commitAdd,
    editing,
    pending: validPendingTarget,
    renamingId,
    commitRename: (id, title) => {
      const node = rows.value.find((row) => row.node.id === id)?.node;
      if (node && (canRename?.(node) ?? true)) onRename?.(id, title);
      cancelRename();
    },
    cancelRename,
    cancelEdit: () => closeEdit(),
    addLabel,
    registerRow: (id, element) => {
      rowElements.set(id, element);
      if (awaitingRow === id) {
        awaitingRow = null;
        element.focus();
      }
      return () => {
        if (rowElements.get(id) === element) rowElements.delete(id);
      };
    },
    registerTerminal: (parentId, element) => {
      terminalElements.set(parentId, element);
      return () => {
        if (terminalElements.get(parentId) === element) terminalElements.delete(parentId);
      };
    },
    handleRowKeyDown,
    tabStopId,
    noteFocus: (id) => {
      if (focusedId.value !== id) focusedId.value = id;
    },
  };

  const noAddRow = computed(() => false);
  const rootAddTarget = computed<OutlineInsertTarget>(() => ({ parentId: null, index: nodeList.value.length }));

  return (
    <div
      ref={rootElement}
      tabindex={-1}
      class={computed(() => cx(
        "cms-tree",
        prefs.value.slug && "cms-tree--show-slug",
        prefs.value.count && "cms-tree--show-count",
        className,
      ))}
    >
      {showToolbar ? (
        <div class="cms-tree__toolbar">
          <Button variant="ghost" size="sm" on:click={() => applyExpanded([])}>
            <ToolbarLabel name="Collapse all">
              Collapse<span class="cms-tree__opt"> all</span>
            </ToolbarLabel>
          </Button>
          <Button variant="ghost" size="sm" on:click={() => applyExpanded(expandableIds.value)}>
            <ToolbarLabel name="Open all">
              Open<span class="cms-tree__opt"> all</span>
            </ToolbarLabel>
          </Button>
          <span class="cms-tree__spacer" />
          <Switch
            checked={computed(() => prefs.value.slug)}
            onCheckedChange={(checked) => updatePrefs({ ...prefs.value, slug: checked })}
            label={
              <ToolbarLabel name="Show slug">
                <span class="cms-tree__opt">Show </span>slug
              </ToolbarLabel>
            }
          />
          <Switch
            checked={computed(() => prefs.value.count)}
            onCheckedChange={(checked) => updatePrefs({ ...prefs.value, count: checked })}
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
        <OutlineSiblings tree={tree} list={nodeList} parentId={null} depth={0} hasAddRow={noAddRow} root />
      </div>

      <OutlineAddRoot tree={tree} target={rootAddTarget} />
      {legend === undefined ? null : <div class="cms-tree__legend">{legend}</div>}
    </div>
  );
}
