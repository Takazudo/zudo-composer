import type { Child, Ref } from "@takazudo/zfb/zudo-react";
import { EllipsisIcon, type IconComponent } from "../icons";
import { createMenu, Menu, MenuItem, MenuSeparator } from "../overlay";
import type { MaybeSignal } from "../reactive";

// The row `⋯` menu (issue #164).
//
// Ordering is structural rather than a convention a route can drift from:
// `open` is pinned first because it is the row's primary action, and
// `destructive` is pinned last behind a separator so a mis-aimed pointer
// cannot land on Delete. The panel is the shared portal `Menu`, which is what
// keeps it out of the table's own scroll clipping.

export interface RowMenuAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconComponent;
  /** Shortcut hint; decorative, and kept out of the item's accessible name. */
  readonly kbd?: string;
  readonly disabled?: MaybeSignal<boolean>;
  /** Renders the item as a link — a deep link into the record. */
  readonly href?: string;
  readonly onSelect?: () => void;
}

export interface RowMenuProps {
  /** The row's own name. It names both the trigger and the menu. */
  label: string;
  /** Pinned first. */
  open?: RowMenuAction;
  actions?: readonly RowMenuAction[];
  /** Pinned last, behind a separator and styled destructive. */
  destructive?: readonly RowMenuAction[];
  /** Overrides the trigger's accessible name; defaults to `More actions for {label}`. */
  triggerLabel?: string;
  class?: string;
}

export function RowMenu({ label, open, actions = [], destructive = [], triggerLabel, class: className }: RowMenuProps): Child {
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef, { align: "end" });
  const items = open ? [open, ...actions] : [...actions];

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        class={`cms-btn cms-btn--ghost cms-btn--sm cms-btn--icon${className ? ` ${className}` : ""}`}
        aria-label={triggerLabel ?? `More actions for ${label}`}
        {...menu.triggerProps}
      >
        <EllipsisIcon size="sm" />
      </button>
      <Menu controller={menu} label={`${label} actions`}>
        {items.map((action) => (
          <MenuItem
            key={action.id}
            icon={action.icon}
            kbd={action.kbd}
            href={action.href}
            disabled={action.disabled}
            onSelect={action.onSelect}
          >
            {action.label}
          </MenuItem>
        ))}
        {destructive.length > 0 && items.length > 0 ? <MenuSeparator /> : null}
        {destructive.map((action) => (
          <MenuItem
            key={action.id}
            tone="danger"
            icon={action.icon}
            kbd={action.kbd}
            href={action.href}
            disabled={action.disabled}
            onSelect={action.onSelect}
          >
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
