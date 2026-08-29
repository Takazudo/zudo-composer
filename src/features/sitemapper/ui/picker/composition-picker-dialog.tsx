/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type {
  CatalogEntry,
  CompositionCatalogListOutcome,
} from "../../../../sitemapper/catalog";
import type { CompositionRef } from "../../../../sitemapper/model";

export interface CompositionPickerDialogProps {
  open: boolean;
  currentRef?: CompositionRef;
  listCompositions: () => Promise<CompositionCatalogListOutcome>;
  onSelect: (ref: CompositionRef) => void;
  onClose: () => void;
}

type PickerState =
  | { status: "loading"; outcome: CompositionCatalogListOutcome }
  | { status: "ready"; outcome: CompositionCatalogListOutcome }
  | { status: "error"; outcome: CompositionCatalogListOutcome; reason: string };

const EMPTY_OUTCOME: CompositionCatalogListOutcome = { entries: [], failures: [] };

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.valueOf())) return updatedAt;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function isCurrent(entry: CatalogEntry, currentRef?: CompositionRef): boolean {
  return currentRef?.providerId === entry.ref.providerId && currentRef.recordId === entry.ref.recordId;
}

export function CompositionPickerDialog({
  open,
  currentRef,
  listCompositions,
  onSelect,
  onClose,
}: CompositionPickerDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);
  const titleId = useId();
  const [state, setState] = useState<PickerState>({ status: "loading", outcome: EMPTY_OUTCOME });

  async function load(): Promise<void> {
    const request = ++requestRef.current;
    setState((current) => ({ status: "loading", outcome: current.outcome }));
    try {
      const outcome = await listCompositions();
      if (request === requestRef.current) setState({ status: "ready", outcome });
    } catch (reason) {
      if (request !== requestRef.current) return;
      setState({
        status: "error",
        outcome: EMPTY_OUTCOME,
        reason: reason instanceof Error ? reason.message : "The composition catalog could not be loaded.",
      });
    }
  }

  useLayoutEffect(() => {
    if (open) triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  useEffect(() => {
    if (!open) {
      requestRef.current += 1;
      return;
    }
    void load();
    // Opening starts a fresh catalog request. Callback identity changes while
    // open must not continuously reload a controlled dialog.
  }, [open]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  function close(): void {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.close === "function") dialog.close();
    else dialog?.removeAttribute("open");
    onClose();
    const trigger = triggerRef.current;
    triggerRef.current = null;
    setTimeout(() => trigger?.focus(), 0);
  }

  const { entries, failures } = state.outcome;

  return (
    <dialog
      ref={dialogRef}
      class="sg-sitemapper-picker"
      aria-modal={open ? "true" : undefined}
      aria-labelledby={open ? titleId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      {open && (
        <div class="sg-sitemapper-picker__surface">
          <header class="sg-sitemapper-picker__header">
            <div>
              <h2 id={titleId}>Choose a composition</h2>
              <p>Assign a saved Composer composition to this page.</p>
            </div>
            <button type="button" class="sg-sitemapper-picker__button" onClick={close}>Close</button>
          </header>

          {failures.length > 0 && (
            <div class="sg-sitemapper-picker__notices" aria-label="Provider notices">
              {failures.map((failure) => (
                <p key={failure.providerId} role="status">
                  <strong>{failure.providerLabel}</strong> could not be loaded: {failure.reason}
                </p>
              ))}
            </div>
          )}

          {state.status === "error" && (
            <div class="sg-sitemapper-picker__notices" role="alert">
              <p>{state.reason}</p>
              <button type="button" class="sg-sitemapper-picker__button" onClick={() => void load()}>Retry</button>
            </div>
          )}

          {state.status === "loading" && entries.length === 0 && <p role="status">Loading compositions…</p>}
          {state.status === "ready" && entries.length === 0 && failures.length === 0 && (
            <p class="sg-sitemapper-picker__empty">No saved compositions are available.</p>
          )}

          {entries.length > 0 && (
            <ul class="sg-sitemapper-picker__list" aria-label="Saved compositions">
              {entries.map((entry) => {
                const current = isCurrent(entry, currentRef);
                const action = current ? "Assigned" : currentRef ? "Replace" : "Assign";
                return (
                  <li key={`${entry.ref.providerId}:${entry.ref.recordId}`}>
                    <div class="sg-sitemapper-picker__entry">
                      <strong>{entry.name}</strong>
                      <span>{entry.providerLabel}</span>
                      <span>
                        Updated <time dateTime={entry.updatedAt}>{formatUpdatedAt(entry.updatedAt)}</time>
                        {" · "}{entry.nodeCount} {entry.nodeCount === 1 ? "node" : "nodes"}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="sg-sitemapper-picker__button sg-sitemapper-picker__button--primary"
                      disabled={current}
                      aria-label={`${action} ${entry.name} from ${entry.providerLabel}`}
                      onClick={() => {
                        onSelect(entry.ref);
                        close();
                      }}
                    >
                      {action}
                      <span class="sg-sitemapper-sr-only"> {entry.name} from {entry.providerLabel}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </dialog>
  );
}

export default CompositionPickerDialog;
