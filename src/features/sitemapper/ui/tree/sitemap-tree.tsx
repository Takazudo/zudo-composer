/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Controlled Sitemapper outline rail (issue #410).
//
// The caller owns document, selection, and expansion state. This component
// only derives rows from the persisted document, sends all mutations upward,
// and keeps ephemeral DOM refs so a selected page reached through keyboard or
// canvas navigation is revealed when its row is rendered.

import { useEffect, useMemo, useRef } from "preact/hooks";
import type { JSX } from "preact";
import type { SitemapDocument } from "../../../../sitemapper/model";
import { buildDocumentIndex } from "./tree-helpers";
import { TreeNode } from "./tree-node";

export interface SitemapTreeProps {
  document: SitemapDocument;
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  onSelect: (nodeId: string) => void;
  onToggleExpanded: (nodeId: string) => void;
  onAddChild: (nodeId: string) => void;
  onAddSibling: (nodeId: string) => void;
  onRename: (nodeId: string, title: string) => void;
  onDuplicate: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onReorder: (nodeId: string, direction: "up" | "down") => void;
  class?: string;
}

export function SitemapTree({
  document,
  selectedId,
  expandedIds,
  onSelect,
  onToggleExpanded,
  onAddChild,
  onAddSibling,
  onRename,
  onDuplicate,
  onDelete,
  onReorder,
  class: className,
}: SitemapTreeProps): JSX.Element {
  const index = useMemo(() => buildDocumentIndex(document), [document]);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const registerRowRef = (nodeId: string, element: HTMLButtonElement | null): void => {
    if (element) rowRefs.current.set(nodeId, element);
    else rowRefs.current.delete(nodeId);
  };

  useEffect(() => {
    if (selectedId === null) return;
    rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId, expandedIds]);

  const classes = `sg-sitemapper-tree${className ? ` ${className}` : ""}`;

  return (
    <section class={classes} aria-label="Sitemap outline">
      {document.root.length === 0 ? (
        <p class="sg-sitemapper-tree-empty">No root page yet.</p>
      ) : (
        <ul class="sg-sitemapper-tree-list">
          {document.root.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              document={document}
              index={index}
              selectedId={selectedId}
              expandedIds={expandedIds}
              depth={0}
              isRoot
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
    </section>
  );
}

export default SitemapTree;

// Re-export the row pieces so a future assembly can compose a single row
// affordance without reaching into implementation-only paths.
export { DeleteConfirm, TreeRowActions } from "./tree-row-actions";
export type { DeleteConfirmProps, TreeRowActionsProps } from "./tree-row-actions";
