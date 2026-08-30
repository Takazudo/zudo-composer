"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX, RefObject } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { TrashIcon } from "../../../components/icons";

export type SitemapLibraryDialogState =
  | { kind: "create" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "delete"; id: string; name: string };

export interface SitemapLibraryDialogProps {
  state: SitemapLibraryDialogState | null;
  busy: boolean;
  error?: string | null;
  fallbackFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
  onSubmitName: (name: string) => void | Promise<void>;
  onConfirmDelete: () => void | Promise<void>;
}

export function SitemapLibraryDialog({
  state,
  busy,
  error,
  fallbackFocusRef,
  onClose,
  onSubmitName,
  onConfirmDelete,
}: SitemapLibraryDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const errorId = useId();
  const [draftName, setDraftName] = useState("Untitled sitemap");

  useLayoutEffect(() => {
    if (state) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDraftName(state.kind === "rename" ? state.name : "Untitled sitemap");
    }
  }, [state]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (state && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      const target = state.kind === "delete" ? cancelRef.current : inputRef.current;
      target?.focus();
      if (state.kind !== "delete") inputRef.current?.select();
    } else if (!state && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      setTimeout(() => {
        const target = triggerRef.current?.isConnected ? triggerRef.current : fallbackFocusRef?.current;
        target?.focus();
      }, 0);
    }
  }, [fallbackFocusRef, state]);

  const close = (): void => {
    if (busy) return;
    onClose();
  };

  const title = state?.kind === "create"
    ? "Create sitemap"
    : state?.kind === "rename"
      ? "Rename sitemap"
      : "Delete sitemap";

  return (
    <dialog
      ref={dialogRef}
      class="sg-sitemapper-library-dialog"
      aria-modal={state ? "true" : undefined}
      aria-labelledby={state ? titleId : undefined}
      aria-describedby={state ? [descriptionId, error ? errorId : null].filter(Boolean).join(" ") : undefined}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])") ?? [])];
        if (!controls.length) return;
        const first = controls[0]!;
        const last = controls.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {state && (
        <form
          class="sg-sitemapper-library-dialog__surface"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            if (state.kind === "delete") {
              void onConfirmDelete();
              return;
            }
            const form = event.currentTarget;
            const name = new FormData(form).get("sitemap-name");
            if (typeof name !== "string" || !name.trim()) {
              inputRef.current?.setCustomValidity("Enter a sitemap name.");
              inputRef.current?.reportValidity();
              return;
            }
            inputRef.current?.setCustomValidity("");
            void onSubmitName(name.trim());
          }}
        >
          <header>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>
              {state.kind === "create" && "Name the sitemap you want to start."}
              {state.kind === "rename" && `Choose a new name for ${state.name}.`}
              {state.kind === "delete" && `Permanently delete ${state.name}? This action cannot be undone.`}
            </p>
          </header>
          {state.kind !== "delete" && (
            <label for={inputId}>
              Sitemap name
              <input
                ref={inputRef}
                id={inputId}
                name="sitemap-name"
                type="text"
                required
                disabled={busy}
                value={draftName}
                onInput={(event) => {
                  event.currentTarget.setCustomValidity("");
                  setDraftName(event.currentTarget.value);
                }}
              />
            </label>
          )}
          {error && <p id={errorId} class="sg-sitemapper-library-dialog__error" role="alert">{error}</p>}
          <div class="sg-sitemapper-library-dialog__actions">
            <button ref={cancelRef} type="button" disabled={busy} onClick={close}>Cancel</button>
            <button
              type="submit"
              disabled={busy}
              class={state.kind === "delete" ? "sg-sitemapper-library-button sg-sitemapper-library-button--danger" : "sg-sitemapper-library-button sg-sitemapper-library-button--primary"}
            >
              {state.kind === "delete" && <TrashIcon size="sm" />}
              {busy ? "Working…" : state.kind === "create" ? "Create sitemap" : state.kind === "rename" ? "Save name" : "Delete sitemap"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export default SitemapLibraryDialog;
