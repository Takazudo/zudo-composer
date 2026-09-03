import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { ConfirmDialogProps } from "../overlay";

// One confirmation queue per library route (issue #164).
//
// Every destructive answer in the pattern — a row's `Delete…`, a bulk delete,
// `Start fresh…` on the recovery banner — asks the same question in the same
// shared `ConfirmDialog`. Routes hold ONE dialog and describe each question at
// the call site rather than keeping a boolean per action.

export interface LibraryConfirmRequest {
  readonly title: string;
  readonly message: ComponentChildren;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: "default" | "danger";
  /**
   * Runs on confirm; the dialog closes either way. Kept synchronous on
   * purpose — an action that needs a spinner and a failure path drives
   * `ConfirmDialog` directly, where `busy` lives.
   */
  readonly onConfirm: () => void;
}

export interface LibraryConfirmController {
  request: (request: LibraryConfirmRequest) => void;
  readonly pending: LibraryConfirmRequest | null;
  /** Spread onto the route's single `<ConfirmDialog />`. */
  readonly dialogProps: ConfirmDialogProps;
}

export function useLibraryConfirm(): LibraryConfirmController {
  const [pending, setPending] = useState<LibraryConfirmRequest | null>(null);

  return {
    request: setPending,
    pending,
    dialogProps: {
      open: pending !== null,
      title: pending?.title ?? "",
      message: pending?.message ?? null,
      confirmLabel: pending?.confirmLabel,
      cancelLabel: pending?.cancelLabel,
      tone: pending?.tone,
      onConfirm: () => {
        pending?.onConfirm();
        setPending(null);
      },
      onClose: () => setPending(null),
    },
  };
}
