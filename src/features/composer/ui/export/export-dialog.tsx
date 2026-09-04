/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer JSX export dialog, on the shared `Dialog`.
//
// Presentational only: it renders exactly the `JsxGenerationResult` the
// generator produced — no local copy of `code`, no second render/source
// mapping — so the display can never drift from the generator. See
// `use-composer-export.ts` for the hook that calls `generateJsx` and feeds it.
//
// Focus lifecycle, Escape, Tab containment and trigger restoration all belong
// to `Dialog`: this surface used to reimplement them because it predated the
// shared overlay, and two implementations of a focus trap is one too many.

import type { JSX } from "preact";
import type { BrowserJsxExportOutcome, JsxGenerationResult } from "../../../../composer/browser";
import { Dialog } from "../../../../components/overlay";
import { Banner } from "../../../../components/ui";
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

export function ComposerExportDialog({
  open,
  onClose,
  documentName,
  result,
  copyOutcome = null,
}: ComposerExportDialogProps): JSX.Element {
  const effectiveResult = copyOutcome?.status === "ready" ? copyOutcome.generation : result;
  const dependencyBlock = copyOutcome?.status === "blocked" ? copyOutcome.diagnostic : null;
  const isSnapshot = copyOutcome?.status === "ready" && copyOutcome.kind === "resolved-standalone-snapshot";
  const ready = dependencyBlock === null && effectiveResult !== null && effectiveResult.ok;

  return (
    <Dialog
      open={open}
      size="wide"
      title={`Export — ${documentName}`}
      onClose={onClose}
      // Only the copy action; the header's own close control is the way out.
      footer={
        ready ? (
          <ComposerCopyButton
            text={effectiveResult.code}
            label={isSnapshot ? "Copy resolved standalone snapshot" : "Copy JSX"}
          />
        ) : undefined
      }
    >
      {effectiveResult === null && dependencyBlock === null && <p class="sg-composer-export__note">Generating…</p>}

      {dependencyBlock !== null && (
        <Banner tone="err" title="Copy JSX is blocked — the linked dependency is unavailable.">
          {dependencyBlock.message}
        </Banner>
      )}

      {dependencyBlock === null && effectiveResult !== null && effectiveResult.blocked && (
        <Banner tone="err" title="Export is blocked — one or more components can't be exported:">
          <ul class="sg-composer-export__diagnostics">
            {effectiveResult.diagnostics.opaqueIds.map((id) => {
              const diagnostic = effectiveResult.diagnostics.byId.get(id);
              return (
                <li key={id}>
                  <strong>{diagnostic?.componentId ?? id}</strong>
                  <ul>
                    {(diagnostic?.reasons ?? []).map((reason, index) => (
                      <li key={index}>{reason.message}</li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </Banner>
      )}

      {ready && (
        <>
          {isSnapshot && (
            <p class="sg-composer-export__note">
              Resolved standalone snapshot — future Global-template changes will not propagate to this copied code.
            </p>
          )}
          <p class="sg-composer-export__note">
            {effectiveResult.imports.length} component{effectiveResult.imports.length === 1 ? "" : "s"} ·{" "}
            {effectiveResult.code.split("\n").length} lines
          </p>
          <pre class="sg-composer-export__code">
            <code>{effectiveResult.code}</code>
          </pre>
        </>
      )}
    </Dialog>
  );
}
