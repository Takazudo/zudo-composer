import { computed, getScope, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { ComposerIcon, DuplicateIcon, EllipsisIcon, MappingIcon, PlusIcon, TrashIcon } from "../../../../components/icons";
import { createMenu, Menu, MenuItem, MenuSeparator } from "../../../../components/overlay";
import { Rebuild } from "../../../../components/rebuild";
import { Chip } from "../../../../components/ui";
import type { SitemapNode as SitemapNodeModel } from "../../../../sitemapper/model";
import type { NodeRectangle } from "./layout";
import type { PageSourceLabel } from "./page-source";

export interface SitemapNodeProps {
  /** The page id; the node is keyed by it for its whole life. */
  id: string;
  node: ReadonlySignal<SitemapNodeModel>;
  /** The page's authored route, e.g. `/products/pricing`. */
  route: ReadonlySignal<string>;
  source: ReadonlySignal<PageSourceLabel | undefined>;
  rectangle: ReadonlySignal<NodeRectangle>;
  selected: ReadonlySignal<boolean>;
  isRoot: ReadonlySignal<boolean>;
  /** Called with the node's element once it is in the document, and with `null` when it leaves. */
  onElement: (id: string, element: HTMLDivElement | null) => void;
  onSelect: (id: string) => void;
  onAddChild: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SitemapNode({
  id,
  node,
  route,
  source,
  rectangle,
  selected,
  isRoot,
  onElement,
  onSelect,
  onAddChild,
  onDuplicate,
  onDelete,
}: SitemapNodeProps): Child {
  const scope = getScope();
  const wrapRef: Ref<HTMLDivElement> = { current: null };
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef, { align: "end" });
  const title = computed(() => node.value.title);
  scope.onActivate(() => {
    onElement(id, wrapRef.current);
    return () => onElement(id, null);
  });

  return (
    <div
      ref={wrapRef}
      class="sg-sitemapper-node-wrap"
      data-sg-node-id={id}
      style={computed(() => ({
        "--sg-sitemapper-node-left": `${rectangle.value.left}px`,
        "--sg-sitemapper-node-top": `${rectangle.value.top}px`,
        "--sg-sitemapper-node-width": `${rectangle.value.width}px`,
      }))}
    >
      <button
        type="button"
        class="sg-sitemapper-node"
        data-sg-depth={computed(() => rectangle.value.depth)}
        data-sg-root={computed(() => isRoot.value ? "true" : null)}
        data-sg-selected={computed(() => selected.value ? "true" : null)}
        data-sg-external={computed(() => rectangle.value.external || rectangle.value.externalCluster ? "true" : null)}
        aria-pressed={computed(() => selected.value ? "true" : "false")}
        on:click={() => onSelect(id)}
      >
        <span class="sg-sitemapper-node__title">{title}</span>
        <span class="sg-sitemapper-node__route">{route}</span>
        <Rebuild value={source}>{(current) => {
          if (!current) return <Chip tone="warn" class="sg-sitemapper-node__chip">Unassigned</Chip>;
          const SourceIcon = current.kind === "mapping" ? MappingIcon : ComposerIcon;
          return (
            <span class="sg-sitemapper-node__source" title={current.detail ? `${current.name} · ${current.detail}` : current.name}>
              <SourceIcon size="xs" />
              <span>{current.name}</span>
            </span>
          );
        }}</Rebuild>
      </button>
      <button
        type="button"
        ref={triggerRef}
        class="cms-btn cms-btn--ghost cms-btn--xs cms-btn--icon sg-sitemapper-node__menu-trigger"
        aria-label={computed(() => `Actions for ${title.value}`)}
        {...menu.triggerProps}
      >
        <EllipsisIcon size="xs" />
      </button>
      <Rebuild value={title}>{(currentTitle) => (
        <Menu controller={menu} label={`${currentTitle} actions`}>
          <MenuItem icon={PlusIcon} onSelect={() => onAddChild(id)}>Add child page</MenuItem>
          <MenuItem icon={DuplicateIcon} disabled={isRoot} onSelect={() => onDuplicate(id)}>Duplicate</MenuItem>
          <MenuSeparator />
          <MenuItem icon={TrashIcon} tone="danger" disabled={isRoot} onSelect={() => onDelete(id)}>Delete…</MenuItem>
        </Menu>
      )}</Rebuild>
    </div>
  );
}

export default SitemapNode;
