import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import type { CompositionRecord } from "../../../../composer/library";
import {
  CONTENT_ENTRY_SCHEMA_VERSION,
  CONTENT_MODEL_SCHEMA_VERSION,
  createContentCatalog,
  type ContentEntryRecord,
  type ContentModelRecord,
} from "../../../../content";
import { createMediaRecord } from "../../../../media";
import { createCompositionCatalog, createMappingRecord, evaluateMapping } from "../../../../mapping";
import { createMediaLibraryController } from "../../../media/controller";
import { createMemoryMediaProvider } from "../../../media/fixtures";
import { MediaApp } from "../../../media/media-app";
import { activeComponentProvider } from "../../active-pack";
import { CompositionCanvas } from "../renderer";

const stamp = "2026-08-31T00:00:00.000Z";
const checksum = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";

describe("Media Markdown consumption", () => {
  it("copies a root-relative image reference, maps it unchanged, and renders it in the real preview", async () => {
    const media = createMediaRecord(
      {
        fileName: "hero image.png",
        mediaType: "image/png",
        byteLength: 3,
        checksum,
      },
      { id: "hero-image", timestamp: stamp },
    );
    const writeClipboard = vi.fn<(text: string) => void>();
    const mediaProvider = createMemoryMediaProvider({ records: [media] });
    const mediaController = createMediaLibraryController(
      mediaProvider,
      { writeClipboard },
    );
    const library = render(<MediaApp provider={mediaProvider} controller={mediaController} />);
    await screen.findAllByText("hero image.png");
    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledOnce());
    library.unmount();

    const markdown = writeClipboard.mock.calls[0]![0];
    expect(markdown).toBe("![hero image](/uploaded-media/hero%20image.png)");

    const model: ContentModelRecord = {
      id: "articles",
      createdAt: stamp,
      updatedAt: stamp,
      document: {
        schemaVersion: CONTENT_MODEL_SCHEMA_VERSION,
        id: "articles",
        name: "Articles",
        kind: "collection",
        fields: [{ id: "body", key: "body", label: "Body", required: true, kind: "markdown" }],
      },
    };
    const composition: CompositionRecord = {
      id: "article-preview",
      createdAt: stamp,
      updatedAt: stamp,
      document: {
        schemaVersion: 2,
        id: "article-preview",
        name: "Article preview",
        root: [{
          id: "body",
          componentId: "ui.prose-md",
          componentVersion: 1,
          props: { markdown: "Static fallback" },
          slots: {},
        }],
      },
    };
    const entry: ContentEntryRecord = {
      schemaVersion: CONTENT_ENTRY_SCHEMA_VERSION,
      id: "article-one",
      modelId: model.id,
      createdAt: stamp,
      updatedAt: stamp,
      values: { body: markdown },
    };
    const mapping = createMappingRecord({
      id: "article-preview",
      name: "Article preview",
      contentModel: { providerId: "content", recordId: model.id },
      composition: { providerId: "indexeddb", recordId: composition.id },
      bindings: [{
        id: "body-markdown",
        sourceFieldId: "body",
        target: { nodeId: "body", prop: "markdown" },
        transform: { kind: "identity" },
      }],
      createdAt: stamp,
    });
    const result = await evaluateMapping(
      mapping,
      entry,
      {
        content: createContentCatalog([{
          descriptor: { id: "content", label: "Content" },
          store: {
            listModels: async () => [],
            getModel: async () => ({ status: "loaded", record: model }),
          },
        }]),
        compositions: createCompositionCatalog([{
          descriptor: { id: "indexeddb", label: "Compositions" },
          store: {
            list: async () => [],
            get: async () => ({ status: "loaded", record: composition }),
          },
        }]),
      },
      activeComponentProvider.catalog,
    );

    expect(result).toMatchObject({ status: "ready", appliedBindingCount: 1 });
    expect(result.document?.root[0]?.props.markdown).toBe(markdown);

    const { container } = render(
      <CompositionCanvas
        document={result.document!}
        localRecordId={result.document!.id}
        provider={activeComponentProvider}
        session={{ mode: "preview", theme: "light", selectedId: null }}
        onSelect={vi.fn()}
        onRequestAdd={vi.fn()}
        onRequestNodeMenu={vi.fn()}
        onRequestInsertMenu={vi.fn()}
      />,
    );

    await waitFor(() => {
      const image = container.querySelector("img");
      expect(image).toHaveAttribute("alt", "hero image");
      expect(image).toHaveAttribute("src", "/uploaded-media/hero%20image.png");
    });
  });
});
