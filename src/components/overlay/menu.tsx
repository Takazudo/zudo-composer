import { computed, getScope, Show, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { allocateOverlayId } from "./overlay-id";
import { CheckIcon, type IconComponent } from "../icons";
import { read, type MaybeSignal } from "../reactive";
import { computeMenuPosition } from "./menu-position";
import { OverlayPortal } from "./portal";
import type { CloseMenuOptions, MenuController } from "./use-menu";
import { createMenu } from "./use-menu";

// The CMS popover menu (issue #159): `role="menu"` with roving Arrow/Home/End
// focus, typeahead, Escape/outside-click dismissal and focus restored to the
// trigger. It paints in a body-level layer at a fixed, viewport-clamped
// position (see `menu-position.ts`) so a row menu in a scrolling table is
// never clipped by the table's own overflow or stacking context.
//
// Items need no context: the panel closes the menu chain when a click lands
// on an item that does not opt out (`data-menu-keep-open`). A submenu finds
// its owning menu through the panel element its trigger sits in; the lookup
// is keyed by that DOM node, so nothing is shared between unrelated menus.

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

/** How long a typeahead buffer stays live before the next key starts a new search. */
const TYPEAHEAD_RESET_MS = 500;

interface MenuSurfaceHandle {
  close: (options?: CloseMenuOptions) => void;
  register: (panel: HTMLElement) => () => void;
}

const surfaces = new WeakMap<Element, MenuSurfaceHandle>();

/** An item's action, handed to its panel's click handler to run after the menu closes. */
const deferredSelections = new WeakMap<Event, () => void>();

function select(event: Event, onSelect: (() => void) | undefined): void {
  if (!onSelect) return;
  const item = event.currentTarget as Element;
  const panel = item.closest('[role="menu"]');
  if (panel && surfaces.has(panel) && !item.hasAttribute("data-menu-keep-open")) deferredSelections.set(event, onSelect);
  else onSelect();
}

function owningSurface(trigger: HTMLElement | null): MenuSurfaceHandle | null {
  const panel = trigger?.closest('[role="menu"]');
  return panel ? surfaces.get(panel) ?? null : null;
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

const CLIPPING_OVERFLOWS = new Set(["auto", "scroll", "hidden", "clip"]);

function clippingAncestors(trigger: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let ancestor = trigger.parentElement;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    if (
      CLIPPING_OVERFLOWS.has(style.overflow) ||
      CLIPPING_OVERFLOWS.has(style.overflowX) ||
      CLIPPING_OVERFLOWS.has(style.overflowY)
    ) {
      ancestors.push(ancestor);
    }
    ancestor = ancestor.parentElement;
  }
  return ancestors;
}

function hasVisibleIntersection(trigger: HTMLElement, ancestors: readonly HTMLElement[]): boolean {
  const triggerRect = trigger.getBoundingClientRect();
  let left = Math.max(triggerRect.left, 0);
  let top = Math.max(triggerRect.top, 0);
  let right = Math.min(triggerRect.right, window.innerWidth);
  let bottom = Math.min(triggerRect.bottom, window.innerHeight);

  for (const ancestor of ancestors) {
    const rect = ancestor.getBoundingClientRect();
    left = Math.max(left, rect.left);
    top = Math.max(top, rect.top);
    right = Math.min(right, rect.right);
    bottom = Math.min(bottom, rect.bottom);
  }
  return right > left && bottom > top;
}

export interface MenuProps {
  controller: MenuController;
  /** Accessible name for the menu region — required, menus are unlabelled otherwise. */
  label: string;
  class?: string;
  children: Child;
}

export function Menu({ controller, label, class: className, children }: MenuProps): Child {
  return (
    <Show when={controller.open}>
      {() => <MenuLayer controller={controller} label={label} class={className}>{children}</MenuLayer>}
    </Show>
  );
}

function MenuLayer(props: MenuProps): Child {
  // Inside a native modal the layer stays in the dialog's top-layer subtree.
  const container = props.controller.triggerRef.current?.closest("dialog[open]") ?? null;
  return <OverlayPortal hostClass="cms-overlay-portal" container={container}><MenuSurface {...props} /></OverlayPortal>;
}

function MenuSurface({ controller, label, class: className, children }: MenuProps): Child {
  const scope = getScope();
  const panelRef: { current: HTMLDivElement | null } = { current: null };
  const descendants = new Set<HTMLElement>();
  const typeahead = { buffer: "", at: 0 };
  const { closeMenu, focusIntent, placement, triggerRef } = controller;
  let parent: MenuSurfaceHandle | null = null;

  const handle: MenuSurfaceHandle = {
    close: (options) => { closeMenu(options); parent?.close(options); },
    register: (panel) => {
      descendants.add(panel);
      const unregisterParent = parent?.register(panel);
      return () => { descendants.delete(panel); unregisterParent?.(); };
    },
  };

  const focusInitial = (intent: string) => {
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
    const fallback = intent === "last" ? items.length - 1 : 0;
    focusItem(items, checked >= 0 ? checked : fallback);
  };

  // Registered on activation rather than during setup, so the very click that
  // opened the menu can never also dismiss it.
  scope.onActivate(() => {
    const found = panelRef.current;
    if (!found) return undefined;
    const menuPanel: HTMLDivElement = found;
    parent = owningSurface(triggerRef.current);
    surfaces.set(menuPanel, handle);
    const unregister = parent?.register(menuPanel);

    function onPointerDown(event: Event): void {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuPanel.contains(target)) return;
      if ([...descendants].some((descendant) => descendant.contains(target))) return;
      // The trigger's own click toggles the menu shut; dismissing here too
      // would close and immediately reopen it.
      if (triggerRef.current?.contains(target)) return;
      closeMenu({ restoreFocus: false });
    }

    let activeTrigger: HTMLElement | null = null;
    let ancestors: HTMLElement[] = [];
    let retryFrame: number | null = null;

    function position(trigger: HTMLElement): void {
      const anchor = trigger.getBoundingClientRect();
      const panelRect = menuPanel.getBoundingClientRect();
      const next = computeMenuPosition(
        anchor,
        { width: panelRect.width, height: panelRect.height },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
      );
      menuPanel.style.left = `${next.left}px`;
      menuPanel.style.top = `${next.top}px`;
      menuPanel.style.maxHeight = `${next.maxHeight}px`;
      menuPanel.dataset.side = next.side;
    }

    function removeAncestorListeners(): void {
      for (const ancestor of ancestors) ancestor.removeEventListener("scroll", onViewportChange);
    }

    function bind(trigger: HTMLElement): void {
      removeAncestorListeners();
      activeTrigger = trigger;
      ancestors = clippingAncestors(trigger);
      for (const ancestor of ancestors) ancestor.addEventListener("scroll", onViewportChange);
    }

    function scheduleAnchorRetry(): void {
      if (retryFrame !== null) return;
      retryFrame = requestAnimationFrame(() => {
        retryFrame = null;
        const trigger = triggerRef.current;
        if (!trigger?.isConnected) {
          closeMenu({ restoreFocus: false });
          return;
        }
        bind(trigger);
        position(trigger);
      });
    }

    function onViewportChange(): void {
      const trigger = triggerRef.current;
      if (!trigger?.isConnected) {
        scheduleAnchorRetry();
        return;
      }
      if (trigger !== activeTrigger) bind(trigger);
      if (!hasVisibleIntersection(trigger, ancestors)) {
        closeMenu({ restoreFocus: false });
        return;
      }
      position(trigger);
    }

    // Anchor once the whole update that opened the menu has landed: the same
    // flush may still replace or remove the trigger node after this activates.
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      const trigger = triggerRef.current;
      if (trigger?.isConnected) {
        bind(trigger);
        position(trigger);
      } else {
        scheduleAnchorRetry();
      }
    });

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onViewportChange);
    window.addEventListener("resize", onViewportChange);
    return () => {
      disposed = true;
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onViewportChange);
      window.removeEventListener("resize", onViewportChange);
      removeAncestorListeners();
      if (retryFrame !== null) cancelAnimationFrame(retryFrame);
      surfaces.delete(menuPanel);
      unregister?.();
    };
  });

  // Focus follows the open intent: on activation, and again if the trigger
  // reopens the still-mounted menu from the other end.
  scope.effect(() => {
    const intent = focusIntent.value;
    if (panelRef.current) focusInitial(intent);
  });

  function closingItem(event: MouseEvent): Element | null {
    const item = (event.target as Element | null)?.closest(ITEM_SELECTOR);
    if (!item || !panelRef.current?.contains(item)) return null;
    if ((item as HTMLButtonElement).disabled || item.getAttribute("aria-disabled") === "true") return null;
    if (item.hasAttribute("data-menu-keep-open")) return null;
    return item;
  }

  // A browser drains microtasks between a real click's listeners, so an item
  // acting from its own listener (opening a confirm dialog, say) would mount
  // that dialog before this close, and it would take the unmounting item as
  // the place to return focus to. The panel closes first, then runs the item.
  function onClick(event: MouseEvent): void {
    if (closingItem(event)) handle.close();
    const selection = deferredSelections.get(event);
    deferredSelections.delete(event);
    selection?.();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const panel = panelRef.current;
    if (!panel) return;
    if (event.isComposing || event.keyCode === 229) return;

    if (event.key === "Escape" || (parent && event.key === "ArrowLeft")) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      // Menus are not tab stops: Tab dismisses and hands focus back to the
      // trigger, from where the next Tab continues through the page.
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      parent?.close();
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
    const state = typeahead;
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
    <div
      ref={panelRef}
      id={controller.id}
      role="menu"
      aria-label={label}
      tabindex={-1}
      class={className ? `cms-menu ${className}` : "cms-menu"}
      on:keydown={onKeyDown}
      on:click={onClick}
    >
      {children}
    </div>
  );
}

