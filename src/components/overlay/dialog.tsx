import { computed, getScope, Show, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { XMarkIcon } from "../icons";
import { read, type MaybeSignal } from "../reactive";
import { createDomId } from "../use-dom-id";

// The CMS modal (issue #159). Native `<dialog>` + `showModal()` so the browser
// puts it in the real top layer and makes the rest of the page inert.
// Everything the element gives us for free in a browser is also implemented
// here, because environments without modal `<dialog>` support — jsdom among
// them — still have to honour the same contract: focus trap, Escape, and focus
// restored to whatever opened the dialog.

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export type DialogSize = "default" | "wide" | "full";

export interface DialogProps {
  open: MaybeSignal<boolean>;
  /** Heading text. Omit only when passing a custom `header` that carries its own labelling. */
  title?: MaybeSignal<string>;
  /** Replaces the default header row entirely. */
  header?: Child;
  children: Child;
  footer?: Child;
  /** 560px by default, 920px for `wide`. `full` fills the viewport. Other sizes stay within it. */
  size?: DialogSize;
  role?: "dialog" | "alertdialog";
  /** Accessible name when there is no `title` — one of the two is required. */
  label?: string;
  /** Takes focus on open; the first focusable control otherwise. */
  initialFocusRef?: { current: HTMLElement | null };
  /** Clicking the backdrop dismisses. Off for dialogs with unsaved input. */
  dismissOnBackdrop?: MaybeSignal<boolean>;
  /** Hides the header's close button, for flows that must end on an explicit choice. */
  hideCloseButton?: boolean;
  closeLabel?: string;
  onClose: () => void;
  class?: string;
}

function focusableWithin(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => element.tabIndex !== -1);
}

function closeElement(dialog: HTMLDialogElement): void {
  if (!dialog.open) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
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
}: DialogProps): Child {
  const dialogRef: Ref<HTMLDialogElement> = { current: null };
  const titleId = `cms-dialog-title-${createDomId()}`;
  const isOpen = computed(() => read(open));

  // One opening is one activation of the panel: it captures the opener before
  // `showModal()` moves focus, and its cleanup — on `open` turning false or on
  // a real unmount, never both — closes the element first, releasing native
  // modal inertness, then hands focus back. A replacement dialog activates
  // after its predecessor's cleanup, so it inherits the original opener.
  function Panel(): Child {
    getScope().onActivate(() => {
      const dialog = dialogRef.current;
      if (!dialog) return undefined;
      const opener = document.activeElement;
      // <body> is "nothing is focused", not an opener worth restoring to.
      const trigger = opener instanceof HTMLElement && opener !== document.body ? opener : null;
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      // A preferred target that is currently disabled (a busy confirm, say)
      // would swallow the focus call and strand it outside the dialog.
      const preferred = initialFocusRef?.current;
      const usable = preferred && !(preferred as HTMLButtonElement).disabled ? preferred : null;
      (usable ?? focusableWithin(dialog)[0] ?? dialog).focus();
      return () => {
        closeElement(dialog);
        if (trigger?.isConnected) trigger.focus();
      };
    });
    return (
      <div class="cms-dialog__panel">
        {header ?? (
          <div class="cms-dialog__header">
            {title !== undefined ? <h2 id={titleId} class="cms-dialog__title">{title}</h2> : null}
            {!hideCloseButton ? (
              <button type="button" class="cms-dialog__close" aria-label={closeLabel} on:click={() => onClose()}>
                <XMarkIcon size="sm" />
              </button>
            ) : null}
          </div>
        )}
        <div class="cms-dialog__body">{children}</div>
        {footer !== undefined ? <div class="cms-dialog__footer">{footer}</div> : null}
      </div>
    );
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      // Handled here rather than left to `cancel`, so the contract holds in
      // environments where `<dialog>` has no modal behaviour of its own.
      event.preventDefault();
      event.stopPropagation();
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

  const classes = ["cms-dialog", size !== "default" ? `cms-dialog--${size}` : null, className].filter(Boolean).join(" ");

  return (
    <dialog
      ref={dialogRef}
      class={classes}
      tabindex={-1}
      role={role}
      aria-modal="true"
      aria-labelledby={title !== undefined ? titleId : undefined}
      aria-label={title === undefined ? label : undefined}
      on:keydown={handleKeyDown}
      on:cancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      on:click={(event) => {
        // A modal `<dialog>`'s backdrop is part of the element's own box, so a
        // click that lands on the element itself came from outside the panel.
        if (read(dismissOnBackdrop) && event.target === dialogRef.current) onClose();
      }}
    >
      <Show when={isOpen}>{() => <Panel />}</Show>
    </dialog>
  );
}
