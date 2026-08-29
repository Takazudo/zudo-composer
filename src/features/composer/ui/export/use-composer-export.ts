// Convenience hook wiring #245's `generateJsx` to open/close state for the
// export dialog (issue #249). Deliberately tiny and fully owned by this
// feature: it's the one place `generateJsx` is called from the
// presentational layer, so wave-5 integration (#251) can either use this
// hook directly or call `generateJsx` itself and pass the result straight
// into `ComposerExportDialog` — both paths render the exact same generator
// output, never a second render/source mapping. `result` is never copied
// into further local state anywhere downstream — it's held once, here.
//
// The document arrives as a GETTER, not a captured value (issue #291): the
// integration passes the controller's `flushPropUpdates`, so a
// debounce-pending inspector edit is landed synchronously — and its result
// read back in the same tick — before JSX generation. A captured `document`
// prop could not express that: it would still hold the pre-flush render's
// snapshot when `openExport` runs.

import { useCallback, useMemo, useState } from "preact/hooks";
import type {
  BrowserJsxExportOutcome,
  ComponentCatalog,
  CompositionDocument,
  CompositionRecord,
  GlobalTemplateResolutionOutcome,
  IdFactory,
  JsxGenerationResult,
} from "../../../../composer";
import { generateBrowserJsxExport, generateJsx } from "../../../../composer";

export interface UseComposerExportResult {
  open: boolean;
  result: JsxGenerationResult | null;
  /** The exact document snapshot read after pending prop writes were flushed. */
  exportDocument: CompositionDocument | null;
  /** Copy semantics and any linked-dependency block, separate from opaque-node diagnostics. */
  copyOutcome: BrowserJsxExportOutcome | null;
  openExport: () => void;
  closeExport: () => void;
}

export interface UseComposerExportOptions {
  /**
   * Optional current persisted record for linked browser Copy behavior. Its
   * document is replaced with the flushed export snapshot at open time so a
   * debounce-pending edit cannot be lost.
   */
  record?: CompositionRecord;
  /** Current parent-owned resolver result for `record`; no resolver/provider is invoked here. */
  resolution?: GlobalTemplateResolutionOutcome | null;
  /** Test seam for standalone snapshot ids. */
  idFactory?: IdFactory;
}

export function useComposerExport(
  resolveDocument: () => CompositionDocument,
  manifest: ComponentCatalog,
  options: UseComposerExportOptions = {},
): UseComposerExportResult {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<JsxGenerationResult | null>(null);
  const [exportDocument, setExportDocument] = useState<CompositionDocument | null>(null);
  const [copyOutcome, setCopyOutcome] = useState<BrowserJsxExportOutcome | null>(null);

  const openExport = useCallback(() => {
    const document = resolveDocument();
    const outcome = options.record
      ? generateBrowserJsxExport({
          record: { ...options.record, document },
          manifest,
          resolution: options.resolution,
          idFactory: options.idFactory,
        })
      : { status: "ready" as const, kind: "ordinary" as const, generation: generateJsx(document, manifest) };
    setExportDocument(document);
    setCopyOutcome(outcome);
    setResult(outcome.status === "ready" ? outcome.generation : null);
    setOpen(true);
  }, [resolveDocument, manifest, options.record, options.resolution, options.idFactory]);

  const closeExport = useCallback(() => {
    setOpen(false);
  }, []);

  // Memoized so the returned object is referentially stable across renders
  // that don't touch `open`/`result` — callers (e.g. the integration hook's
  // `handleEscape`) can safely depend on this object without re-binding on
  // every unrelated parent render (issue #286).
  return useMemo(
    () => ({ open, result, exportDocument, copyOutcome, openExport, closeExport }),
    [open, result, exportDocument, copyOutcome, openExport, closeExport],
  );
}
