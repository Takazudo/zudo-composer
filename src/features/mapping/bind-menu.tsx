/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { ComponentChildren, JSX } from "preact";
import { Fragment } from "preact";
import { useRef } from "preact/hooks";
import { PlusIcon, type IconComponent } from "../../components/icons";
import { Menu, MenuItem, MenuSection, useMenu } from "../../components/overlay";
import { Button, type ButtonProps } from "../../components/ui";
import type { MappingMenuGroup } from "./presentation";

// The one binding affordance, in three places: the `+` on an unbound source
// field, the `+` chip on an unbound target, and the Fix action on a broken
// row's inline diagnostic. All three ask the same question — "which of the
// compatible things on the other side?" — so they share one menu, and the
// shared `Menu`'s typeahead and roving focus come along with it.

export interface BindMenuItem {
  readonly id: string;
  readonly label: string;
  /** The kind or prop under the label — what makes two similar rows tellable apart. */
  readonly detail: string;
  readonly icon?: IconComponent;
}

export interface BindMenuProps {
  /** Names the panel, e.g. "Bind Slug to…". */
  menuLabel: string;
  /** Accessible name of the trigger; required, because the `+` triggers have no text. */
  triggerLabel: string;
  /** Trigger content; a bare `+` icon button when omitted. */
  children?: ComponentChildren;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerClass?: string;
  groups: readonly MappingMenuGroup<BindMenuItem>[];
  /** Shown as one inert row when nothing on the other side is compatible. */
  emptyLabel: string;
  onSelect: (id: string) => void;
}

export function BindMenu({
  menuLabel,
  triggerLabel,
  children,
  triggerVariant = "ghost",
  triggerSize = "sm",
  triggerClass,
  groups,
  emptyLabel,
  onSelect,
}: BindMenuProps): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef, { align: "start" });
  const empty = groups.every((group) => group.items.length === 0);
  const trigger = { elementRef: triggerRef, variant: triggerVariant, size: triggerSize, class: triggerClass, ...menu.triggerProps };

  return (
    <Fragment>
      {children === undefined ? (
        <Button {...trigger} iconOnly aria-label={triggerLabel}>
          <PlusIcon size="sm" />
        </Button>
      ) : (
        <Button {...trigger} aria-label={triggerLabel}>
          {children}
        </Button>
      )}
      <Menu controller={menu} label={menuLabel} class="cms-mapping-bind-menu">
        {empty ? (
          <MenuItem disabled>{emptyLabel}</MenuItem>
        ) : (
          groups.map((group) => (
            <MenuSection key={group.id} title={group.label}>
              {group.items.map((item) => (
                <MenuItem key={item.id} icon={item.icon} onSelect={() => onSelect(item.id)}>
                  <span class="cms-mapping-bind-menu__label">{item.label}</span>
                  <span class="cms-mapping-bind-menu__detail">{item.detail}</span>
                </MenuItem>
              ))}
            </MenuSection>
          ))
        )}
      </Menu>
    </Fragment>
  );
}
