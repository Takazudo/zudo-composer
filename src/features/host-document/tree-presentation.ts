import type { HostDocumentTarget } from "../../../server/host-document/types";
/** A separate view index: canonical parents, owners, slots and placements never change. */
export function projectHostTree(targets: readonly HostDocumentTarget[], showWrappers: boolean, selectedId?: string) {
  const canonical = new Map(targets.map(target => [target.renderedNodeId, target]));
  const parentsWithChildren = new Set(targets.map(target => target.parentRenderedNodeId));
  const visible = new Map(targets.filter(target => showWrappers || target.renderedNodeId === selectedId || !target.presentation?.transparent || !parentsWithChildren.has(target.renderedNodeId)).map(target => [target.renderedNodeId, target]));
  const parentOf = new Map<string, string | null>();
  const children = new Map<string | null, HostDocumentTarget[]>();
  for (const target of visible.values()) {
    let parent = target.parentRenderedNodeId;
    const seen = new Set<string>([target.renderedNodeId]);
    while (parent && !visible.has(parent)) {
      if (seen.has(parent)) throw new Error("Cyclic host component hierarchy.");
      seen.add(parent); parent = canonical.get(parent)?.parentRenderedNodeId ?? null;
    }
    parentOf.set(target.renderedNodeId, parent);
    children.set(parent, [...(children.get(parent) ?? []), target]);
  }
  return { byId: visible, parentOf, children, roots: children.get(null) ?? [] };
}
