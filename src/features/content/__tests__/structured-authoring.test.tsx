import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { createContentEntryRecord, createContentModelRecord, type ContentEntryRecord, type ContentFieldDefinition } from "../../../content";
import { ContentEntryAuthor, ContentSchemaAuthor } from "../content-author";
import { ContentRawView } from "../content-workspace";
import { createContentAuthoringController, type ContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

afterEach(cleanup);
const stamp = "2026-01-01T00:00:00.000Z";
const run = (action: () => void | Promise<void>) => void Promise.resolve(action());
function Harness({ controller }: { controller: ContentAuthoringController }): JSX.Element {
  const [state, setState] = useState(controller.state);
  useEffect(() => controller.subscribe(setState), [controller]);
  return <ContentEntryAuthor state={state} controller={controller} run={run} />;
}
function SchemaHarness({ controller }: { controller: ContentAuthoringController }): JSX.Element {
  const [state, setState] = useState(controller.state);
  useEffect(() => controller.subscribe(setState), [controller]);
  return <ContentSchemaAuthor state={state} controller={controller} run={run} onRemove={() => undefined} />;
}

describe("generic structured Content authoring", () => {
  it("uses the complete target catalog and persists ordered reference values", async () => {
    const people = createContentModelRecord({ name: "People", kind: "collection", fields: [{ id: "name", key: "name", label: "Name", required: true, kind: "text" }] }, { id: "people", timestamp: stamp });
    const articles = createContentModelRecord({ name: "Articles", kind: "collection", fields: [{ id: "authors", key: "authors", label: "Authors", required: false, kind: "reference-list", target: { providerId: "content-filesystem", recordId: "people" }, ordered: true }] }, { id: "articles", timestamp: stamp });
    const targets = Array.from({ length: 30 }, (_, index) => createContentEntryRecord("people", { name: `Person ${index + 1}` }, { id: `person-${index + 1}`, timestamp: stamp }));
    const article = createContentEntryRecord("articles", {}, { id: "article", timestamp: stamp });
    const provider = createMemoryContentProvider({ models: [people, articles], entries: [...targets, article] });
    const controller = createContentAuthoringController(provider, { providers: [provider] });
    await controller.initialize(); await controller.openModel("articles"); await controller.openEntry("article");
    render(<Harness controller={controller} />);

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /^Person 30 draft$/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: /^Person 1 draft$/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Person 2 draft$/ }));
    await waitFor(() => expect(controller.state.entry?.values.authors).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Move Person 2 up" }));
    expect((controller.state.entry?.values.authors as unknown as { recordId: string }[]).map((ref) => ref.recordId)).toEqual(["person-2", "person-1"]);
  });

  it("authors choice, object, list and per-use image metadata from the canonical value", async () => {
    const model = createContentModelRecord({ name: "Cards", kind: "collection", fields: [
      { id: "tone", key: "tone", label: "Tone", required: true, kind: "choice", options: [{ value: "warm", label: "Warm" }, { value: "cool", label: "Cool" }] },
      { id: "details", key: "details", label: "Details", required: false, kind: "object", fields: [{ id: "caption", key: "caption", label: "Caption", required: true, kind: "text" }] },
      { id: "tags", key: "tags", label: "Tags", required: false, kind: "list", item: { kind: "text" } },
      { id: "hero", key: "hero", label: "Hero", required: false, kind: "asset-use", use: "image" },
    ] }, { id: "cards", timestamp: stamp });
    const entry = createContentEntryRecord("cards", {}, { id: "card", timestamp: stamp });
    const provider = createMemoryContentProvider({ models: [model], entries: [entry] });
    const assetProvider = { descriptor: { id: "asset-files", label: "Files" }, store: { list: async () => [{ id: "hero-image", fileName: "hero.png", state: "active" as const }] } };
    const controller = createContentAuthoringController(provider, { assetProvider });
    await controller.initialize(); await controller.openModel("cards"); await controller.openEntry("card");
    render(<Harness controller={controller} />);

    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "cool" } });
    fireEvent.input(screen.getByRole("textbox", { name: "Caption" }), { target: { value: "Nested" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.input(document.querySelector('[data-content-field-id="tags"] input')!, { target: { value: "first" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Asset" })).toHaveTextContent("hero.png"));
    fireEvent.change(screen.getByRole("combobox", { name: "Asset" }), { target: { value: "hero-image" } });
    fireEvent.input(screen.getByRole("textbox", { name: "Alternative text" }), { target: { value: "A descriptive hero" } });
    await waitFor(() => expect(controller.state.entry?.values).toMatchObject({ tone: "cool", details: { caption: "Nested" }, tags: ["first"], hero: { kind: "image", alt: "A descriptive hero" } }));
  });

  it("shows human-keyed resolved data beside untouched field-ID storage", () => {
    const model = createContentModelRecord({ name: "Cards", kind: "collection", fields: [{ id: "details-id", key: "details", label: "Details", required: false, kind: "object", fields: [{ id: "caption-id", key: "caption", label: "Caption", required: false, kind: "text" }] }] }, { id: "cards", timestamp: stamp });
    const entry: ContentEntryRecord = createContentEntryRecord("cards", { "details-id": { "caption-id": "Hello" } }, { id: "card", timestamp: stamp });
    render(<ContentRawView model={model} entry={entry} />);
    expect(screen.getByText(/"details":/)).toBeInTheDocument();
    expect(screen.getByText(/"caption": "Hello"/)).toBeInTheDocument();
    expect(screen.getByText(/"details-id":/)).toBeInTheDocument();
    expect(screen.getByText(/"caption-id": "Hello"/)).toBeInTheDocument();
  });

  it("consumes the callback-only Asset picker seam without importing Asset presentation", async () => {
    const model = createContentModelRecord({ name: "Cards", kind: "collection", fields: [{ id: "hero", key: "hero", label: "Hero", required: false, kind: "asset-use", use: "image" }] }, { id: "cards", timestamp: stamp });
    const entry = createContentEntryRecord("cards", {}, { id: "card", timestamp: stamp });
    const controller = createContentAuthoringController(createMemoryContentProvider({ models: [model], entries: [entry] }));
    await controller.initialize(); await controller.openModel("cards"); await controller.openEntry("card");
    render(<ContentEntryAuthor state={controller.state} controller={controller} run={run} renderAssetPicker={({ onSelect }) => <div role="dialog" aria-label="Asset picker"><button onClick={() => onSelect({ kind: "image", asset: { providerId: "asset-files", assetId: "hero" }, alt: "", decorative: false, caption: "" })}>Choose hero</button></div>} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose from Assets" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose hero" }));
    expect(controller.state.entry?.values.hero).toMatchObject({ kind: "image", asset: { providerId: "asset-files", assetId: "hero" } });
  });

  it("edits ordered choice options structurally without a delimiter codec", async () => {
    const model = createContentModelRecord({ name: "Cards", kind: "collection", fields: [{ id: "tone", key: "tone", label: "Tone", required: false, kind: "choice", options: [{ value: "warm|muted", label: "Warm\nand muted" }, { value: "cool", label: "Cool" }] }] }, { id: "cards", timestamp: stamp });
    const provider = createMemoryContentProvider({ models: [model], entries: [] }); const controller = createContentAuthoringController(provider);
    await controller.initialize(); await controller.openModel("cards"); render(<SchemaHarness controller={controller} />);
    expect(screen.getByRole("textbox", { name: "Value for option 1 in Tone" })).toHaveValue("warm|muted");
    expect(screen.getByRole("textbox", { name: "Label for option 1 in Tone" })).toHaveValue("Warm\nand muted");
    fireEvent.input(screen.getByRole("textbox", { name: "Label for option 1 in Tone" }), { target: { value: "Warm | quiet\nline two" } });
    fireEvent.click(screen.getByRole("button", { name: "Move option 1 down" }));
    await waitFor(() => expect((controller.state.model!.document.fields[0] as Extract<ContentFieldDefinition, { kind: "choice" }>).options).toEqual([{ value: "cool", label: "Cool" }, { value: "warm|muted", label: "Warm | quiet\nline two" }]));
  });
});
