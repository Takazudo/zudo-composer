import { createContext, type ComponentChildren, type JSX } from "preact";
import { useContext, useId, useLayoutEffect, useRef } from "preact/hooks";
import { CheckIcon, type IconComponent } from "../icons";
import { computeMenuPosition } from "./menu-position";
import { OverlayPortal } from "./portal";
import type { CloseMenuOptions, MenuController } from "./use-menu";

// The CMS popover menu (issue #159): `role="menu"` with roving Arrow/Home/End
// focus, typeahead, Escape/outside-click dismissal and focus restored to the
// trigger. It paints in a body-level portal at a fixed, viewport-clamped
// position (see `menu-position.ts`) so a row menu in a scrolling table is
// never clipped by the table's own overflow or stacking context.

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

/** How long a typeahead buffer stays live before the next key starts a new search. */
const TYPEAHEAD_RESET_MS = 500;

interface MenuContextValue {
  close: (options?: CloseMenuOptions) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext(): MenuContextValue {
  const value = useContext(MenuContext);
  if (!value) throw new Error("Menu items must be rendered inside a <Menu>.");
  return value;
}

function enabledItems(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
    (item) => !(item as HTMLButtonElement).disabled && item.getAttribute("aria-disabled") !== "true",
  );
}

function focusItem(items: readonly HTMLElement[], index: number): void {
  // Roving tabindex: only the focused item is in the sequential order, so a
  // Tab out of the menu is one step, not one step per item.
  for (const [position, item] of items.entries()) item.tabIndex = position === index ? 0 : -1;
  items[index]?.focus();
}

export interface MenuProps {
  controller: MenuController;
  /** Accessible name for the menu region — required, menus are unlabelled otherwise. */
  label: string;
  class?: string;
  children: ComponentChildren;
}

export function Menu({ controller, label, class: className, children }: MenuProps): JSX.Element | null {
  if (!controller.open) return null;
  return (
    <OverlayPortal hostClass="cms-overlay-portal">
      <MenuSurface controller={controller} label={label} class={className}>
        {children}
      </MenuSurface>
    </OverlayPortal>
  );
}

function MenuSurface({ controller, label, class: className, children }: MenuProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const typeaheadRef = useRef({ buffer: "", at: 0 });
  const { closeMenu, focusIntent, placement, triggerRef } = controller;

  // Re-measured on EVERY render, not just when the anchor moves: the panel's
  // own size changes with its content (a radio group gaining a check column,
  // a section appearing), and a stale clamp would leave it over an edge it
  // just grew past. Layout effect so it never paints at the unclamped spot.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const anchor = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const position = computeMenuPosition(
      anchor,
      { width: panelRect.width, height: panelRect.height },
      { width: window.innerWidth, height: window.innerHeight },
      placement,
    );
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
    panel.style.maxHeight = `${position.maxHeight}px`;
    panel.dataset.side = position.side;
  });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const items = enabledItems(panel);
    if (items.length === 0) {
      panel.focus();
      return;
    }
    // A menu with a chosen option opens on that option, so Enter re-picks what
    // is already in force rather than the first row.
    const checked = items.findIndex((item) => item.getAttribute("aria-checked") === "true");
    const fallback = focusIntent === "last" ? items.length - 1 : 0;
    focusItem(items, checked >= 0 ? checked : fallback);
  }, [focusIntent]);

  // Registered in an effect rather than during render, so the very click that
  // opened the menu can never also dismiss it.
  useLayoutEffect(() => {
    function onPointerDown(event: Event): void {
      const panel = panelRef.current;
      const target = event.target as Node | null;
      if (!panel || !target) return;
      if (panel.contains(target)) return;
      // The trigger's own click toggles the menu shut; dismissing here too
      // would close and immediately reopen it.
      if (triggerRef.current?.contains(target)) return;
      closeMenu({ restoreFocus: false });
    }
    function onDismiss(): void {
      closeMenu({ restoreFocus: false });
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [closeMenu, triggerRef]);

  function onKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
    const panel = panelRef.current;
    if (!panel) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      // Menus are not tab stops: Tab dismisses and hands focus back to the
      // trigger, from where the next Tab continues through the page.
      event.preventDefault();
      closeMenu();
      return;
    }

    const items = enabledItems(panel);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);

    let next: number | null = null;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;

    if (next === null && event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      next = typeaheadTarget(items, current, event.key);
    }

    if (next === null) return;
    event.preventDefault();
    focusItem(items, next);
  }

  function typeaheadTarget(items: readonly HTMLElement[], current: number, key: string): number | null {
    const state = typeaheadRef.current;
    const now = Date.now();
    state.buffer = now - state.at > TYPEAHEAD_RESET_MS ? key : state.buffer + key;
    state.at = now;

    // One letter pressed repeatedly cycles through the items starting with it;
    // a genuine multi-letter prefix narrows onto the row already under focus.
    const repeated = [...state.buffer].every((character) => character === key);
    const query = (repeated ? key : state.buffer).toLowerCase();
    const start = current < 0 ? 0 : repeated ? current + 1 : current;

    for (let step = 0; step < items.length; step += 1) {
      const index = (start + step) % items.length;
      if ((items[index]?.textContent ?? "").trim().toLowerCase().startsWith(query)) return index;
    }
    return null;
  }

  return (
    <MenuContext.Provider value={{ close: closeMenu }}>
      <div
        ref={panelRef}
        id={controller.id}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        class={className ? `cms-menu ${className}` : "cms-menu"}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
}

