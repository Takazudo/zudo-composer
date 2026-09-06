/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { RailCollapseButton, useEditorChrome } from "../../../../components/editor-chrome";
import { OutlineTree, type OutlineAddRequest, type OutlineInsertTarget } from "../../../../components/outline-tree";
import { Pane, PaneBody, PaneHeader } from "../../../../components/ui";
import { indexDocument, type SitemapDocument } from "../../../../sitemapper/model";
import type { SitemapOutline } from "./outline-model";
import { PageRowActions } from "./page-row-actions";

export interface PagesPaneProps {
  document: SitemapDocument;
  /** The document as outline rows; the editor builds it once for every surface. */
  outline: SitemapOutline;
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  onSelect: (pageId: string) => void;
  onExpandedChange: (ids: readonly string[]) => void;
  onAdd: (request: OutlineAddRequest) => void;
  onAddChild: (pageId: string) => void;
  onRename: (pageId: string, title?: string) => void;
  onMove: (pageId: string, direction: "up" | "down") => void;
  onDuplicate: (pageId: string) => void;
  onDelete: (pageId: string) => void;
  /** Main Outline mode reuses the canonical tree without collapsing the nav rail. */
  showCollapseButton?: boolean;
  heading?: string;
  class?: string;
}

function Legend(): JSX.Element {
  return (
    <>
      <span><span class="cms-tree-dot cms-tree-dot--ok" />Composition</span>
      <span><span class="cms-tree-dot cms-tree-dot--accent" />Mapping route family</span>
      <span><span class="cms-tree-dot cms-tree-dot--warn" />Unassigned</span>
      <span class="cms-tree__hint">Click = select · ↵ = open in inspector</span>
    </>
  );
}

export function PagesPane({
  document,
  outline,
  selectedId,
  expandedIds,
  onSelect,
  onExpandedChange,
  onAdd,
  onAddChild,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
  showCollapseButton = true,
  heading = "Pages",
  class: className,
}: PagesPaneProps): JSX.Element {
  const { setActivePane } = useEditorChrome();
  const index = useMemo(() => indexDocument(document), [document]);
  const expanded = useMemo(() => [...expandedIds], [expandedIds]);
  const rootId = document.root[0]?.id ?? null;

  // The schema keeps exactly one root page, so the root list offers an insert
  // only while it is empty — that insert IS the "create the Home page" action.
  // All existing parents may contain authored children, including nested
  // Mapping route families. Commands remain authoritative for stale targets.
  function canInsert(target: OutlineInsertTarget): boolean {
    if (target.parentId === null) return document.root.length === 0;
    const parent = index.byId.get(target.parentId)?.node;
    return parent !== undefined;
  }

  return (
    <Pane label={heading} class={className}>
      <PaneHeader title={heading} count={index.byId.size} actions={showCollapseButton ? <RailCollapseButton rail="nav" /> : undefined} />
      <PaneBody>
        <OutlineTree
          label="Pages"
          nodes={outline.nodes}
          prefKey="sitemapper"
          selectedId={selectedId ?? undefined}
          onSelect={onSelect}
          onOpen={() => setActivePane("insp")}
          expandedIds={expanded}
          onExpandedChange={onExpandedChange}
          canInsert={canInsert}
          onAdd={onAdd}
          onRename={onRename}
          addLabel={(parent) => (parent === null ? "Add root page" : "Add page")}
          legend={<Legend />}
          renderActions={(node) => {
            const location = index.byId.get(node.id);
            if (!location) return null;
            const siblings = location.parentId === null
              ? document.root
              : index.byId.get(location.parentId)?.node.children ?? [];
            return (
              <PageRowActions
                pageId={node.id}
                title={node.title}
                isRoot={node.id === rootId}
                canMoveUp={location.parentId !== null && location.index > 0}
                canMoveDown={location.parentId !== null && location.index < siblings.length - 1}
                canAddChild={true}
                onAddChild={onAddChild}
                onRename={onRename}
                onMove={onMove}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            );
          }}
        />
      </PaneBody>
    </Pane>
  );
}
