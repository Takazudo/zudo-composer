/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer JSX export/preview dialog (issue Takazudo/zudo-sg#249). Presentational only:
// renders exactly the `JsxGenerationResult` Takazudo/zudo-sg#245's `generateJsx` produced —
// no local copy of `code`, no second render/source mapping — so the display
// can never drift from the generator. See use-composer-export.ts for the
// convenience hook that calls `generateJsx` and feeds this component.
//
// Built on a native `<dialog>` (mirrors the header search dialog's
// `z-modal` / `backdrop:z-modal-backdrop` precedent, pages/lib/_search-widget.tsx)
// for real top-layer stacking, but focus lifecycle (initial focus, Tab
// containment, Escape, trigger restoration) is handled by this component's
// OWN explicit JS rather than left to the browser: `<dialog>`'s native
// focus-trap/restore behavior isn't implemented by this project's test
// runtime (happy-dom), so leaving it to the platform would make the
// "dialog focus lifecycle" acceptance criterion untestable — and unverifiable
// cross-browser.

import type { JSX } from "preact";
import { useEffect, useId, useLayoutEffect, useRef } from "preact/hooks";
import type { BrowserJsxExportOutcome, JsxGenerationResult } from "../../../../composer/browser";
import { ErrorIcon, XMarkIcon } from "../../../../components/icons";
import { ComposerCopyButton } from "./copy-button";

export interface ComposerExportDialogProps {
  open: boolean;
  onClose: () => void;
  documentName: string;
  /** Null while a result hasn't been generated yet (e.g. mid open-triggering). */
  result: JsxGenerationResult | null;
  /**
   * Browser Copy semantics for a linked record. This contains a dependency
   * block or a materialized snapshot result; ordinary dialogs may omit it.
   */
  copyOutcome?: BrowserJsxExportOutcome | null;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ComposerExportDialog({
  open,
  onClose,
  documentName,
  result,
  copyOutcome = null,
}: ComposerExportDialogProps): JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Open/close lifecycle: sync the native <dialog> element's own open state,
  // capture the triggering element on open, move initial focus into the
  // dialog, and restore focus to the trigger on close.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
      const focusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable ?? dialog).focus();
    } else {
      if (dialog.open) dialog.close();
      const trigger = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      trigger?.focus();
    }
  }, [open]);

  // Escape-to-close + Tab containment. Attached only while open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = Array.from(dialog!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog!.contains(active)) {
        // Focus escaped the dialog by some other means — pull it back in.
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const effectiveResult = copyOutcome?.status === "ready" ? copyOutcome.generation : result;
  const dependencyBlock = copyOutcome?.status === "blocked" ? copyOutcome.diagnostic : null;
  const isSnapshot = copyOutcome?.status === "ready" && copyOutcome.kind === "resolved-standalone-snapshot";

  return (
    <dialog
      ref={dialogRef}
      class="z-modal m-0 h-full w-full max-w-none border-none bg-transparent p-0 backdrop:z-modal-backdrop backdrop:bg-overlay/60 sm:mx-auto sm:my-[8vh] sm:h-auto sm:max-h-[84vh] sm:max-w-[48rem] sm:rounded-lg"
      // `role`/`aria-modal`/`aria-labelledby` only while `open` — the
      // <dialog> element itself always stays mounted (a stable ref target
      // for the effects above), so an unconditional role would keep
      // announcing "dialog" to assistive tech and to `getByRole` queries
      // even while closed and empty.
      role={open ? "dialog" : undefined}
      aria-modal={open ? "true" : undefined}
      aria-labelledby={open ? titleId : undefined}
      onClick={(e) => {
        // Clicking the backdrop area (the <dialog> element itself, outside
        // the inner content wrapper) closes it, same as the header search
        // dialog's backdrop-click behavior.
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {open && (
        <div class="flex h-full flex-col overflow-hidden bg-surface sm:rounded-lg sm:border sm:border-border">
          <div class="flex items-center justify-between gap-hsp-sm border-b border-border px-hsp-lg py-vsp-xs">
            <h2 id={titleId} class="text-small font-semibold text-fg">
              Export — {documentName}
            </h2>
            <button type="button" class="sg-composer-toolbar-button" onClick={onClose}>
              <XMarkIcon size="sm" class="sg-composer-button-icon" />
              Close
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-hsp-lg py-vsp-xs">
            {effectiveResult === null && dependencyBlock === null && <p class="text-small text-muted">Generating…</p>}

            {dependencyBlock !== null && (
              <div class="sg-composer-inspector-diagnostics" role="alert">
                <p class="sg-composer-inspector-diagnostics-title">
                  <ErrorIcon size="sm" class="sg-composer-button-icon" />
                  Copy JSX is blocked — the linked dependency is unavailable.
                </p>
                <p>{dependencyBlock.message}</p>
              </div>
            )}

            {dependencyBlock === null && effectiveResult !== null && effectiveResult.blocked && (
              <div class="sg-composer-inspector-diagnostics" role="alert">
                <p class="sg-composer-inspector-diagnostics-title">
                  <ErrorIcon size="sm" class="sg-composer-button-icon" />
                  Export is blocked — one or more components can't be exported:
                </p>
                <ul>
                  {effectiveResult.diagnostics.opaqueIds.map((id) => {
                    const diag = effectiveResult.diagnostics.byId.get(id);
                    return (
                      <li key={id}>
                        <strong>{diag?.componentId ?? id}</strong>
                        <ul>
                          {(diag?.reasons ?? []).map((reason, i) => (
                            <li key={i}>{reason.message}</li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {dependencyBlock === null && effectiveResult !== null && effectiveResult.ok && (
              <>
                {isSnapshot && (
                  <p class="mb-vsp-xs text-small text-muted">
                    Resolved standalone snapshot — future Global-template changes will not propagate to this copied code.
                  </p>
                )}
                <p class="mb-vsp-xs text-small text-muted">
                  {effectiveResult.imports.length} component{effectiveResult.imports.length === 1 ? "" : "s"} ·{" "}
                  {effectiveResult.code.split("\n").length} lines
                </p>
                <pre class="m-0 overflow-auto rounded-md bg-surface-2 p-hsp-sm text-xs text-muted">
                  <code>{effectiveResult.code}</code>
                </pre>
                <div class="mt-vsp-sm">
                  <ComposerCopyButton
                    text={effectiveResult.code}
                    label={isSnapshot ? "Copy resolved standalone snapshot" : "Copy JSX"}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
