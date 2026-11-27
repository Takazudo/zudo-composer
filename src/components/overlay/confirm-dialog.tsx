import { computed, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../reactive";
import { liveSlot, type LiveChild } from "../rebuild";
import { Dialog } from "./dialog";

// The confirmation shape behind delete / clear / start-fresh (issue #159):
// one question, one destructive answer, one way out.

export interface ConfirmDialogProps {
  open: MaybeSignal<boolean>;
  title: MaybeSignal<string>;
  message: LiveChild;
  confirmLabel?: MaybeSignal<string | undefined>;
  cancelLabel?: MaybeSignal<string | undefined>;
  /** `danger` styles the confirm button as destructive and opens on Cancel. Read again on every open. */
  tone?: MaybeSignal<"default" | "danger" | undefined>;
  /** Overrides the tone's default landing spot. */
  initialFocus?: "confirm" | "cancel";
  /** Keeps the dialog up and the buttons inert while the action runs. */
  busy?: MaybeSignal<boolean>;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone,
  initialFocus,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps): Child {
  const confirmRef: Ref<HTMLButtonElement> = { current: null };
  const cancelRef: Ref<HTMLButtonElement> = { current: null };
  const danger = computed(() => read(tone) === "danger");
  // A destructive answer is never the one a stray Enter should land on. The
  // landing ref resolves when the dialog opens, so a tone that follows the
  // question being asked still picks the right button.
  const landingRef = {
    get current(): HTMLElement | null {
      const landing = initialFocus ?? (danger.value ? "cancel" : "confirm");
      return (landing === "cancel" ? cancelRef : confirmRef).current;
    },
  };
  const isBusy = computed(() => read(busy));

  return (
    <Dialog
      open={open}
      title={title}
      role="alertdialog"
      class="cms-dialog--confirm"
      initialFocusRef={landingRef}
      dismissOnBackdrop={computed(() => !isBusy.value)}
      hideCloseButton
      onClose={() => {
        if (!isBusy.value) onClose();
      }}
      footer={
        <>
          <button type="button" ref={cancelRef} class="cms-dialog__action" disabled={isBusy} on:click={() => onClose()}>
            {computed(() => read(cancelLabel) ?? "Cancel")}
          </button>
          <button
            type="button"
            ref={confirmRef}
            class={computed(() => `cms-dialog__action cms-dialog__action--${danger.value ? "danger" : "primary"}`)}
            disabled={isBusy}
            on:click={() => onConfirm()}
          >
            {computed(() => read(confirmLabel) ?? "Confirm")}
          </button>
        </>
      }
    >
      <p class="cms-dialog__message">{liveSlot(message)}</p>
    </Dialog>
  );
}