export interface MenuRowProps {
  children: ComponentChildren;
  onSelect?: () => void;
  /** Leading glyph in the fixed icon column; the column is reserved either way so labels line up. */
  icon?: IconComponent;
  /** Shortcut hint pinned to the trailing edge. Decorative — it stays out of the item's accessible name. */
  kbd?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Set false for items that open a sub-view and keep the menu up. */
  closeOnSelect?: boolean;
  class?: string;
}

export interface MenuItemProps extends MenuRowProps {
  /** Renders the item as a link. */
  href?: string;
}

function rowClass(tone: MenuRowProps["tone"], className: string | undefined): string {
  return ["cms-menu__item", tone === "danger" ? "cms-menu__item--danger" : null, className].filter(Boolean).join(" ");
}

function MenuRowContent({ icon: Icon, kbd, children }: Pick<MenuRowProps, "icon" | "kbd" | "children">): JSX.Element {
  return (
    <>
      <span class="cms-menu__icon" aria-hidden="true">{Icon ? <Icon size="sm" /> : null}</span>
      <span class="cms-menu__label">{children}</span>
      {kbd ? <span class="cms-menu__kbd" aria-hidden="true">{kbd}</span> : null}
    </>
  );
}

export function MenuItem({ children, onSelect, icon, kbd, tone, disabled, closeOnSelect = true, class: className, href }: MenuItemProps): JSX.Element {
  const { close } = useMenuContext();
  function select(): void {
    onSelect?.();
    if (closeOnSelect) close();
  }
  if (href !== undefined) {
    // `disabled` is not an anchor attribute, so a disabled link is marked and
    // neutered instead — `aria-disabled` is what keeps it out of roving focus.
    return (
      <a
        role="menuitem"
        tabIndex={-1}
        class={rowClass(tone, className)}
        href={href}
        aria-disabled={disabled ? "true" : undefined}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          select();
        }}
      >
        <MenuRowContent icon={icon} kbd={kbd}>{children}</MenuRowContent>
      </a>
    );
  }
  return (
    <button type="button" role="menuitem" tabIndex={-1} class={rowClass(tone, className)} disabled={disabled} onClick={select}>
      <MenuRowContent icon={icon} kbd={kbd}>{children}</MenuRowContent>
    </button>
  );
}

/** The check column is driven by `checked`, so these rows take no `icon`. */
export interface MenuCheckedItemProps extends Omit<MenuRowProps, "icon"> {
  checked: boolean;
}

function CheckedItem({ role, checked, children, onSelect, kbd, tone, disabled, closeOnSelect = true, class: className }: MenuCheckedItemProps & { role: "menuitemradio" | "menuitemcheckbox" }): JSX.Element {
  const { close } = useMenuContext();
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked ? "true" : "false"}
      tabIndex={-1}
      class={rowClass(tone, className)}
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        if (closeOnSelect) close();
      }}
    >
      <MenuRowContent icon={checked ? CheckIcon : undefined} kbd={kbd}>{children}</MenuRowContent>
    </button>
  );
}

/** One choice in a single-select group — the theme control's shape. */
export function MenuRadioItem(props: MenuCheckedItemProps): JSX.Element {
  return <CheckedItem role="menuitemradio" {...props} />;
}

/** An independently togglable option; stays open by default so several can be flipped. */
export function MenuCheckboxItem(props: MenuCheckedItemProps): JSX.Element {
  return <CheckedItem role="menuitemcheckbox" {...props} closeOnSelect={props.closeOnSelect ?? false} />;
}

export function MenuSeparator(): JSX.Element {
  return <hr class="cms-menu__separator" />;
}

export interface MenuSectionProps {
  title: string;
  children: ComponentChildren;
}

/** A titled run of items. `role="group"` keeps the title out of the item sequence. */
export function MenuSection({ title, children }: MenuSectionProps): JSX.Element {
  const titleId = `cms-menu-section-${useId()}`;
  return (
    <div class="cms-menu__section" role="group" aria-labelledby={titleId}>
      <div id={titleId} class="cms-menu__title">{title}</div>
      {children}
    </div>
  );
}
