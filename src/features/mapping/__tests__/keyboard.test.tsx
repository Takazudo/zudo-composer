import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import "../../composer/test-support/cleanup";
import { createMappingRecord } from "../../../mapping";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingApp } from "../mapping-app";
import type { MappingEditorController, MappingEditorState } from "../controller";

const now = "2026-01-02T03:04:05.000Z";
const record = createMappingRecord({ id: "mapping-1", name: "Article", contentModel: { providerId: "content-indexeddb", recordId: "model-1" }, composition: { providerId: "indexeddb", recordId: "composition-1" }, createdAt: now });
const base: MappingEditorState = { phase: "ready", mappings: [], libraryDetails: {}, contentModels: [{ ref: record.document.contentModel, providerLabel: "Browser storage", summary: { id: "model-1", name: "Articles", kind: "collection", fieldCount: 0, createdAt: now, updatedAt: now } }], compositions: [{ ref: record.document.composition, providerLabel: "Browser storage", summary: { id: "composition-1", name: "Page", nodeCount: 0, createdAt: now, updatedAt: now } }], catalogFailures: [], mapping: record, definition: null, entries: [], entryFailure: null, entry: null, evaluation: null, previewDocument: null, previewStatus: "empty", activePane: "source", saveStatus: "saved", message: "Ready", recoveryMessage: null, deepLink: { status: "none" } };

function renderState(initial: MappingEditorState) {
  let listener: ((state: MappingEditorState) => void) | undefined; const setActivePane = vi.fn((activePane) => listener?.({ ...initial, activePane }));
  const controller = { state: initial, subscribe(next: (state: MappingEditorState) => void) { listener = next; next(initial); return () => { listener = undefined; }; }, setActivePane, initialize: vi.fn(), close: vi.fn(), flush: vi.fn(), delete: vi.fn(async () => undefined), setPreviewCurrent: vi.fn(), setPreviewError: vi.fn() } as unknown as MappingEditorController;
  const view = render(<MappingApp provider={{} as never} contentCatalog={{} as never} compositionCatalog={{} as never} contentEntries={{} as never} componentProvider={activeComponentProvider} controller={controller} />);
  return { controller, setActivePane, container: view.container };
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

  it("restores focus after a confirmed Mapping deletion", async () => {
    const summary = { id: "mapping-1", name: "Article", createdAt: now, updatedAt: now, bindingCount: 0 };
    const { controller } = renderState({ ...base, mapping: null, mappings: [summary] });
    const opener = screen.getByRole("button", { name: "Delete Article" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(controller.delete).toHaveBeenCalledWith("mapping-1"));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps each binding's source, transform, and target meaning visible", () => {
    const binding = { id: "binding-1", sourceFieldId: "missing-source", target: { nodeId: "missing-node", prop: "missing-prop" }, transform: { kind: "identity" as const } };
    const view = renderState({ ...base, mapping: { ...record, document: { ...record.document, bindings: [binding] } } });
    const flow = view.container.querySelector(".sg-mapping-binding__flow")!;
    expect(flow).toHaveTextContent("Source"); expect(flow).toHaveTextContent("Transform"); expect(flow).toHaveTextContent("Target");
    expect(flow.querySelectorAll(".sg-mapping-binding__connector")).toHaveLength(2);
    expect(flow.textContent).not.toMatch(/[\u2191\u2193\u2192\u2190]/);
    const context = view.container.querySelector(".sg-mapping-preview-context")!;
    expect(context).toHaveTextContent("Entry"); expect(context).toHaveTextContent("Composition");
    expect(view.container.querySelector(".sg-mapping-preview-diagnostics")).toBeInTheDocument();
  });
});
