import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { HostDocumentTarget } from "../../../server/host-document/types";

export function componentTitle(target: HostDocumentTarget, titles: ReadonlyMap<string, string>): string {
  return titles.get(target.componentId) ?? target.componentId.replace(/[-_.]/g, " ");
}

/** Arrangement follows rendered parents; selection always retains the exact owning target. */
export function HostComponentTree({ targets, titles, selectedId, disabled, onSelect }: {
  targets: readonly HostDocumentTarget[]; titles: ReadonlyMap<string, string>; selectedId?: string;
  disabled: boolean; onSelect(target: HostDocumentTarget): void;
}) {
  const hierarchy = useMemo(() => {
    const byId = new Map(targets.map(target => [target.renderedNodeId, target]));
    const children = new Map<string | null, HostDocumentTarget[]>();
    for (const target of targets) {
      const parent = target.parentRenderedNodeId && byId.has(target.parentRenderedNodeId) ? target.parentRenderedNodeId : null;
      children.set(parent, [...(children.get(parent) ?? []), target]);
    }
    return { byId, children, roots: children.get(null) ?? [] };
  }, [targets]);
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
    let parent = hierarchy.byId.get(selectedId)?.parentRenderedNodeId;
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = hierarchy.byId.get(parent)?.parentRenderedNodeId; }
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
        if (event.key === "ArrowLeft") { if (children.length && open) toggle(id, false); else focus(target.parentRenderedNodeId ?? undefined); }
        if (!disabled && (event.key === "Enter" || event.key === " ")) onSelect(target);
      }}>
      <div class="cms-host-tree-row" onClick={() => { focus(id); if (!disabled) onSelect(target); }}>
        {children.length ? <button type="button" tabIndex={-1} aria-label={`${open ? "Collapse" : "Expand"} ${title}`} onClick={event => { event.stopPropagation(); focus(id); toggle(id, !open); }}>{open ? "▾" : "▸"}</button> : <span class="cms-host-tree-leaf" aria-hidden="true" />}
        <span><span>{title}</span>{target.slotId && <small>Slot: {target.slotId}</small>}{target.entries.length > 0 && <small>Shared Content</small>}</span>
      </div>
      {children.length > 0 && open && <ul role="group">{rows(children, level + 1)}</ul>}
    </li>;
  });
  return <ul class="cms-host-tree" role="tree" aria-label="Page components">{rows(hierarchy.roots, 1)}</ul>;
}
