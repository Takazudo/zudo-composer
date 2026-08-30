import { render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { createContentEntryRecord, createContentModelRecord } from "../../../content";
import type { ContentPreviewSource, ContentPreviewState } from "../preview-source";

const previewHost = vi.hoisted(() => vi.fn());
vi.mock("../../composer/preview/composition-preview-host", async () => {
  const { h } = await import("preact");
  return { CompositionPreviewHost: (props: { enlargeable?: boolean; document: unknown }) => { previewHost(props); return h("div", { "data-enlargeable": String(props.enlargeable) }, props.document ? "Rendered draft" : "Empty preview"); } };
});

import { ContentPreviewPane } from "../content-preview-pane";

const stamp = "2026-08-30T00:00:00.000Z";
const model = createContentModelRecord({ name: "Articles", kind: "collection", fields: [{ id: "body", key: "body", label: "Body", required: true, kind: "markdown" }] }, { id: "articles", timestamp: stamp });
const entry = createContentEntryRecord(model.id, { body: "## Unsaved draft" }, { id: "draft", timestamp: stamp });

function sourceFixture() {
  const listeners = new Set<(state: ContentPreviewState) => void>();
  const idle: ContentPreviewState = { phase: "idle", requestRevision: 0, entryRevision: 0, modelRef: null, candidates: [], selectedRef: null, evaluation: null, document: null, context: null, failures: [], message: "Idle" };
  const ready: ContentPreviewState = {
    ...idle, phase: "ready", modelRef: { providerId: "content-indexeddb", recordId: model.id }, selectedRef: { providerId: "mapping-indexeddb", recordId: "map one" },
    candidates: [
      { ref: { providerId: "mapping-indexeddb", recordId: "map one" }, providerLabel: "Browser mappings", summary: { id: "map one", name: "Article page", createdAt: stamp, updatedAt: stamp, bindingCount: 1 }, status: "ready", diagnostics: [] },
      { ref: { providerId: "mapping-indexeddb", recordId: "broken" }, providerLabel: "Browser mappings", summary: { id: "broken", name: "Broken page", createdAt: stamp, updatedAt: stamp, bindingCount: 1 }, status: "broken", diagnostics: [{ scope: "definition", code: "source-field-missing", severity: "blocking", message: "Body is missing.", bindingId: "binding" }] },
    ],
    document: { schemaVersion: 2, id: "page", name: "Article page", root: [] },
    context: { mapping: { ref: { providerId: "mapping-indexeddb", recordId: "map one" }, id: "map one", name: "Article page" }, composition: { providerId: "composer-indexeddb", recordId: "page", id: "page", name: "Article page" }, contentModel: { ref: { providerId: "content-indexeddb", recordId: model.id }, id: model.id, name: model.document.name }, entry: { providerId: "content-indexeddb", modelId: model.id, entryId: entry.id }, appliedBindingCount: 1, appliedBindings: [], unchangedStaticCount: 0, diagnostics: [] },
    message: "Preview is current.",
  };
  const source = {
    state: idle,
    subscribe(listener: (state: ContentPreviewState) => void) { listeners.add(listener); listener(source.state); return () => listeners.delete(listener); },
    async load() { source.state = ready; for (const listener of listeners) listener(ready); return ready; },
    evaluate: vi.fn(() => ready), select: vi.fn(() => ready), dispose: vi.fn(),
  };
  return source as unknown as ContentPreviewSource;
}

describe("ContentPreviewPane", () => {
  it("shows provider-qualified context, blocked candidates, exact Mapping URL, and shared enlargement", async () => {
    const source = sourceFixture();
    render(<ContentPreviewPane providerId="content-indexeddb" model={model} entry={entry} entryName="Unsaved draft" componentProvider={{} as never} createPreviewSource={() => source} />);
    const link = await screen.findByRole("link", { name: "Open Mapping" });
    expect(link).toHaveAttribute("href", "/mapping?provider=mapping-indexeddb&mapping=map%20one");
    expect(screen.getByText(/Composition: composer-indexeddb \/ Article page/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Broken page — blocked/ })).toBeDisabled();
    await waitFor(() => expect(previewHost).toHaveBeenCalled());
    expect(screen.getByText("Rendered draft")).toHaveAttribute("data-enlargeable", "true");
  });
});
