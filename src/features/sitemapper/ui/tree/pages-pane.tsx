import { computed, type Child } from "@takazudo/zfb/zudo-react";
import { RailCollapseButton, type EditorChromeController, type EditorRailsController } from "../../../../components/editor-chrome";
import { OutlineTree, type OutlineAddRequest, type OutlineInsertTarget } from "../../../../components/outline-tree";
import { toSignal, type MaybeSignal } from "../../../../components/reactive";
import { derive } from "../../../mapping/signals";
import { Pane, PaneBody, PaneHeader } from "../../../../components/ui";
import { indexDocument, type SitemapDocument } from "../../../../sitemapper/model";
import type { SitemapOutline } from "./outline-model";
import { PageRowActions } from "./page-row-actions";

export interface PagesPaneProps {
  document: MaybeSignal<SitemapDocument>;
  /** The document as outline rows; the editor builds it once for every surface. */
  outline: MaybeSignal<SitemapOutline>;
  selectedId: MaybeSignal<string | null>;
  expandedIds: MaybeSignal<ReadonlySet<string>>;
  onSelect: (pageId: string) => void;
  onExpandedChange: (ids: readonly string[]) => void;
  onAdd: (request: OutlineAddRequest) => void;
  onAddChild: (pageId: string) => void;
  onRename: (pageId: string, title?: string) => void;
  onMove: (pageId: string, direction: "up" | "down") => void;
  onDuplicate: (pageId: string) => void;
  onDelete: (pageId: string) => void;
  /** The editor's chrome controller; Enter on a row brings the inspector forward through it. */
  chrome?: EditorChromeController;
  /** The editor body's rails controller, for the collapse control. */
  rails?: EditorRailsController;
  /** Main Outline mode reuses the canonical tree without collapsing the nav rail. */
  showCollapseButton?: boolean;
  heading?: string;
  class?: string;
}

function Legend(): Child {
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
  document: documentInput,
  outline: outlineInput,
  selectedId: selectedInput,
  expandedIds: expandedInput,
  onSelect,
  onExpandedChange,
  onAdd,
  onAddChild,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
  chrome,
  rails,
  showCollapseButton = true,
  heading = "Pages",
  class: className,
}: PagesPaneProps): Child {
  const document = toSignal(documentInput);
  const outline = toSignal(outlineInput);
  const selectedId = toSignal(selectedInput);
  const expandedIds = toSignal(expandedInput);
  const index = derive(() => [document.value] as const, indexDocument);
  const expanded = derive(() => [expandedIds.value] as const, (ids) => [...ids]);

  // The schema keeps exactly one root page, so the root list offers an insert
  // only while it is empty — that insert IS the "create the Home page" action.
  // All existing parents may contain authored children, including nested
  // Mapping route families. Commands remain authoritative for stale targets.
  function canInsert(target: OutlineInsertTarget): boolean {
    if (target.parentId === null) return document.value.root.length === 0;
    const parent = index.value.byId.get(target.parentId)?.node;
    return parent !== undefined;
  }

  return (
    <Pane label={heading} class={className}>
      <PaneHeader title={heading} count={computed(() => index.value.byId.size)} actions={showCollapseButton && rails ? <RailCollapseButton rail="nav" rails={rails} /> : undefined} />
      <PaneBody>
        <OutlineTree
          label="Pages"
          nodes={computed(() => outline.value.nodes)}
          prefKey="sitemapper"
          selectedId={computed(() => selectedId.value ?? undefined)}
          onSelect={onSelect}
          onOpen={() => chrome?.setActivePane("insp")}
          expandedIds={expanded}
          onExpandedChange={onExpandedChange}
          canInsert={canInsert}
          onAdd={onAdd}
          onRename={onRename}
          addLabel={(parent) => (parent === null ? "Add root page" : "Add page")}
          legend={<Legend />}
          renderActions={(node) => {
            const currentIndex = index.value;
            const location = currentIndex.byId.get(node.id);
            if (!location) return null;
            const siblings = location.parentId === null
              ? document.value.root
              : currentIndex.byId.get(location.parentId)?.node.children ?? [];
            return (
              <PageRowActions
                pageId={node.id}
                title={node.title}
                isRoot={node.id === (document.value.root[0]?.id ?? null)}
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
