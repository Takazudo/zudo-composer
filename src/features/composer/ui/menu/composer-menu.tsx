/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer's host-side context menu (issue Takazudo/zudo-sg#256) — one labelled,
// keyboard-operable, positioned popover reused for BOTH the node menu
// (Copy/Cut/Duplicate/Delete) and the insert menu (Add component…/Paste
// here), and for the Delete confirmation sub-view (which swaps `items` for
// `children` — see `use-composer-menus.ts`).
//
// Deliberately NOT a native `<dialog>` (unlike Takazudo/zudo-sg#250's `ComposerChooser`): a
// context menu is lightweight, positioned freely next to its trigger, and
// must re-clamp on resize — `showModal()`'s top-layer + centered defaults
// fight that. Instead this is a `position: fixed` panel, layered via the
// semantic z-index token system (`--z-index-popover` — the reserved "inline
// popovers" tier, now adopted; see `src/config/z-index-tokens.ts`).
//
// Fully controlled: `open`/`anchor` drive visibility/position, and selecting
// an item does NOT auto-close — the caller decides (some actions, like
// "Add component…", must skip the normal focus-restore and instead re-focus
// a different control before opening the chooser; see `use-composer-menus.ts`).

import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import type { IconComponent } from "../../../../components/icons";
import { clampMenuPosition, type MenuPoint } from "./menu-position";

export interface ComposerMenuItemSpec {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Danger-styled (issue Takazudo/zudo-sg#256: Delete). */
  danger?: boolean;
  /** Optional leading glyph (issue Takazudo/zudo-sg#282) — `aria-hidden` internally, purely decorative. */
  icon?: IconComponent;
}

export interface ComposerMenuProps {
  open: boolean;
  /** Accessible name for the menu region. */
  label: string;
  /** Un-clamped anchor point (viewport coordinates) — see `anchorBelowRect`. */
  anchor: MenuPoint | null;
  /** Fired on Escape, outside click, scroll, resize — the caller decides what "closed" means. */
  onClose: () => void;
  /** The item list — renders `role="menu"` with roving-focus keyboard nav. */
  items?: readonly ComposerMenuItemSpec[];
  /** Custom content instead of `items` (e.g. the subtree-removal confirmation). Renders `role="group"`. */
  children?: ComponentChildren;
}

const VIEWPORT_MARGIN = 8;

function menuItemSelector(): string {
  return '[role="menuitem"]:not(:disabled)';
}

export function ComposerMenu({ open, label, anchor, onClose, items, children }: ComposerMenuProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Position + clamp to the viewport. Deliberately has NO dependency array —
  // it re-measures on EVERY render, not just when `anchor` changes, because
  // the panel's own size can change too (e.g. Delete swapping `items` for the
  // wider/taller removal-confirmation `children`), and a stale clamp would
  // leave it hanging off the edge it just grew past. useLayoutEffect so the
  // panel never visibly flashes at its un-clamped spot.
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const clamped = clampMenuPosition({
      x: anchor.x,
      y: anchor.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      margin: VIEWPORT_MARGIN,
    });
    panel.style.left = `${clamped.x}px`;
    panel.style.top = `${clamped.y}px`;
  });

  // Escape / outside click / scroll / resize all dismiss. Registered in an
  // effect (not during render), so the SAME click that opened the menu can
  // never also close it — by the time this listener attaches, that click's
  // own dispatch has already finished (see the module's design note above).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    function onOutsideClick(event: MouseEvent): void {
      const panel = panelRef.current;
      if (panel && !panel.contains(event.target as Node)) onClose();
    }
    function onDismiss(): void {
      onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("click", onOutsideClick, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("click", onOutsideClick, true);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [open, onClose]);

  // Auto-focus the first enabled item (or the first focusable thing in a
  // custom `children` view) whenever the menu opens or its content changes
  // shape (e.g. Delete swapping items for the removal confirmation).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(items ? menuItemSelector() : "button, [tabindex]");
    first?.focus();
  }, [open, items, children]);

  function onKeyDownRoving(event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
    if (!items) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLButtonElement>(menuItemSelector())];
    if (focusable.length === 0) return;
    const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % focusable.length;
    else if (event.key === "ArrowUp")
      nextIndex = currentIndex < 0 ? focusable.length - 1 : (currentIndex - 1 + focusable.length) % focusable.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = focusable.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    focusable[nextIndex]!.focus();
  }

  if (!open || !anchor) return null;

  return (
    <div
      ref={panelRef}
      class="sg-composer-menu"
      role={items ? "menu" : "group"}
      aria-label={label}
      style={{ position: "fixed", left: `${anchor.x}px`, top: `${anchor.y}px` }}
      onKeyDown={items ? onKeyDownRoving : undefined}
    >
      {items
        ? items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              class={`sg-composer-menu-item${item.danger ? " sg-composer-menu-item-danger" : ""}`}
              disabled={item.disabled}
              onClick={() => item.onSelect()}
            >
              {item.icon && <item.icon size="sm" class="sg-composer-menu-item-icon" />}
              {item.label}
            </button>
          ))
        : children}
    </div>
  );
}
