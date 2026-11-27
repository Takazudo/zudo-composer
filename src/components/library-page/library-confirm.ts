import { computed, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { ConfirmDialogProps } from "../overlay";

// One confirmation queue per library route (issue #164).
//
// Every destructive answer in the pattern — a row's `Delete…`, a bulk delete,
// `Start fresh…` on the recovery banner — asks the same question in the same
// shared `ConfirmDialog`. Routes hold ONE dialog and describe each question at
// the call site rather than keeping a boolean per action.

export interface LibraryConfirmRequest {
  readonly title: string;
  readonly message: Child;
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
  readonly pending: ReadonlySignal<LibraryConfirmRequest | null>;
  /** Spread onto the route's single `<ConfirmDialog />`; every field follows `pending`. */
  readonly dialogProps: ConfirmDialogProps;
}

export function createLibraryConfirm(): LibraryConfirmController {
  const pending = signal<LibraryConfirmRequest | null>(null);

  return {
    request: (request) => {
      pending.value = request;
    },
    pending,
    dialogProps: {
      open: computed(() => pending.value !== null),
      title: computed(() => pending.value?.title ?? ""),
      message: computed(() => pending.value?.message ?? null),
      confirmLabel: computed(() => pending.value?.confirmLabel),
      cancelLabel: computed(() => pending.value?.cancelLabel),
      tone: computed(() => pending.value?.tone),
      onConfirm: () => {
        pending.value?.onConfirm();
        pending.value = null;
      },
      onClose: () => {
        pending.value = null;
      },
    },
  };
}
