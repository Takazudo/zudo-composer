/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX, Ref } from "preact";
import type { SitemapNode as SitemapNodeModel } from "../../../../sitemapper/model";
import type { NodeRectangle } from "./layout";

export interface SitemapNodeProps {
  node: SitemapNodeModel;
  rectangle: NodeRectangle;
  selected: boolean;
  menuOpen: boolean;
  nodeRef: Ref<HTMLDivElement>;
  onSelect: (id: string) => void;
  onToggleMenu: (id: string) => void;
  onAddChild: (id: string) => void;
  onAddSibling: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SitemapNode({
  node,
  rectangle,
  selected,
  menuOpen,
  nodeRef,
  onSelect,
  onToggleMenu,
  onAddChild,
  onAddSibling,
  onDuplicate,
  onDelete,
}: SitemapNodeProps): JSX.Element {
  const isRoot = rectangle.depth === 0;
  const externalTreatment = rectangle.external || rectangle.externalCluster;
  const style = {
    "--sg-sitemapper-node-left": `${rectangle.left}px`,
    "--sg-sitemapper-node-top": `${rectangle.top}px`,
    "--sg-sitemapper-node-width": `${rectangle.width}px`,
  } as JSX.CSSProperties;

  const invoke = (callback: (id: string) => void): void => {
    callback(node.id);
    onToggleMenu(node.id);
  };

  return (
    <div
      ref={nodeRef}
      class="sg-sitemapper-node-wrap"
      data-sg-node-id={node.id}
      style={style}
    >
      <button
        type="button"
        class="sg-sitemapper-node"
        data-sg-depth={rectangle.depth}
        data-sg-selected={selected ? "true" : undefined}
        data-sg-external={externalTreatment ? "true" : undefined}
        aria-pressed={selected}
        onClick={() => onSelect(node.id)}
      >
        {selected && <span class="sg-sitemapper-node__selected"><span class="sg-sitemapper-sr-only">Selected</span>✓</span>}
        <span class="sg-sitemapper-node__title">{node.title}</span>
        {rectangle.depth > 4 && <span class="sg-sitemapper-node__meta">Depth {rectangle.depth}</span>}
        {node.slug && <span class="sg-sitemapper-node__meta">{node.slug}</span>}
      </button>
      <button
        type="button"
        class="sg-sitemapper-node__menu-trigger"
        data-sg-depth={rectangle.depth}
        data-sg-external={externalTreatment ? "true" : undefined}
        aria-label={`Actions for ${node.title}`}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.id);
          onToggleMenu(node.id);
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {menuOpen && (
        <div class="sg-sitemapper-node__menu" role="menu" aria-label={`Actions for ${node.title}`}>
          <button type="button" role="menuitem" onClick={() => invoke(onAddChild)}>Add child</button>
          <button type="button" role="menuitem" disabled={isRoot} aria-describedby={isRoot ? `${node.id}-sibling-help` : undefined} onClick={() => invoke(onAddSibling)}>Add sibling</button>
          <button type="button" role="menuitem" onClick={() => invoke(onDuplicate)}>Duplicate</button>
          <button type="button" role="menuitem" class="sg-sitemapper-danger" disabled={isRoot} aria-describedby={isRoot ? `${node.id}-delete-help` : undefined} onClick={() => invoke(onDelete)}>Delete</button>
          {isRoot && <span id={`${node.id}-sibling-help`} class="sg-sitemapper-sr-only">The root page cannot have a sibling.</span>}
          {isRoot && <span id={`${node.id}-delete-help`} class="sg-sitemapper-sr-only">The root page cannot be deleted.</span>}
        </div>
      )}
    </div>
  );
}

export default SitemapNode;
