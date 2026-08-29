/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Generic inline confirm bar: a message plus Cancel/Confirm pair, extracted
// from #250's tree-row `SubtreeRemovalConfirm` (issue #269, folding in #260)
// so any destructive action in the composer can reuse the SAME confirm
// mechanism instead of inventing a second one. Initial focus always lands on
// Cancel — the SAFE action — unifying every entry point that renders this
// (tree row inline, node context-menu Delete, toolbar Reset); Escape cancels.
//
// Reuses `SubtreeRemovalConfirm`'s original `.sg-composer-tree-confirm*`
// classes verbatim (same precedent as the context menu's Delete confirmation
// in styles.css) rather than adding a parallel style block — visual polish
// for non-tree call sites lands in a later wave.
//
// `tone` (issue #267) is the one exception: the toolbar's Reset confirm
// (composer-toolbar-bar.tsx) sits inline in a row of full-size toolbar
// controls, not a compact tree row, so it opts into the
// `.sg-composer-toolbar-confirm*` classes instead of the tree's. The tree/menu
// call sites are unaffected (they don't pass `tone`, so they keep the default).

import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";

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
        {confirmLabel}
      </button>
    </div>
  );
}
