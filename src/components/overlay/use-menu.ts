import { useCallback, useId, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { MenuPlacement } from "./menu-position";

// Open/close state and the menu-button keyboard contract (issue #159).
// `Menu` owns everything that needs the panel's DOM (roving focus, dismissal,
// placement); this hook owns only what the TRIGGER needs, so a trigger can be
// any element the caller likes — a `Button`, a table row's `⋯` control, a tab.

/** Which end of the item list takes focus when the menu opens. */
export type MenuFocusIntent = "first" | "last";

/** Anything with a `.current` — `useRef<HTMLButtonElement | null>(null)` fits. */
export interface MenuTriggerRef {
  current: HTMLElement | null;
}

export interface UseMenuOptions extends MenuPlacement {
  /** Fired after every open/close, for callers that mirror the state (e.g. a row's hover affordance). */
  onOpenChange?: (open: boolean) => void;
}

export interface MenuTriggerProps {
  "aria-haspopup": "menu";
  "aria-expanded": "true" | "false";
  "aria-controls": string;
  onClick: (event: JSX.TargetedMouseEvent<HTMLElement>) => void;
  onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLElement>) => void;
}

export interface CloseMenuOptions {
  /** Send focus back to the trigger. True for keyboard dismissal, false when a pointer landed elsewhere. */
  restoreFocus?: boolean;
}

export interface MenuController {
  /** Id of the menu panel; also the trigger's `aria-controls`. */
  readonly id: string;
  readonly open: boolean;
  readonly focusIntent: MenuFocusIntent;
  readonly placement: MenuPlacement;
  readonly triggerRef: MenuTriggerRef;
  readonly triggerProps: MenuTriggerProps;
  openMenu: (focusIntent?: MenuFocusIntent) => void;
  closeMenu: (options?: CloseMenuOptions) => void;
}

export function useMenu(triggerRef: MenuTriggerRef, options: UseMenuOptions = {}): MenuController {
  const { align, side, gap, margin, onOpenChange } = options;
  const id = `cms-menu-${useId()}`;
  const [open, setOpen] = useState(false);
  const [focusIntent, setFocusIntent] = useState<MenuFocusIntent>("first");
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const openMenu = useCallback((intent: MenuFocusIntent = "first") => {
    setFocusIntent(intent);
    setOpen((wasOpen) => {
      if (!wasOpen) onOpenChangeRef.current?.(true);
      return true;
    });
  }, []);

  const closeMenu = useCallback(
    ({ restoreFocus = true }: CloseMenuOptions = {}) => {
      setOpen((wasOpen) => {
        if (wasOpen) onOpenChangeRef.current?.(false);
        return false;
      });
      // The trigger lives outside the panel, so focus can move before the
      // panel unmounts — no deferral needed to avoid landing on <body>.
      if (restoreFocus) triggerRef.current?.focus();
    },
    [triggerRef],
  );

  const placement = useMemo<MenuPlacement>(() => ({ align, side, gap, margin }), [align, side, gap, margin]);

  const triggerProps = useMemo<MenuTriggerProps>(
    () => ({
      "aria-haspopup": "menu",
      "aria-expanded": open ? "true" : "false",
      "aria-controls": id,
      onClick: () => {
        if (open) closeMenu();
        else openMenu("first");
      },
      onKeyDown: (event) => {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          // Enter/Space would otherwise fire the click handler too, toggling twice.
          event.preventDefault();
          if (open) closeMenu();
          else openMenu("first");
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          openMenu("last");
          return;
        }
        if (event.key === "Escape" && open) {
          event.preventDefault();
          closeMenu();
        }
      },
    }),
    [closeMenu, id, open, openMenu],
  );

  return { id, open, focusIntent, placement, triggerRef, triggerProps, openMenu, closeMenu };
}
