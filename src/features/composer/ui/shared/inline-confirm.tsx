/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Generic inline confirm bar: a message plus Cancel/Confirm pair shared by tree,
// menu, and library destructive actions. Initial focus always lands on Cancel —
// the safe action — and Escape cancels.
//
// Reuses `SubtreeRemovalConfirm`'s original `.sg-composer-tree-confirm*`
// classes for compact call sites rather than adding a parallel style block.
//
// `tone="toolbar"` serves full-size library action rows; compact tree/menu call
// sites keep the default tree class family.

import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";
import { TrashIcon, XMarkIcon } from "../../../../components/icons";

export interface InlineConfirmProps {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Accessible name for the `role="group"` wrapper. */
  ariaLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** Which class family to render with. Defaults to the original tree styling. */
  tone?: "tree" | "toolbar";
}

const TONE_CLASSES: Record<"tree" | "toolbar", { root: string; text: string; cancel: string; confirm: string }> = {
  tree: {
    root: "sg-composer-tree-confirm",
    text: "sg-composer-tree-confirm-text",
    cancel: "sg-composer-tree-action",
    confirm: "sg-composer-tree-action sg-composer-tree-action-danger",
  },
  toolbar: {
    root: "sg-composer-toolbar-confirm",
    text: "sg-composer-toolbar-confirm-text",
    cancel: "sg-composer-toolbar-button",
    confirm: "sg-composer-toolbar-button sg-composer-toolbar-confirm-danger",
  },
};

export function InlineConfirm({
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  ariaLabel,
  onCancel,
  onConfirm,
  tone = "tree",
}: InlineConfirmProps): JSX.Element {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const classes = TONE_CLASSES[tone];

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  return (
    <div class={classes.root} role="group" aria-label={ariaLabel}>
      <span class={classes.text}>{message}</span>
      <button
        ref={cancelButtonRef}
        type="button"
        class={classes.cancel}
        onClick={onCancel}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      >
        <XMarkIcon size="sm" class="sg-composer-button-icon" />
        {cancelLabel}
      </button>
      <button
        type="button"
        class={classes.confirm}
        onClick={onConfirm}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      >
        <TrashIcon size="sm" class="sg-composer-button-icon" />
        {confirmLabel}
      </button>
    </div>
  );
}
