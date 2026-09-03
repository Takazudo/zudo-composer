import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { Dialog } from "./dialog";

// The confirmation shape behind delete / clear / start-fresh (issue #159):
// one question, one destructive answer, one way out.

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ComponentChildren;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` styles the confirm button as destructive and opens on Cancel. */
  tone?: "default" | "danger";
  /** Overrides the tone's default landing spot. */
  initialFocus?: "confirm" | "cancel";
  /** Keeps the dialog up and the buttons inert while the action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  initialFocus,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps): JSX.Element {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  // A destructive answer is never the one a stray Enter should land on.
  const landing = initialFocus ?? (tone === "danger" ? "cancel" : "confirm");

  return (
    <Dialog
      open={open}
      title={title}
      role="alertdialog"
      class="cms-dialog--confirm"
      initialFocusRef={landing === "cancel" ? cancelRef : confirmRef}
      dismissOnBackdrop={!busy}
      hideCloseButton
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <button type="button" ref={cancelRef} class="cms-dialog__action" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            class={`cms-dialog__action cms-dialog__action--${tone === "danger" ? "danger" : "primary"}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">{message}</p>
    </Dialog>
  );
}
