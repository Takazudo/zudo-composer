/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX, Ref } from "preact";
import { useRef } from "preact/hooks";
import { ComposerIcon, DuplicateIcon, EllipsisIcon, MappingIcon, PlusIcon, TrashIcon } from "../../../../components/icons";
import { Menu, MenuItem, MenuSeparator, useMenu } from "../../../../components/overlay";
import { Chip } from "../../../../components/ui";
import type { SitemapNode as SitemapNodeModel } from "../../../../sitemapper/model";
import type { NodeRectangle } from "./layout";
import type { PageSourceLabel } from "./page-source";

export interface SitemapNodeProps {
  node: SitemapNodeModel;
  /** The page's authored route, e.g. `/products/pricing`. */
  route: string;
  source?: PageSourceLabel;
  rectangle: NodeRectangle;
  selected: boolean;
  isRoot: boolean;
  nodeRef: Ref<HTMLDivElement>;
  onSelect: (id: string) => void;
  onAddChild: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SitemapNode({
  node,
  route,
  source,
  rectangle,
  selected,
  isRoot,
  nodeRef,
  onSelect,
  onAddChild,
  onDuplicate,
  onDelete,
}: SitemapNodeProps): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef, { align: "end" });
  const SourceIcon = source?.kind === "mapping" ? MappingIcon : ComposerIcon;
  const style = {
    "--sg-sitemapper-node-left": `${rectangle.left}px`,
    "--sg-sitemapper-node-top": `${rectangle.top}px`,
    "--sg-sitemapper-node-width": `${rectangle.width}px`,
  } as JSX.CSSProperties;

  return (
    <div ref={nodeRef} class="sg-sitemapper-node-wrap" data-sg-node-id={node.id} style={style}>
      <button
        type="button"
        class="sg-sitemapper-node"
        data-sg-depth={rectangle.depth}
        data-sg-root={isRoot ? "true" : undefined}
        data-sg-selected={selected ? "true" : undefined}
        data-sg-external={rectangle.external || rectangle.externalCluster ? "true" : undefined}
        aria-pressed={selected}
        onClick={() => onSelect(node.id)}
      >
        <span class="sg-sitemapper-node__title">{node.title}</span>
        <span class="sg-sitemapper-node__route">{route}</span>
        {source ? (
          <span class="sg-sitemapper-node__source" title={source.detail ? `${source.name} · ${source.detail}` : source.name}>
            <SourceIcon size="xs" />
            <span>{source.name}</span>
          </span>
        ) : (
          <Chip tone="warn" class="sg-sitemapper-node__chip">Unassigned</Chip>
        )}
      </button>
      <button
        type="button"
        ref={triggerRef}
        class="cms-btn cms-btn--ghost cms-btn--xs cms-btn--icon sg-sitemapper-node__menu-trigger"
        aria-label={`Actions for ${node.title}`}
        {...menu.triggerProps}
      >
        <EllipsisIcon size="xs" />
      </button>
      <Menu controller={menu} label={`${node.title} actions`}>
        <MenuItem icon={PlusIcon} disabled={node.source.kind === "mapping"} onSelect={() => onAddChild(node.id)}>Add child page</MenuItem>
        <MenuItem icon={DuplicateIcon} disabled={isRoot} onSelect={() => onDuplicate(node.id)}>Duplicate</MenuItem>
        <MenuSeparator />
        <MenuItem icon={TrashIcon} tone="danger" disabled={isRoot} onSelect={() => onDelete(node.id)}>Delete…</MenuItem>
      </Menu>
    </div>
  );
}

export default SitemapNode;
