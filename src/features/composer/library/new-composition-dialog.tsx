/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ReuseCatalogEntry } from "../../../composer/browser";
import {
  ToolDialogResizeHandle,
  toolDialogStyle,
  useToolDialogGeometry,
} from "../ui/shared/tool-dialog-geometry";
import type {
  CompositionLibraryCreateIntent,
  CompositionLibraryIntents,
} from "./library-contract";

export type NewCompositionDialogSubmitResult =
  | { status: "created" }
  | { status: "create-error"; message: string }
  | { status: "navigation-error"; message: string };

export interface NewCompositionDialogProps {
  open: boolean;
  providerId: CompositionLibraryCreateIntent["providerId"] | null;
  intents: Pick<CompositionLibraryIntents, "listTemplates">;
  onSubmit(intent: CompositionLibraryCreateIntent): Promise<NewCompositionDialogSubmitResult>;
  onRetryNavigation(): Promise<NewCompositionDialogSubmitResult>;
  onClose(): void;
}

type CatalogState =
  | { status: "loading"; entries: readonly ReuseCatalogEntry[] }
  | { status: "listed"; entries: readonly ReuseCatalogEntry[] }
  | { status: "error"; entries: readonly ReuseCatalogEntry[]; message: string };

type SubmissionState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "create-error"; message: string }
  | { status: "navigation-error"; message: string };

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

function sameSource(a: ReuseCatalogEntry | null, b: ReuseCatalogEntry): boolean {
  return a?.ref.providerId === b.ref.providerId && a.ref.recordId === b.ref.recordId && a.outlet?.id === b.outlet?.id;
}

function submissionMessage(result: Exclude<NewCompositionDialogSubmitResult, { status: "created" }>): string {
  return result.message || "The composition could not be created.";
}

/**
 * One native, focus-contained modal for ordinary and Global-template-bound
 * creations. It owns only transient form state; persistence and routing stay
 * behind the library intent adapter.
 */
