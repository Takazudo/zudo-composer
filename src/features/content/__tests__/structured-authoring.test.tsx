import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { AssetSummary } from "../../../assets";
import { createContentEntryRecord, createContentModelRecord, type ContentAssetUse, type ContentEntryRecord, type ContentFieldDefinition } from "../../../content";
import { ContentEntryAuthor, ContentSchemaAuthor } from "../content-author";
import { ContentRawView } from "../content-workspace";
import { createContentAuthoringController, type ContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";
import type { ContentAssetPickerRenderer } from "../structured-field-editor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const stamp = "2026-01-01T00:00:00.000Z";
const run = (action: () => void | Promise<void>) => void Promise.resolve(action());
function Harness({ controller, renderAssetPicker, assetPickerCapabilities }: { controller: ContentAuthoringController; renderAssetPicker?: ContentAssetPickerRenderer; assetPickerCapabilities?: { upload: boolean } }): JSX.Element {
  const [state, setState] = useState(controller.state);
  useEffect(() => controller.subscribe(setState), [controller]);
  return <ContentEntryAuthor state={state} controller={controller} run={run} renderAssetPicker={renderAssetPicker} assetPickerCapabilities={assetPickerCapabilities} />;
}
function SchemaHarness({ controller }: { controller: ContentAuthoringController }): JSX.Element {
  const [state, setState] = useState(controller.state);
  useEffect(() => controller.subscribe(setState), [controller]);
  return <ContentSchemaAuthor state={state} controller={controller} run={run} onRemove={() => undefined} />;
}

const imageAsset: AssetSummary = {
  id: "hero-image", fileName: "hero.webp", mimeType: "image/webp", byteLength: 4300,
  checksum: `sha256-${"a".repeat(64)}`, versionId: "version-1", revision: 1,
  url: `/uploaded-assets/sha256-${"a".repeat(64)}.webp`, authoringUrl: "/uploaded-assets/asset-hero-image",
  createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z", state: "active", folderId: null, note: "",
};
const imageUse = { kind: "image", asset: { providerId: "asset-files", assetId: imageAsset.id }, alt: "A descriptive hero", decorative: false, caption: "An existing caption" } satisfies ContentAssetUse;

async function createAssetController(value: ContentAssetUse | null = imageUse, options: { assets?: readonly AssetSummary[]; kind?: ContentAssetUse["kind"]; nested?: boolean } = {}) {
  const hero: ContentFieldDefinition = { id: "hero", key: "hero", label: "Hero", required: false, kind: "asset-use", use: options.kind ?? value?.kind ?? "image" };
  const fields: ContentFieldDefinition[] = options.nested ? [{ id: "details", key: "details", label: "Details", required: false, kind: "object", fields: [{ id: "caption", key: "caption", label: "Caption", required: false, kind: "text" }, hero] }] : [hero];
  const model = createContentModelRecord({ name: "Cards", kind: "collection", fields }, { id: "cards", timestamp: stamp });
  const values: ContentEntryRecord["values"] = value ? options.nested ? { details: { caption: "Nested text", hero: value } } : { hero: value } : {};
  const entry = createContentEntryRecord("cards", values, { id: "card", timestamp: stamp });
  const list = vi.fn(async () => options.assets ?? [imageAsset]);
  const controller = createContentAuthoringController(createMemoryContentProvider({ models: [model], entries: [entry] }), { assetProvider: { descriptor: { id: "asset-files", label: "Files" }, store: { list } } });
  await controller.initialize(); await controller.openModel("cards"); await controller.openEntry("card");
  return { controller, list };
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
    const assetProvider = { descriptor: { id: "asset-files", label: "Files" }, store: { list: async () => [{ ...imageAsset, fileName: "hero.png", mimeType: "image/png" as const }, { ...imageAsset, id: "trashed-image", fileName: "trashed.png", state: "trash" as const }] } };
    const controller = createContentAuthoringController(provider, { assetProvider });
    await controller.initialize(); await controller.openModel("cards"); await controller.openEntry("card");
    render(<Harness controller={controller} />);

    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "cool" } });
    fireEvent.input(screen.getByRole("textbox", { name: "Caption" }), { target: { value: "Nested" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.input(document.querySelector('[data-content-field-id="tags"] input')!, { target: { value: "first" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Asset" })).toHaveTextContent("hero.png"));
    expect(screen.getByRole("combobox", { name: "Asset" })).not.toHaveTextContent("trashed.png");
    fireEvent.change(screen.getByRole("combobox", { name: "Asset" }), { target: { value: "hero-image" } });
    fireEvent.input(screen.getByRole("textbox", { name: "Alt text" }), { target: { value: "A descriptive hero" } });
    fireEvent.input(screen.getByRole("textbox", { name: "Image caption" }), { target: { value: "Image caption text" } });
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
    const entry = createContentEntryRecord("cards", { hero: { kind: "image", asset: { providerId: "asset-files", assetId: "existing-hero" }, alt: "Existing hero", decorative: false, caption: "Existing caption" } }, { id: "card", timestamp: stamp });
    const controller = createContentAuthoringController(createMemoryContentProvider({ models: [model], entries: [entry] }));
    await controller.initialize(); await controller.openModel("cards"); await controller.openEntry("card");
    let pickerRequest: Parameters<ContentAssetPickerRenderer>[0] | undefined;
    render(<ContentEntryAuthor state={controller.state} controller={controller} run={run} renderAssetPicker={(request) => { pickerRequest = request; return <div role="dialog" aria-label="Asset picker"><button onClick={() => request.onSelect({ kind: "image", asset: { providerId: "asset-files", assetId: "hero" }, alt: "", decorative: false, caption: "" })}>Choose hero</button></div>; }} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }));
    expect(pickerRequest?.current).toEqual({ providerId: "asset-files", assetId: "existing-hero" });
    fireEvent.click(screen.getByRole("button", { name: "Choose hero" }));
    expect(controller.state.entry?.values.hero).toEqual({ kind: "image", asset: { providerId: "asset-files", assetId: "hero" }, alt: "Existing hero", decorative: false, caption: "Existing caption" });
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

describe("Content asset-use cards", () => {
  it("projects complete asset metadata and keeps trashed records in the catalog", async () => {
    const trashed = { ...imageAsset, id: "trashed-image", state: "trash" as const };
    const { controller, list } = await createAssetController(imageUse, { assets: [imageAsset, trashed] });
    expect(await controller.assetAssets()).toEqual([imageAsset, trashed].map((asset) => ({
      providerId: "asset-files", assetId: asset.id, label: asset.fileName, fileName: asset.fileName,
      mimeType: asset.mimeType, byteLength: asset.byteLength, url: asset.url, authoringUrl: asset.authoringUrl,
      createdAt: asset.createdAt, state: asset.state,
    })));
    expect(list).toHaveBeenCalledWith();
  });

  it("shows the filled card, immutable thumbnail, metadata, actions and authoring URL", async () => {
    const { controller } = await createAssetController();
    render(<Harness controller={controller} renderAssetPicker={() => null} />);
    expect(await screen.findByText("hero.webp")).toBeVisible();
    const thumbnail = screen.getByAltText("");
    expect(thumbnail).toHaveAttribute("src", imageAsset.url);
    expect(screen.getByText("WebP · 4.2 KB · uploaded Sep 12, 2026")).toBeVisible();
    Object.defineProperties(thumbnail, { naturalWidth: { value: 400 }, naturalHeight: { value: 400 } });
    fireEvent.load(thumbnail);
    expect(screen.getByText("WebP · 4.2 KB · 400 × 400 · uploaded Sep 12, 2026")).toBeVisible();
    expect(screen.getByRole("button", { name: "Replace…" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open in Assets" })).toHaveAttribute("href", "/assets?provider=asset-files&asset=hero-image");
    expect(screen.getByText(imageAsset.authoringUrl)).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy authoring URL" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /url/i })).toBeNull();
  });

  it("chooses into an empty image field and preserves the picker's initial per-use text", async () => {
    const { controller } = await createAssetController(null, { assets: [] });
    let request: Parameters<ContentAssetPickerRenderer>[0] | undefined;
    render(<Harness controller={controller} renderAssetPicker={(next) => { request = next; return <button onClick={() => next.onSelect(imageUse)}>Use image</button>; }} />);
    expect(screen.getByText("No image chosen.")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Alt text" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose from Assets" }));
    expect(request?.current).toBeUndefined();
    expect(request?.kind).toBe("image");
    fireEvent.click(screen.getByRole("button", { name: "Use image" }));
    expect(controller.state.entry?.values.hero).toEqual(imageUse);
  });

  it("offers Upload… only with the upload capability and passes the upload intent", async () => {
    const { controller } = await createAssetController(null, { assets: [] });
    let request: Parameters<ContentAssetPickerRenderer>[0] | undefined;
    render(<Harness controller={controller} assetPickerCapabilities={{ upload: true }} renderAssetPicker={(next) => { request = next; return <div role="dialog" aria-label="Asset picker" />; }} />);
    expect(screen.getByRole("button", { name: "Upload…" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Upload…" }));
    expect(request?.intent).toBe("upload");
    expect(request?.kind).toBe("image");
  });

  it("does not offer Upload… when a picker renderer exists without upload capability", async () => {
    const { controller } = await createAssetController(null, { assets: [] });
    render(<Harness controller={controller} renderAssetPicker={() => <div role="dialog" aria-label="Asset picker" />} assetPickerCapabilities={{ upload: false }} />);
    expect(screen.getByRole("button", { name: "Choose from Assets" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Upload…" })).toBeNull();
  });

  it.each(["link", "download", "card"] as const)("names an empty %s use as an asset", async (kind) => {
    const { controller } = await createAssetController(null, { kind });
    render(<Harness controller={controller} renderAssetPicker={() => null} />);
    expect(screen.getByText("No asset chosen.")).toBeVisible();
  });

  it.each([
    { ...imageUse, asset: { providerId: "asset-files", assetId: "missing-image" } },
    { ...imageUse, asset: { providerId: "other-files", assetId: imageAsset.id } },
  ])("keeps an unavailable provider-qualified reference replaceable and removable", async (value) => {
    const { controller } = await createAssetController(value);
    render(<Harness controller={controller} renderAssetPicker={() => <div role="dialog" aria-label="Asset picker" />} />);
    const title = await screen.findByText(`Unavailable asset · ${value.asset.assetId}`);
    expect(title.closest(".sg-content-asset-card")).toHaveAttribute("data-warning", "true");
    expect(screen.queryByAltText("")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }));
    expect(screen.getByRole("dialog", { name: "Asset picker" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(controller.state.entry?.values.hero).toBeUndefined();
    expect(screen.getByText("No image chosen.")).toBeVisible();
  });

  it("explains the trashed state while retaining the thumbnail and Assets link", async () => {
    const { controller } = await createAssetController(imageUse, { assets: [{ ...imageAsset, state: "trash" }] });
    render(<Harness controller={controller} renderAssetPicker={() => null} />);
    expect(await screen.findByText("In trash")).toBeVisible();
    expect(screen.getByText("This asset was moved to Trash in Assets. Choose another image or restore it in Assets.")).toBeVisible();
    expect(screen.getByText("hero.webp").closest(".sg-content-asset-card")).toHaveAttribute("data-warning", "true");
    expect(screen.getByAltText("")).toHaveAttribute("src", imageAsset.url);
    expect(screen.getByRole("link", { name: "Open in Assets" })).toHaveAttribute("href", "/assets?provider=asset-files&asset=hero-image");
  });

  it("replaces through the fallback select with active assets and retains per-use metadata", async () => {
    const { controller } = await createAssetController(imageUse, { assets: [{ ...imageAsset, state: "trash" }, { ...imageAsset, id: "replacement", fileName: "replacement.webp" }] });
    render(<Harness controller={controller} />);
    await screen.findByText("In trash");
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }));
    const select = screen.getByRole("combobox", { name: "Asset" });
    expect(within(select).getByRole("option", { name: "In trash · hero.webp" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "replacement" } });
    expect(controller.state.entry?.values.hero).toEqual({ ...imageUse, asset: { providerId: "asset-files", assetId: "replacement" } });
  });

  it("forgets old pixel dimensions when a replacement thumbnail loads", async () => {
    const replacement = { ...imageAsset, id: "replacement", fileName: "replacement.webp", url: `/uploaded-assets/sha256-${"b".repeat(64)}.webp` };
    const { controller } = await createAssetController(imageUse, { assets: [imageAsset, replacement] });
    render(<Harness controller={controller} renderAssetPicker={(request) => <button onClick={() => request.onSelect({ ...imageUse, asset: { providerId: "asset-files", assetId: replacement.id }, alt: "Picker default" })}>Use replacement</button>} />);
    await screen.findByText("hero.webp");
    const original = screen.getByAltText("");
    Object.defineProperties(original, { naturalWidth: { value: 400 }, naturalHeight: { value: 400 } });
    fireEvent.load(original);
    expect(screen.getByText(/400 × 400/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }));
    fireEvent.click(screen.getByRole("button", { name: "Use replacement" }));
    await screen.findByText("replacement.webp");
    expect(screen.queryByText(/400 × 400/)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Alt text" })).toHaveValue(imageUse.alt);
    const next = screen.getByAltText("");
    Object.defineProperties(next, { naturalWidth: { value: 800 }, naturalHeight: { value: 600 } });
    fireEvent.load(next);
    expect(screen.getByText(/800 × 600/)).toBeVisible();
  });

  it("reloads the catalog for a new asset selected by the picker", async () => {
    const replacement = { ...imageAsset, id: "new-upload", fileName: "new-upload.webp" };
    const { controller, list } = await createAssetController();
    list.mockResolvedValueOnce([imageAsset]).mockResolvedValue([replacement]);
    render(<Harness controller={controller} renderAssetPicker={(request) => <button onClick={() => request.onSelect({ ...imageUse, asset: { providerId: "asset-files", assetId: replacement.id } })}>Use upload</button>} />);
    await screen.findByText("hero.webp");
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }));
    fireEvent.click(screen.getByRole("button", { name: "Use upload" }));
    expect(await screen.findByText("new-upload.webp")).toBeVisible();
    expect(controller.state.entry?.values.hero).toEqual({ ...imageUse, asset: { providerId: "asset-files", assetId: replacement.id } });
  });

  it("ignores an older catalog result after the picker closes", async () => {
    const { controller, list } = await createAssetController();
    let resolveOld!: (assets: readonly AssetSummary[]) => void;
    const oldResult = new Promise<readonly AssetSummary[]>((resolve) => { resolveOld = resolve; });
    list.mockImplementationOnce(() => oldResult);
    render(<Harness controller={controller} renderAssetPicker={(request) => <button onClick={request.onClose}>Cancel picker</button>} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel picker" }));
    expect(await screen.findByText("hero.webp")).toBeVisible();
    await act(async () => { resolveOld([]); await oldResult; });
    expect(screen.getByText("hero.webp")).toBeVisible();
    expect(screen.queryByText(/Unavailable asset/)).toBeNull();
  });

  it("recovers a failed catalog read when returning from the picker", async () => {
    const { controller, list } = await createAssetController();
    list.mockRejectedValueOnce(new Error("Asset catalog unavailable."));
    render(<Harness controller={controller} renderAssetPicker={(request) => <button onClick={request.onClose}>Cancel picker</button>} />);
    expect(await screen.findByText("Asset catalog unavailable.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel picker" }));
    expect(await screen.findByText("hero.webp")).toBeVisible();
    expect(screen.queryByText("Asset catalog unavailable.")).toBeNull();
  });

  it("removes the use, including all per-use fields", async () => {
    const { controller } = await createAssetController();
    render(<Harness controller={controller} renderAssetPicker={() => null} />);
    await screen.findByText("hero.webp");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(controller.state.entry?.values.hero).toBeUndefined();
    expect(screen.getByText("No image chosen.")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Alt text" })).toBeNull();
  });

  it("copies the authoring URL without substituting the immutable byte URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { controller } = await createAssetController();
    render(<Harness controller={controller} renderAssetPicker={() => null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy authoring URL" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(imageAsset.authoringUrl);
  });

  it.each([undefined, { writeText: () => Promise.reject(new Error("Clipboard denied")) }])("tolerates unavailable or denied clipboard access", async (clipboard) => {
    vi.stubGlobal("navigator", { clipboard });
    const { controller } = await createAssetController();
    render(<Harness controller={controller} renderAssetPicker={() => null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy authoring URL" }));
    await waitFor(() => expect(controller.state.entry?.values.hero).toEqual(imageUse));
  });

  it("labels the nested image fields, reports missing alt text and disables it for decorative images", async () => {
    const { controller } = await createAssetController({ ...imageUse, alt: "" }, { nested: true });
    render(<Harness controller={controller} renderAssetPicker={() => null} />);
    await screen.findByText("hero.webp");
    const group = within(screen.getByRole("group", { name: "Details" }));
    const alt = group.getByRole("textbox", { name: "Alt text" });
    expect(alt).toHaveAttribute("aria-invalid", "true");
    expect(alt).toHaveAccessibleDescription("Add alt text or mark the image decorative");
    fireEvent.input(alt, { target: { value: "   " } });
    expect(screen.getByText("Add alt text or mark the image decorative")).toBeVisible();
    fireEvent.click(group.getByRole("switch", { name: "Decorative image" }));
    expect(alt).toBeDisabled();
    expect(alt).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Add alt text or mark the image decorative")).toBeNull();
    fireEvent.input(group.getByRole("textbox", { name: "Image caption" }), { target: { value: "New image caption" } });
    expect(group.getByRole("textbox", { name: "Caption" })).toHaveValue("Nested text");
    expect(controller.state.entry?.values.details).toMatchObject({ caption: "Nested text", hero: { decorative: true, alt: "", caption: "New image caption" } });
  });

  it.each([
    { kind: "link", asset: imageUse.asset, label: "Read the guide" },
    { kind: "download", asset: imageUse.asset, label: "Download the guide", showSize: true, showType: true },
    { kind: "card", asset: imageUse.asset, title: "Guide", description: "A useful guide" },
  ] satisfies ContentAssetUse[])("renders a file tile and labeled metadata for a $kind use", async (value) => {
    const pdf = { ...imageAsset, fileName: "guide.pdf", mimeType: "application/pdf" as const };
    const { controller } = await createAssetController(value, { assets: [pdf] });
    render(<Harness controller={controller} renderAssetPicker={() => null} />);
    expect(await screen.findByText("guide.pdf")).toBeVisible();
    expect(screen.getByText("PDF")).toBeVisible();
    expect(screen.queryByAltText("")).toBeNull();
    if (value.kind === "card") {
      fireEvent.input(screen.getByRole("textbox", { name: "Card title" }), { target: { value: "Updated title" } });
      fireEvent.input(screen.getByRole("textbox", { name: "Card description" }), { target: { value: "Updated description" } });
      expect(controller.state.entry?.values.hero).toMatchObject({ title: "Updated title", description: "Updated description" });
    } else {
      fireEvent.input(screen.getByRole("textbox", { name: value.kind === "link" ? "Link label" : "Download label" }), { target: { value: "Updated label" } });
      if (value.kind === "download") {
        fireEvent.click(screen.getByRole("switch", { name: "Show file size" }));
        fireEvent.click(screen.getByRole("switch", { name: "Show file type" }));
        expect(controller.state.entry?.values.hero).toMatchObject({ showSize: false, showType: false });
      }
      expect(controller.state.entry?.values.hero).toMatchObject({ label: "Updated label" });
    }
  });

  it("keeps the card usable after a failed preview and retries when the asset is selected again", async () => {
    const { controller } = await createAssetController();
    render(<Harness controller={controller} renderAssetPicker={(request) => <button onClick={() => request.onSelect(imageUse)}>Use image again</button>} />);
    await screen.findByText("hero.webp");
    fireEvent.error(screen.getByAltText(""));
    expect(screen.getByText("Preview unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Replace…" })).toBeEnabled();
    expect(controller.state.entry?.values.hero).toEqual(imageUse);
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }));
    fireEvent.click(screen.getByRole("button", { name: "Use image again" }));
    expect(screen.getByAltText("")).toHaveAttribute("src", imageAsset.url);
    expect(screen.queryByText("Preview unavailable")).toBeNull();
  });
});
