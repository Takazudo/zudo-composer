import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { projectHostTree } from "./tree-presentation";
import type { HostDocumentTarget } from "../../../server/host-document/types";

export function componentTitle(target: HostDocumentTarget, titles: ReadonlyMap<string, string>): string {
  return target.presentation?.label ?? titles.get(target.componentId) ?? target.componentId.replace(/[-_.]/g, " ");
}

/** Arrangement follows rendered parents; selection always retains the exact owning target. */
export function HostComponentTree({ targets, titles, selectedId, disabled, onSelect }: {
  targets: readonly HostDocumentTarget[]; titles: ReadonlyMap<string, string>; selectedId?: string;
  disabled: boolean; onSelect(target: HostDocumentTarget): void;
}) {
  const [showWrappers, setShowWrappers] = useState(false);
  const revealedWrapper = targets.find(target => target.renderedNodeId === selectedId)?.presentation?.transparent ? selectedId : undefined;
  const hierarchy = useMemo(() => projectHostTree(targets, showWrappers, revealedWrapper), [targets, showWrappers, revealedWrapper]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => {
    setExpanded(new Set(hierarchy.roots.map(target => target.renderedNodeId)));
    setFocusedId(hierarchy.roots[0]?.renderedNodeId ?? null);
  }, [hierarchy]);
  useEffect(() => {
    if (!selectedId || !hierarchy.byId.has(selectedId)) return;
    const ancestors = new Set<string>();
    let parent = hierarchy.parentOf.get(selectedId);
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = hierarchy.parentOf.get(parent); }
    setExpanded(previous => new Set([...previous, ...ancestors]));
    setFocusedId(selectedId);
  }, [selectedId, hierarchy]);
  useEffect(() => { if (selectedId) elements.current.get(selectedId)?.scrollIntoView?.({ block: "nearest" }); }, [selectedId, expanded]);
  const visible: HostDocumentTarget[] = [];
  const collect = (nodes: readonly HostDocumentTarget[]) => { for (const node of nodes) { visible.push(node); if (expanded.has(node.renderedNodeId)) collect(hierarchy.children.get(node.renderedNodeId) ?? []); } };
  collect(hierarchy.roots);
  const focus = (id: string | undefined) => { if (id) { setFocusedId(id); elements.current.get(id)?.focus(); } };
  const toggle = (id: string, open: boolean) => setExpanded(previous => { const next = new Set(previous); if (open) next.add(id); else next.delete(id); return next; });
  const rows = (nodes: readonly HostDocumentTarget[], level: number) => nodes.map((target, index) => {
    const id = target.renderedNodeId, children = hierarchy.children.get(id) ?? [], open = expanded.has(id), title = componentTitle(target, titles);
    return <li key={id} ref={element => { if (element) elements.current.set(id, element); else elements.current.delete(id); }} role="treeitem" aria-label={title} aria-level={level} aria-posinset={index + 1} aria-setsize={nodes.length} aria-selected={id === selectedId} aria-expanded={children.length ? open : undefined} aria-disabled={disabled} tabIndex={focusedId === id ? 0 : -1}
      onFocus={event => { if (event.target === event.currentTarget) setFocusedId(id); }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const position = visible.findIndex(node => node.renderedNodeId === id);
        if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(event.key)) event.preventDefault();
        if (event.key === "ArrowDown") focus(visible[position + 1]?.renderedNodeId);
        if (event.key === "ArrowUp") focus(visible[position - 1]?.renderedNodeId);
        if (event.key === "Home") focus(visible[0]?.renderedNodeId);
        if (event.key === "End") focus(visible.at(-1)?.renderedNodeId);
        if (event.key === "ArrowRight" && children.length) { if (!open) toggle(id, true); else focus(children[0]?.renderedNodeId); }
        if (event.key === "ArrowLeft") { if (children.length && open) toggle(id, false); else focus(hierarchy.parentOf.get(id) ?? undefined); }
        if (!disabled && (event.key === "Enter" || event.key === " ")) onSelect(target);
      }}>
      <div class="cms-host-tree-row" onClick={() => { focus(id); if (!disabled) onSelect(target); }}>
        {children.length ? <button type="button" tabIndex={-1} aria-label={`${open ? "Collapse" : "Expand"} ${title}`} onClick={event => { event.stopPropagation(); focus(id); toggle(id, !open); }}>{open ? "▾" : "▸"}</button> : <span class="cms-host-tree-leaf" aria-hidden="true" />}
        <span><span>{title}</span>{target.presentation && target.presentation.kindTitle !== title && <small>{target.presentation.kindTitle}</small>}{target.slotId && <small>Slot: {target.slotId}</small>}{target.entries.length > 0 && <small>Shared Content</small>}</span>
      </div>
      {children.length > 0 && open && <ul role="group">{rows(children, level + 1)}</ul>}
    </li>;
  });
  return <><label class="cms-host-tree-options"><input type="checkbox" checked={showWrappers} onChange={event => setShowWrappers(event.currentTarget.checked)} /> Show structural wrappers</label><ul class="cms-host-tree" role="tree" aria-label="Page components">{rows(hierarchy.roots, 1)}</ul></>;
}
