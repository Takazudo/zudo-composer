// Convenience controller wiring Takazudo/zudo-sg#245's `generateJsx` to open/close state for the
// export dialog (issue Takazudo/zudo-sg#249). Deliberately tiny and fully owned by this
// feature: it's the one place `generateJsx` is called from the
// presentational layer. The integration can either use this controller directly or
// call `generateJsx` itself and pass the result straight
// into `ComposerExportDialog` — both paths render the exact same generator
// output, never a second render/source mapping. `result` is never copied
// into further local state anywhere downstream — it's held once, here.
//
// The document arrives as a GETTER, not a captured value (issue Takazudo/zudo-sg#291): the
// integration passes the controller's `flushPropUpdates`, so a
// debounce-pending inspector edit is landed synchronously — and its result
// read back in the same tick — before JSX generation. A captured `document`
// prop could not express that: it would still hold the pre-flush render's
// snapshot when `openExport` runs.

import { signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type {
  BrowserJsxExportOutcome,
  ComponentCatalog,
  CompositionDocument,
  CompositionRecord,
  GlobalTemplateResolutionOutcome,
  IdFactory,
  JsxGenerationResult,
} from "../../../../composer/browser";
import { generateBrowserJsxExport, generateJsx } from "../../../../composer/browser";

export interface ComposerExportController {
  readonly open: ReadonlySignal<boolean>;
  readonly result: ReadonlySignal<JsxGenerationResult | null>;
  /** The exact document snapshot read after pending prop writes were flushed. */
  readonly exportDocument: ReadonlySignal<CompositionDocument | null>;
  /** Copy semantics and any linked-dependency block, separate from opaque-node diagnostics. */
  readonly copyOutcome: ReadonlySignal<BrowserJsxExportOutcome | null>;
  openExport: () => void;
  closeExport: () => void;
}

export interface ComposerExportOptions {
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

/** Create once in the owning component's setup; the methods are stable for its lifetime. */
export function createComposerExport(
  resolveDocument: () => CompositionDocument,
  manifest: ComponentCatalog,
  options: ComposerExportOptions = {},
): ComposerExportController {
  const open = signal(false);
  const result = signal<JsxGenerationResult | null>(null);
  const exportDocument = signal<CompositionDocument | null>(null);
  const copyOutcome = signal<BrowserJsxExportOutcome | null>(null);

  const openExport = () => {
    const document = resolveDocument();
    const outcome = options.record
      ? generateBrowserJsxExport({
          record: { ...options.record, document },
          manifest,
          resolution: options.resolution,
          idFactory: options.idFactory,
        })
      : { status: "ready" as const, kind: "ordinary" as const, generation: generateJsx(document, manifest) };
    exportDocument.value = document;
    copyOutcome.value = outcome;
    result.value = outcome.status === "ready" ? outcome.generation : null;
    open.value = true;
  };

  const closeExport = () => {
    open.value = false;
  };

  return { open, result, exportDocument, copyOutcome, openExport, closeExport };
}