export function NewCompositionDialog({
  open,
  providerId,
  intents,
  onSubmit,
  onRetryNavigation,
  onClose,
}: NewCompositionDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);
  const submissionInFlightRef = useRef(false);
  const titleId = useId();
  const geometry = useToolDialogGeometry({ open });
  const [name, setName] = useState("Untitled composition");
  const [query, setQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState<ReuseCatalogEntry | null>(null);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading", entries: [] });
  const [submission, setSubmission] = useState<SubmissionState>({ status: "idle" });

  const templateEntries = useMemo(
    () => catalog.entries.filter((entry) => entry.kind === "global-template" && entry.outlet !== undefined),
    [catalog.entries],
  );
  const filteredTemplates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return templateEntries;
    return templateEntries.filter((entry) =>
      `${entry.summary.name} ${entry.outlet?.label ?? ""} ${entry.summary.updatedAt}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query, templateEntries]);
  const busy = submission.status === "busy";
  const retryingNavigation = submission.status === "navigation-error";
  const formLocked = busy || retryingNavigation;

  async function loadTemplates(): Promise<void> {
    if (!providerId) return;
    const request = ++requestRef.current;
    setCatalog((current) => ({ status: "loading", entries: current.entries }));
    try {
      const outcome = await intents.listTemplates(providerId);
      if (request !== requestRef.current) return;
      if (outcome.status === "listed") {
        setCatalog({ status: "listed", entries: outcome.entries });
      } else {
        setCatalog({ status: "error", entries: [], message: outcome.message });
      }
    } catch (reason) {
      if (request !== requestRef.current) return;
      setCatalog({
        status: "error",
        entries: [],
        message: reason instanceof Error ? reason.message : "Global templates could not be loaded.",
      });
    }
  }

  useEffect(() => {
    if (!open) {
      requestRef.current += 1;
      return;
    }
    setName("Untitled composition");
    setQuery("");
    setSelectedSource(null);
    setSubmission({ status: "idle" });
    submissionInFlightRef.current = false;
    void loadTemplates();
    // `open` is the fresh-session boundary. Provider changes cannot happen
    // behind the modal, but including it makes a controlled re-open safe.
  }, [open, providerId]);

  useEffect(() => {
    if (!selectedSource) return;
    if (!templateEntries.some((entry) => sameSource(selectedSource, entry))) {
      setSelectedSource(null);
    }
  }, [selectedSource, templateEntries]);

  // Capture before `showModal()` moves browser focus into the dialog.
  useLayoutEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [open]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useLayoutEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      const trigger = triggerRef.current;
      onClose();
      // The controlled parent removes the interactive form on close. Restore
      // focus after that render; otherwise removing the currently focused
      // field can leave focus on <body> in lightweight DOMs and browsers.
      setTimeout(() => trigger?.focus(), 0);
      triggerRef.current = null;
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  function close(): void {
    if (!busy) dialogRef.current?.close();
  }

  function handleKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDialogElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(): Promise<void> {
    if (!providerId || formLocked || submissionInFlightRef.current) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmission({ status: "create-error", message: "Give the composition a name before creating it." });
      nameRef.current?.focus();
      return;
    }
    submissionInFlightRef.current = true;
    setSubmission({ status: "busy" });
    try {
      const result = await onSubmit({
        providerId,
        name: trimmedName,
        ...(selectedSource
          ? { source: { sourceRecordId: selectedSource.ref.recordId, outletId: selectedSource.outlet!.id } }
          : {}),
      });
      if (result.status === "created") {
        dialogRef.current?.close();
        return;
      }
      setSubmission({ status: result.status, message: submissionMessage(result) });
    } catch (reason) {
      setSubmission({
        status: "create-error",
        message: reason instanceof Error ? reason.message : "The composition could not be created.",
      });
    } finally {
      submissionInFlightRef.current = false;
    }
  }

  async function retry(): Promise<void> {
    if (busy || submissionInFlightRef.current) return;
    if (submission.status !== "navigation-error") {
      await submit();
      return;
    }
    submissionInFlightRef.current = true;
    setSubmission({ status: "busy" });
    try {
      const result = await onRetryNavigation();
      if (result.status === "created") {
        dialogRef.current?.close();
        return;
      }
      setSubmission({ status: result.status, message: submissionMessage(result) });
    } catch (reason) {
      setSubmission({
        status: "navigation-error",
        message: reason instanceof Error ? reason.message : "Opening the new composition failed.",
      });
    } finally {
      submissionInFlightRef.current = false;
    }
  }

  return (
    <dialog
      ref={dialogRef}
      class="sg-composer-tool-dialog m-0 overflow-hidden rounded-none border-0 bg-surface p-0 text-fg backdrop:bg-overlay/45"
      aria-modal={open ? "true" : undefined}
      aria-labelledby={open ? titleId : undefined}
      style={toolDialogStyle(geometry.rect)}
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
    >
      {open && providerId && (
        <div class="flex h-full min-h-0 flex-col overflow-hidden">
          <header class="flex flex-none items-center justify-between gap-hsp-sm border-b border-border px-hsp-lg py-vsp-xs">
            <div class="min-w-0">
              <h2 id={titleId} class="m-0 text-body font-semibold">New composition</h2>
              <p class="m-0 text-small text-muted">Create an empty composition or bind its outlet to a Global template.</p>
            </div>
            <button type="button" class="sg-composer-library-button" disabled={busy} onClick={close}>
              Cancel
            </button>
          </header>

          <form
            class="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div class="min-h-0 flex-1 overflow-y-auto px-hsp-lg py-vsp-md">
              <label class="flex flex-col gap-vsp-3xs text-small font-semibold text-fg">
                <span>Name</span>
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  disabled={formLocked}
                  onInput={(event) => setName(event.currentTarget.value)}
                  class="min-h-11 rounded-md border border-border-strong bg-bg px-hsp-sm text-body text-fg"
                />
              </label>

              {submission.status !== "idle" && submission.status !== "busy" && (
                <section class="mt-vsp-sm border border-danger bg-danger/10 px-hsp-sm py-vsp-xs text-small" role="alert">
                  <p class="m-0">{submission.message}</p>
                  <div class="mt-vsp-xs flex flex-wrap gap-hsp-sm">
                    <button type="button" class="sg-composer-library-button" onClick={() => void retry()}>
                      Retry
                    </button>
                  </div>
                </section>
              )}

              <section class="mt-vsp-md flex min-h-0 flex-col" aria-labelledby={`${titleId}-template-title`}>
                <div class="flex flex-wrap items-end justify-between gap-hsp-sm">
                  <div>
                    <h3 id={`${titleId}-template-title`} class="m-0 text-small font-semibold">Global template</h3>
                    <p class="m-0 text-small text-muted">The new record remains empty; only the chosen source and outlet are stored.</p>
                  </div>
                  <label class="flex min-w-48 flex-1 flex-col gap-vsp-3xs text-small text-muted">
                    <span class="sr-only">Search Global templates</span>
                    <input
                      type="search"
                      placeholder="Search templates…"
                      value={query}
                      disabled={formLocked || catalog.status !== "listed"}
                      onInput={(event) => setQuery(event.currentTarget.value)}
                      class="min-h-11 rounded-md border border-border-strong bg-bg px-hsp-sm text-body text-fg"
                    />
                  </label>
                </div>

                {catalog.status === "loading" ? (
                  <div class="mt-vsp-sm flex min-h-48 flex-1 items-center justify-center border border-border bg-surface-2 p-hsp-md text-center text-small text-muted" role="status">
                    Loading Global templates…
                  </div>
                ) : catalog.status === "error" ? (
                  <div class="mt-vsp-sm flex min-h-48 flex-1 flex-col items-center justify-center gap-vsp-sm border border-danger bg-danger/10 p-hsp-md text-center text-small" role="alert">
                    <p class="m-0">{catalog.message}</p>
                    <button type="button" class="sg-composer-library-button" disabled={formLocked} onClick={() => void loadTemplates()}>
                      Retry templates
                    </button>
                  </div>
                ) : (
                  <div class="mt-vsp-sm grid min-h-48 flex-1 grid-cols-1 overflow-hidden border border-border md:grid-cols-[minmax(0,3fr)_minmax(12rem,2fr)]">
                    <div class="min-h-0 overflow-y-auto">
                      <button
                        type="button"
                        class={`flex w-full flex-col gap-vsp-3xs border-b border-border px-hsp-sm py-vsp-xs text-left ${selectedSource === null ? "bg-accent/10" : "bg-transparent"}`}
                        aria-pressed={selectedSource === null}
                        disabled={formLocked}
                        onClick={() => setSelectedSource(null)}
                      >
                        <span class="font-semibold">None</span>
                        <span class="text-small text-muted">Create an ordinary, unbound empty composition.</span>
                      </button>
                      {templateEntries.length === 0 ? (
                        <p class="m-0 p-hsp-sm text-small text-muted">No eligible Global templates are available from this provider.</p>
                      ) : filteredTemplates.length === 0 ? (
                        <div class="p-hsp-sm text-small text-muted">
                          <p class="m-0">No Global templates match this search.</p>
                          <button type="button" class="mt-vsp-xs sg-composer-library-button" onClick={() => setQuery("")}>Clear search</button>
                        </div>
                      ) : (
                        <ul class="m-0 list-none p-0">
                          {filteredTemplates.map((entry) => (
                            <li key={`${entry.ref.providerId}:${entry.ref.recordId}:${entry.outlet!.id}`}>
                              <button
                                type="button"
                                class={`flex w-full flex-col gap-vsp-3xs border-b border-border px-hsp-sm py-vsp-xs text-left ${sameSource(selectedSource, entry) ? "bg-accent/10" : "bg-transparent"}`}
                                aria-pressed={sameSource(selectedSource, entry)}
                                disabled={formLocked}
                                onClick={() => setSelectedSource(entry)}
                              >
                                <span class="font-semibold">{entry.summary.name}</span>
                                <span class="text-small text-muted">Outlet: {entry.outlet!.label || entry.outlet!.id} · Updated {formatTimestamp(entry.summary.updatedAt)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <aside class="border-t border-border bg-surface-2 p-hsp-sm text-small md:border-l md:border-t-0" aria-label="Template choice details">
                      {selectedSource ? (
                        <>
                          <p class="m-0 font-semibold">{selectedSource.summary.name}</p>
                          <dl class="mt-vsp-xs grid grid-cols-[auto_1fr] gap-x-hsp-sm gap-y-vsp-3xs text-muted">
                            <dt>Outlet</dt><dd class="m-0">{selectedSource.outlet!.label || selectedSource.outlet!.id}</dd>
                            <dt>Updated</dt><dd class="m-0">{formatTimestamp(selectedSource.summary.updatedAt)}</dd>
                            <dt>Source ID</dt><dd class="m-0 break-all font-mono text-xs">{selectedSource.ref.recordId}</dd>
                          </dl>
                        </>
                      ) : (
                        <p class="m-0 text-muted">No template selected. The composition will have an unrestricted empty root.</p>
                      )}
                    </aside>
                  </div>
                )}
              </section>
            </div>

            <footer class="relative flex flex-none flex-wrap items-center justify-between gap-hsp-sm border-t border-border px-hsp-lg py-vsp-xs pr-[3.5rem]">
              <p class="m-0 text-small text-muted" role="status">
                {busy ? "Saving composition…" : selectedSource ? `Binding to ${selectedSource.summary.name}.` : "Creating an ordinary composition."}
              </p>
              <button type="submit" class="sg-composer-library-button sg-composer-library-button-primary" disabled={formLocked}>
                {busy ? "Creating…" : "Create composition"}
              </button>
              <ToolDialogResizeHandle geometry={geometry} class="absolute bottom-0 right-0 min-h-11 min-w-11" />
            </footer>
          </form>
        </div>
      )}
    </dialog>
  );
}
