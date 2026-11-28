import type { Child, Ref } from "@takazudo/zfb/zudo-react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DuplicateIcon,
  EditIcon,
  EllipsisIcon,
  PlusIcon,
  TrashIcon,
} from "../../../../components/icons";
import { createMenu, Menu, MenuItem, MenuSeparator } from "../../../../components/overlay";
import { Button } from "../../../../components/ui";

// The hover affordance on one outline row: Add child, then everything else
// behind `⋯`. The seven always-visible icon buttons the previous rail carried
// are what this replaces — the row now shows two controls, and only on hover
// or focus, which is what keeps a 12-page outline readable.

export interface PageRowActionsProps {
  pageId: string;
  title: string;
  isRoot: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** A Mapping route family owns its own routes, so it takes no authored children. */
  canAddChild: boolean;
  onAddChild: (pageId: string) => void;
  onRename: (pageId: string) => void;
  onMove: (pageId: string, direction: "up" | "down") => void;
  onDuplicate: (pageId: string) => void;
  onDelete: (pageId: string) => void;
}

export function PageRowActions({
  pageId,
  title,
  isRoot,
  canMoveUp,
  canMoveDown,
  canAddChild,
  onAddChild,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
}: PageRowActionsProps): Child {
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef, { align: "end" });

  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        aria-label={`Add child page to ${title}`}
        disabled={!canAddChild}
        on:click={() => onAddChild(pageId)}
      >
        <PlusIcon size="xs" />
      </Button>
      <button
        type="button"
        ref={triggerRef}
        class="cms-btn cms-btn--ghost cms-btn--xs cms-btn--icon sg-sitemapper-row-menu"
        aria-label={`More actions for ${title}`}
        {...menu.triggerProps}
      >
        <EllipsisIcon size="xs" />
      </button>
      <Menu controller={menu} label={`${title} actions`}>
        <MenuItem icon={EditIcon} onSelect={() => onRename(pageId)}>Rename…</MenuItem>
        <MenuItem icon={ChevronUpIcon} disabled={!canMoveUp} onSelect={() => onMove(pageId, "up")}>Move up</MenuItem>
        <MenuItem icon={ChevronDownIcon} disabled={!canMoveDown} onSelect={() => onMove(pageId, "down")}>Move down</MenuItem>
        <MenuItem icon={DuplicateIcon} disabled={isRoot} onSelect={() => onDuplicate(pageId)}>Duplicate</MenuItem>
        <MenuSeparator />
        <MenuItem icon={TrashIcon} tone="danger" disabled={isRoot} onSelect={() => onDelete(pageId)}>Delete…</MenuItem>
      </Menu>
    </>
  );
}
