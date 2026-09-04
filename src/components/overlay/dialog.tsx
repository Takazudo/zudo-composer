import type { ComponentChildren, JSX } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";
import { XMarkIcon } from "../icons";

// The CMS modal (issue #159). Native `<dialog>` + `showModal()` so the browser
// puts it in the real top layer and makes the rest of the page inert.
// Everything the element gives us for free in a browser is also implemented
// here, because environments without modal `<dialog>` support — jsdom among
// them — still have to honour the same contract: focus trap, Escape, and focus
// restored to whatever opened the dialog.

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export type DialogSize = "default" | "wide";

export interface DialogProps {
  open: boolean;
  /** Heading text. Omit only when passing a custom `header` that carries its own labelling. */
  title?: string;
  /** Replaces the default header row entirely. */
  header?: ComponentChildren;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /** 560px by default, 920px for `wide`. Both stay inside the viewport on narrow screens. */
  size?: DialogSize;
  role?: "dialog" | "alertdialog";
  /** Accessible name when there is no `title` — one of the two is required. */
  label?: string;
  /** Takes focus on open; the first focusable control otherwise. */
  initialFocusRef?: { current: HTMLElement | null };
  /** Clicking the backdrop dismisses. Off for dialogs with unsaved input. */
  dismissOnBackdrop?: boolean;
  /** Hides the header's close button, for flows that must end on an explicit choice. */
  hideCloseButton?: boolean;
  closeLabel?: string;
  onClose: () => void;
  class?: string;
}

function focusableWithin(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => element.tabIndex !== -1);
}

export function Dialog({
  open,
  title,
  header,
  children,
  footer,
  size = "default",
  role = "dialog",
  label,
  initialFocusRef,
  dismissOnBackdrop = true,
  hideCloseButton = false,
  closeLabel = "Close",
  onClose,
  class: className,
}: DialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = `cms-dialog-title-${useId()}`;

  // Open/close the element, and bracket it with focus bookkeeping: capture the
  // opener before `showModal()` moves focus, restore it after the body has
  // been removed from the DOM (a synchronous restore before that would be
  // taken back by the removal and leave focus on <body>).
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      const opener = document.activeElement;
      // <body> is "nothing is focused", not an opener worth restoring to.
      triggerRef.current = opener instanceof HTMLElement && opener !== document.body ? opener : null;
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      // A preferred target that is currently disabled (a busy confirm, say)
      // would swallow the focus call and strand it outside the dialog.
      const preferred = initialFocusRef?.current;
      const usable = preferred && !(preferred as HTMLButtonElement).disabled ? preferred : null;
      (usable ?? focusableWithin(dialog)[0] ?? dialog).focus();
      return;
    }
    if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    const trigger = triggerRef.current;
    triggerRef.current = null;
    trigger?.focus();
    // Deliberately keyed on `open` alone: this runs once per opening, and
    // re-running it would steal focus back from wherever the user moved it.
  }, [open]);

  function handleKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDialogElement>): void {
    if (event.key === "Escape") {
      // Handled here rather than left to `cancel`, so the contract holds in
      // environments where `<dialog>` has no modal behaviour of its own.
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = focusableWithin(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const classes = ["cms-dialog", size === "wide" ? "cms-dialog--wide" : null, className].filter(Boolean).join(" ");

  return (
    <dialog
      ref={dialogRef}
      class={classes}
      tabIndex={-1}
      role={role}
      aria-modal="true"
      aria-labelledby={title !== undefined ? titleId : undefined}
      aria-label={title === undefined ? label : undefined}
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A modal `<dialog>`'s backdrop is part of the element's own box, so a
        // click that lands on the element itself came from outside the panel.
        if (dismissOnBackdrop && event.target === dialogRef.current) onClose();
      }}
    >
      {open && (
        <div class="cms-dialog__panel">
          {header ?? (
            <div class="cms-dialog__header">
              {title !== undefined && <h2 id={titleId} class="cms-dialog__title">{title}</h2>}
              {!hideCloseButton && (
                <button type="button" class="cms-dialog__close" aria-label={closeLabel} onClick={onClose}>
                  <XMarkIcon size="sm" />
                </button>
              )}
            </div>
          )}
          <div class="cms-dialog__body">{children}</div>
          {footer !== undefined && <div class="cms-dialog__footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
