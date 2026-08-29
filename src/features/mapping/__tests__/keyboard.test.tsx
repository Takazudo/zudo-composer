import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import "../../composer/test-support/cleanup";
import { createMappingRecord } from "../../../mapping";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingApp } from "../mapping-app";
import type { MappingEditorController, MappingEditorState } from "../controller";

const now = "2026-01-02T03:04:05.000Z";
const record = createMappingRecord({ id: "mapping-1", name: "Article", contentModel: { providerId: "content-indexeddb", recordId: "model-1" }, composition: { providerId: "indexeddb", recordId: "composition-1" }, createdAt: now });
const base: MappingEditorState = { phase: "ready", mappings: [], libraryDetails: {}, contentModels: [{ ref: record.document.contentModel, providerLabel: "Browser storage", summary: { id: "model-1", name: "Articles", kind: "collection", fieldCount: 0, createdAt: now, updatedAt: now } }], compositions: [{ ref: record.document.composition, providerLabel: "Browser storage", summary: { id: "composition-1", name: "Page", nodeCount: 0, createdAt: now, updatedAt: now } }], catalogFailures: [], mapping: record, definition: null, entries: [], entryFailure: null, entry: null, evaluation: null, previewDocument: null, previewStatus: "empty", activePane: "source", saveStatus: "saved", message: "Ready", recoveryMessage: null };

function renderState(initial: MappingEditorState) {
  let listener: ((state: MappingEditorState) => void) | undefined; const setActivePane = vi.fn((activePane) => listener?.({ ...initial, activePane }));
  const controller = { state: initial, subscribe(next: (state: MappingEditorState) => void) { listener = next; next(initial); return () => { listener = undefined; }; }, setActivePane, initialize: vi.fn(), close: vi.fn(), flush: vi.fn(), setPreviewCurrent: vi.fn(), setPreviewError: vi.fn() } as unknown as MappingEditorController;
  render(<MappingApp provider={{} as never} contentCatalog={{} as never} compositionCatalog={{} as never} contentStore={{} as never} componentProvider={activeComponentProvider} controller={controller} />);
  return { setActivePane };
}

describe("Mapping keyboard and dialog behavior", () => {
  it("uses roving focus with Left/Right navigation on the one labelled tablist", () => {
    const { setActivePane } = renderState(base); const source = screen.getByRole("tab", { name: "Source" }); const bindings = screen.getByRole("tab", { name: "Bindings" });
    source.focus(); fireEvent.keyDown(source, { key: "ArrowRight" });
    expect(setActivePane).toHaveBeenCalledWith("bindings"); expect(bindings).toHaveFocus();
    fireEvent.keyDown(bindings, { key: "ArrowLeft" }); expect(source).toHaveFocus();
  });

  it("restores focus to the control that opened a dialog", async () => {
    renderState({ ...base, mapping: null }); const opener = screen.getByRole("button", { name: "New Mapping" }); opener.focus(); fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Create Mapping" })).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await Promise.resolve(); expect(opener).toHaveFocus();
  });
});
