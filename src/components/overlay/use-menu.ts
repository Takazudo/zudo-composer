import { computed, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { allocateOverlayId } from "./overlay-id";
import type { MenuPlacement } from "./menu-position";

// Open/close state and the menu-button keyboard contract (issue #159).
// `Menu` owns everything that needs the panel's DOM (roving focus, dismissal,
// placement); this controller owns only what the TRIGGER needs, so a trigger
// can be any element the caller likes — a `Button`, a table row's `⋯` control,
// a tab. Create it once in the owning component's setup.

/** Which end of the item list takes focus when the menu opens. */
export type MenuFocusIntent = "first" | "last";

/** Anything with a `.current` — a zudo-react `Ref<HTMLButtonElement>` fits. */
export interface MenuTriggerRef {
  current: HTMLElement | null;
}

export interface MenuOptions extends MenuPlacement {
  /** Fired after every open/close, for callers that mirror the state (e.g. a row's hover affordance). */
  onOpenChange?: (open: boolean) => void;
}

/** Spread onto the trigger element (or a `Button`), alongside `ref={triggerRef}`. */
export interface MenuTriggerProps {
  "aria-haspopup": "menu";
  "aria-expanded": ReadonlySignal<"true" | "false">;
  /** Only while open — a closed menu has no element for it to point at. */
  "aria-controls": ReadonlySignal<string | undefined>;
  "on:click": (event: MouseEvent) => void;
  "on:keydown": (event: KeyboardEvent) => void;
}

export interface CloseMenuOptions {
  /** Send focus back to the trigger. True for keyboard dismissal, false when a pointer landed elsewhere. */
  restoreFocus?: boolean;
}

export interface MenuController {
  /** Id of the menu panel; also the trigger's `aria-controls`. */
  readonly id: string;
  readonly open: ReadonlySignal<boolean>;
  readonly focusIntent: ReadonlySignal<MenuFocusIntent>;
  readonly placement: MenuPlacement;
  readonly triggerRef: MenuTriggerRef;
  readonly triggerProps: MenuTriggerProps;
  openMenu: (focusIntent?: MenuFocusIntent) => void;
  closeMenu: (options?: CloseMenuOptions) => void;
}

export function createMenu(triggerRef: MenuTriggerRef, options: MenuOptions = {}): MenuController {
  const { align, side, gap, margin, onOpenChange } = options;
  const id = allocateOverlayId("menu");
  const open = signal(false);
  const focusIntent = signal<MenuFocusIntent>("first");

  // A pointer press, a scroll and a resize can all ask to close within one
  // gesture, and only the first of them is a state change worth reporting.
  const changeOpen = (next: boolean) => {
    if (open.value === next) return;
    open.value = next;
    onOpenChange?.(next);
  };

  const openMenu = (intent: MenuFocusIntent = "first") => {
    focusIntent.value = intent;
    changeOpen(true);
  };

  const closeMenu = ({ restoreFocus = true }: CloseMenuOptions = {}) => {
    changeOpen(false);
    // The trigger lives outside the panel, so focus can move before the
    // panel unmounts — no deferral needed to avoid landing on <body>.
    if (restoreFocus) triggerRef.current?.focus();
  };

  const placement: MenuPlacement = { align, side, gap, margin };

  const triggerProps: MenuTriggerProps = {
    "aria-haspopup": "menu",
    "aria-expanded": computed(() => (open.value ? "true" : "false")),
    "aria-controls": computed(() => (open.value ? id : undefined)),
    "on:click": () => {
      if (open.value) closeMenu();
      else openMenu("first");
    },
    "on:keydown": (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        // Enter/Space would otherwise fire the click handler too, toggling twice.
        event.preventDefault();
        if (open.value) closeMenu();
        else openMenu("first");
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        openMenu("last");
        return;
      }
      if (event.key === "Escape" && open.value) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      }
    },
  };

  return { id, open, focusIntent, placement, triggerRef, triggerProps, openMenu, closeMenu };
}