export interface MenuSubmenuProps {
  label: string;
  children: Child;
  disabled?: MaybeSignal<boolean>;
  icon?: IconComponent;
}

/** Nested actions such as Arrange. Escape/Left returns to this item's focus. */
export function MenuSubmenu({ label, children, disabled, icon }: MenuSubmenuProps): Child {
  const trigger: { current: HTMLButtonElement | null } = { current: null };
  const controller = createMenu(trigger, { side: "right" });
  return <>
    <button ref={trigger} type="button" role="menuitem" tabindex={-1} class="cms-menu__item" disabled={disabled} data-menu-keep-open=""
      {...controller.triggerProps}
      on:keydown={(event: KeyboardEvent) => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
          event.preventDefault(); event.stopPropagation(); controller.openMenu();
        }
      }}>
      <MenuRowContent icon={icon} kbd="›">{label}</MenuRowContent>
    </button>
    <Menu controller={controller} label={label}>{children}</Menu>
  </>;
}

export interface MenuRowProps {
  children: Child;
  /** Runs before the menu closes. */
  onSelect?: () => void;
  /** Leading glyph in the fixed icon column; the column is reserved either way so labels line up. */
  icon?: IconComponent;
  /** Shortcut hint pinned to the trailing edge. Decorative — it stays out of the item's accessible name. */
  kbd?: string;
  tone?: "default" | "danger";
  disabled?: MaybeSignal<boolean>;
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

function MenuRowContent({ icon: Icon, kbd, children }: Pick<MenuRowProps, "icon" | "kbd" | "children">): Child {
  return (
    <>
      <span class="cms-menu__icon" aria-hidden="true">{Icon ? <Icon size="sm" /> : null}</span>
      <span class="cms-menu__label">{children}</span>
      {kbd ? <span class="cms-menu__kbd" aria-hidden="true">{kbd}</span> : null}
    </>
  );
}

function keepOpen(closeOnSelect: boolean): Record<string, string> {
  return closeOnSelect ? {} : { "data-menu-keep-open": "" };
}

export function MenuItem({ children, onSelect, icon, kbd, tone, disabled, closeOnSelect = true, class: className, href }: MenuItemProps): Child {
  if (href !== undefined) {
    // `disabled` is not an anchor attribute, so a disabled link is marked and
    // neutered instead — `aria-disabled` is what keeps it out of roving focus.
    return (
      <a
        role="menuitem"
        tabindex={-1}
        class={rowClass(tone, className)}
        href={href}
        aria-disabled={computed(() => (disabled !== undefined && read(disabled) ? "true" : undefined))}
        {...keepOpen(closeOnSelect)}
        on:click={(event) => {
          if (disabled !== undefined && read(disabled)) {
            event.preventDefault();
            return;
          }
          select(event, onSelect);
        }}
      >
        <MenuRowContent icon={icon} kbd={kbd}>{children}</MenuRowContent>
      </a>
    );
  }
  return (
    <button type="button" role="menuitem" tabindex={-1} class={rowClass(tone, className)} disabled={disabled} {...keepOpen(closeOnSelect)} on:click={(event) => select(event, onSelect)}>
      <MenuRowContent icon={icon} kbd={kbd}>{children}</MenuRowContent>
    </button>
  );
}

/** The check column is driven by `checked`, so these rows take no `icon`. */
export interface MenuCheckedItemProps extends Omit<MenuRowProps, "icon"> {
  checked: MaybeSignal<boolean>;
}

function CheckedItem({ role, checked, children, onSelect, kbd, tone, disabled, closeOnSelect = true, class: className }: MenuCheckedItemProps & { role: "menuitemradio" | "menuitemcheckbox" }): Child {
  const on: ReadonlySignal<boolean> = computed(() => read(checked));
  return (
    <button
      type="button"
      role={role}
      aria-checked={computed(() => (on.value ? "true" : "false"))}
      tabindex={-1}
      class={rowClass(tone, className)}
      disabled={disabled}
      {...keepOpen(closeOnSelect)}
      on:click={(event) => select(event, onSelect)}
    >
      <span class="cms-menu__icon" aria-hidden="true"><Show when={on}>{() => <CheckIcon size="sm" />}</Show></span>
      <span class="cms-menu__label">{children}</span>
      {kbd ? <span class="cms-menu__kbd" aria-hidden="true">{kbd}</span> : null}
    </button>
  );
}

/** One choice in a single-select group — the theme control's shape. */
export function MenuRadioItem(props: MenuCheckedItemProps): Child {
  return <CheckedItem role="menuitemradio" {...props} />;
}

/** An independently togglable option; stays open by default so several can be flipped. */
export function MenuCheckboxItem(props: MenuCheckedItemProps): Child {
  return <CheckedItem role="menuitemcheckbox" {...props} closeOnSelect={props.closeOnSelect ?? false} />;
}

export function MenuSeparator(): Child {
  return <hr class="cms-menu__separator" />;
}

export interface MenuSectionProps {
  title: string;
  children: Child;
}

/** A titled run of items. `role="group"` keeps the title out of the item sequence. */
export function MenuSection({ title, children }: MenuSectionProps): Child {
  const titleId = allocateOverlayId("menu-section");
  return (
    <div class="cms-menu__section" role="group" aria-labelledby={titleId}>
      <div id={titleId} class="cms-menu__title">{title}</div>
      {children}
    </div>
  );
}
