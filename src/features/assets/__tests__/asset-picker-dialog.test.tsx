import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSET_MAX_BYTE_LENGTH, summarizeAsset, type AssetProvider } from "../../../assets";
import { AssetPickerDialog } from "../asset-picker-dialog";
import { nextEscapeAction } from "../asset-picker-panes";
import { PDF, PNG, providerFixture } from "./versioned-fixture";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function libraryFixture() {
  const fixture = await providerFixture();
  const hero = await fixture.filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG, note: "Mountain sunrise" });
  const guide = await fixture.filesystem.upload({ fileName: "guide.pdf", declaredMimeType: "application/pdf", bytes: PDF });
  return { ...fixture, hero, guide };
}

function renderedNames() {
  return within(screen.getByRole("list", { name: "Assets" })).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
}

function stubTier(initial: { sideOverlay: boolean; detailDrawer: boolean }) {
  let tier = initial;
  let notify = () => {};
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = computedStyle(element, pseudo);
    const overlay = element.classList.contains("sg-assets-picker-library") ? tier.sideOverlay
      : element.classList.contains("sg-assets-picker-details") ? tier.detailDrawer : undefined;
    if (overlay !== undefined) Object.defineProperty(style, "position", { value: overlay ? "absolute" : "relative", configurable: true });
    return style;
  });
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { notify = () => callback([], this); }
    observe = observe;
    unobserve = vi.fn();
    disconnect = disconnect;
  });
  return { observe, disconnect, resize: (next: typeof tier) => act(() => { tier = next; notify(); }) };
}

describe("Asset picker dialog", () => {
  it("toggles panes with inert, returns contained focus to their tabs, and persists across remount", async () => {
    const { provider } = await libraryFixture();
    const props = { provider, kind: "image" as const, onSelect: vi.fn(), onClose: vi.fn() };
    const first = render(<AssetPickerDialog {...props} />);
    await screen.findByRole("button", { name: "hero.png" });
    const library = screen.getByRole("complementary", { name: "Library" });
    const details = screen.getByRole("complementary", { name: "Asset details" });
    within(library).getByRole("button", { name: /^All assets/ }).focus();
    const sideTab = screen.getByRole("button", { name: "Hide library" });
    expect(sideTab).toHaveAttribute("aria-controls", library.id);
    fireEvent.click(sideTab);
    expect(sideTab).toHaveFocus();
    expect(sideTab).toHaveAttribute("aria-expanded", "false");
    expect(library).toHaveAttribute("inert");
    expect(library).toHaveAttribute("aria-hidden", "true");
    details.focus();
    const detailTab = screen.getByRole("button", { name: "Hide asset details" });
    expect(detailTab).toHaveAttribute("aria-controls", details.id);
    fireEvent.click(detailTab);
    expect(detailTab).toHaveFocus();
    expect(details).toHaveAttribute("inert");
    expect(details).toHaveAttribute("aria-hidden", "true");
    expect(JSON.parse(localStorage.getItem("sg-assets-picker:panes")!)).toEqual({ side: false, detail: false, sideWidth: 176 });
    first.unmount();
    render(<AssetPickerDialog {...props} />);
    expect(screen.getByRole("button", { name: "Show library" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Show asset details" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Show library" }));
    fireEvent.click(screen.getByRole("button", { name: "Show asset details" }));
    expect(screen.getByRole("complementary", { name: "Library" })).not.toHaveAttribute("inert");
    expect(screen.getByRole("complementary", { name: "Asset details" })).not.toHaveAttribute("inert");
  });

  it("searches names and notes, clears an empty search, filters type, and switches to a list", async () => {
    const { provider } = await libraryFixture();
    render(<AssetPickerDialog provider={provider} kind="link" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "hero.png" });
    const search = screen.getByRole("searchbox", { name: "Search assets" });
    fireEvent.input(search, { target: { value: "SUNRISE" } });
    expect(renderedNames()).toEqual(["hero.png"]);
    fireEvent.input(search, { target: { value: "guide" } });
    expect(renderedNames()).toEqual(["guide.pdf"]);
    fireEvent.input(search, { target: { value: "missing" } });
    expect(screen.queryByRole("list", { name: "Assets" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(renderedNames()).toEqual(["guide.pdf", "hero.png"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Asset type" }), { target: { value: "image" } });
    expect(renderedNames()).toEqual(["hero.png"]);
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(screen.getByRole("radio", { name: "List view" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("list", { name: "Assets" })).toHaveAttribute("data-view", "list");
  });

  it("uses the library comparators for name, newest, and largest sorting", async () => {
    const { provider, filesystem, hero, guide } = await libraryFixture();
    const alpha = await filesystem.upload({ fileName: "alpha.png", declaredMimeType: "image/png", bytes: PNG });
    vi.spyOn(filesystem, "list").mockResolvedValue([
      { ...summarizeAsset(hero), updatedAt: "2026-03-01T00:00:00.000Z", byteLength: 100 },
      { ...summarizeAsset(guide), updatedAt: "2026-02-01T00:00:00.000Z", byteLength: 300 },
      { ...summarizeAsset(alpha), updatedAt: "2026-01-01T00:00:00.000Z", byteLength: 200 },
    ]);
    render(<AssetPickerDialog provider={provider} kind="link" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "hero.png" });
    expect(renderedNames()).toEqual(["alpha.png", "guide.pdf", "hero.png"]);
    const sort = screen.getByRole("combobox", { name: "Sort assets" });
    fireEvent.change(sort, { target: { value: "newest" } });
    expect(renderedNames()).toEqual(["hero.png", "guide.pdf", "alpha.png"]);
    fireEvent.change(sort, { target: { value: "size" } });
    expect(renderedNames()).toEqual(["guide.pdf", "alpha.png", "hero.png"]);
  });

  it("uploads through the picker input, refreshes the grid, selects the new image and uses it", async () => {
    const { provider } = await providerFixture();
    const choose = vi.fn();
    const close = vi.fn();
    render(<AssetPickerDialog provider={provider} kind="image" onSelect={choose} onClose={close} />);
    const input = await screen.findByLabelText("Upload new file") as HTMLInputElement;
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/gif,image/webp");
    fireEvent.change(input, { target: { files: [new File([PNG], "uploaded.png", { type: "image/png" })] } });
    const uploaded = await screen.findByRole("button", { name: "uploaded.png" });
    await waitFor(() => expect(uploaded).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Use this image" }));
    await waitFor(() => expect(choose).toHaveBeenCalledExactlyOnceWith({
      kind: "image", asset: { providerId: provider.descriptor.id, assetId: expect.any(String) }, alt: "", decorative: false, caption: "",
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("opens the file chooser immediately for an upload intent", async () => {
    const { provider } = await providerFixture();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    render(<AssetPickerDialog provider={provider} kind="image" intent="upload" onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
  });

  it("surfaces invalid image and oversized upload errors without changing the selection", async () => {
    const { provider } = await libraryFixture();
    render(<AssetPickerDialog provider={provider} kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    const hero = await screen.findByRole("button", { name: "hero.png" });
    fireEvent.click(hero);
    const input = screen.getByLabelText("Upload new file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([PDF], "guide.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("Choose an image file for this picker.")).toBeVisible();
    expect(hero).toHaveAttribute("aria-pressed", "true");
    const oversized = new File([new Uint8Array(ASSET_MAX_BYTE_LENGTH + 1)], "oversized.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(await screen.findByText("Upload exceeds the 25 MB limit. Choose a smaller file.")).toBeVisible();
    expect(hero).toHaveAttribute("aria-pressed", "true");
  });

  it("omits picker upload controls when the provider has no upload capability", async () => {
    const { provider, filesystem } = await libraryFixture();
    const plain: AssetProvider = { ...provider, store: { provider: provider.descriptor, list: () => filesystem.list(), get: (id) => filesystem.get(id), put: provider.store.put, delete: provider.store.delete, clear: provider.store.clear } };
    render(<AssetPickerDialog provider={plain} kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "hero.png" });
    expect(screen.queryByText("Drop a file here to upload and use it")).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload new file…" })).toBeNull();
    expect(screen.queryByLabelText("Upload new file")).toBeNull();
  });

  it.each(["link", "download", "card"] as const)("double-clicks a file into a fresh %s use", async (kind) => {
    const { provider, guide } = await libraryFixture();
    const choose = vi.fn(); const close = vi.fn();
    render(<AssetPickerDialog provider={provider} kind={kind} onSelect={choose} onClose={close} />);
    expect(screen.getByRole("button", { name: "Use this asset" })).toBeDisabled();
    fireEvent.dblClick(await screen.findByRole("button", { name: "guide.pdf" }));
    const asset = { providerId: provider.descriptor.id, assetId: guide.id };
    const value = kind === "link" ? { kind, asset, label: "guide.pdf" }
      : kind === "download" ? { kind, asset, label: "guide.pdf", showSize: true, showType: true }
        : { kind, asset, title: "guide.pdf", description: "" };
    await waitFor(() => expect(choose).toHaveBeenCalledExactlyOnceWith(value));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("uses Enter from search, leaves control keys alone, and awaits a single pending insertion", async () => {
    const { provider } = await libraryFixture();
    let finish!: () => void;
    const choose = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const close = vi.fn();
    render(<AssetPickerDialog provider={provider} kind="image" onSelect={choose} onClose={close} />);
    const item = await screen.findByRole("button", { name: "hero.png" });
    fireEvent.click(item);
    fireEvent.keyDown(item, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Sort assets" }), { key: "Enter" });
    expect(choose).not.toHaveBeenCalled();
    const search = screen.getByRole("searchbox", { name: "Search assets" });
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(choose).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Use this image" })).toBeDisabled();
    expect(close).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("never lists trashed records even if a provider returns them", async () => {
    const { provider, filesystem, hero, guide } = await libraryFixture();
    const trashed = await filesystem.trash(hero.id, { expectedRevision: hero.revision });
    vi.spyOn(filesystem, "list").mockResolvedValue([summarizeAsset(trashed), summarizeAsset(guide)]);
    render(<AssetPickerDialog provider={provider} kind="link" current={{ providerId: provider.descriptor.id, assetId: hero.id }} onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "guide.pdf" });
    expect(screen.queryByRole("button", { name: "hero.png" })).toBeNull();
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.queryByRole("button", { name: /Trash/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Use this asset" })).toBeDisabled();
  });

  it.each(["trashed", "non-image"])("refuses a selection that became %s before submit", async (change) => {
    const { provider, filesystem, hero, guide } = await libraryFixture();
    const choose = vi.fn(); const close = vi.fn();
    render(<AssetPickerDialog provider={provider} kind="image" onSelect={choose} onClose={close} />);
    fireEvent.click(await screen.findByRole("button", { name: "hero.png" }));
    if (change === "trashed") await filesystem.trash(hero.id, { expectedRevision: hero.revision });
    else vi.spyOn(filesystem, "get").mockResolvedValue({ status: "loaded", record: { ...guide, id: hero.id, document: { ...guide.document, id: hero.id } } });
    fireEvent.click(screen.getByRole("button", { name: "Use this image" }));
    await screen.findByText(change === "trashed" ? "This asset is no longer available. Choose another asset." : "The selected asset is no longer an image.");
    expect(choose).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use this image" })).toBeEnabled();
  });

  it("uses current metadata for labels and surfaces insertion errors", async () => {
    const { provider, filesystem, guide } = await libraryFixture();
    const choose = vi.fn().mockRejectedValueOnce(new Error("Content changed; retry selection."));
    const close = vi.fn();
    render(<AssetPickerDialog provider={provider} kind="link" onSelect={choose} onClose={close} />);
    fireEvent.click(await screen.findByRole("button", { name: "guide.pdf" }));
    await filesystem.updateMetadata(guide.id, { fileName: "renamed.pdf" }, { expectedRevision: guide.revision });
    fireEvent.click(screen.getByRole("button", { name: "Use this asset" }));
    await screen.findByText("Content changed; retry selection.");
    expect(choose).toHaveBeenCalledWith({ kind: "link", asset: { providerId: provider.descriptor.id, assetId: guide.id }, label: "renamed.pdf" });
    expect(close).not.toHaveBeenCalled();
  });

  it("scopes folders in path order and shows unfiled counts without a Trash facet", async () => {
    const { provider, filesystem } = await libraryFixture();
    await filesystem.createFolder({ name: "Zebra", parentId: null }, await filesystem.mutationToken());
    const a = await filesystem.createFolder({ name: "Alpine", parentId: null }, await filesystem.mutationToken());
    const child = await filesystem.createFolder({ name: "Summer", parentId: a.id }, await filesystem.mutationToken());
    await filesystem.upload({ fileName: "folder.png", folderId: child.id, declaredMimeType: "image/png", bytes: PNG });
    render(<AssetPickerDialog provider={provider} kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "folder.png" });
    const folders = screen.getByRole("region", { name: "Folders" });
    expect(within(folders).getAllByRole("button").map((item) => item.textContent)).toEqual(["Alpine 0", "Summer 1", "Zebra 0"]);
    expect(within(folders).getByTitle("Alpine / Summer")).toHaveStyle({ "--sg-assets-picker-folder-depth": "1" });
    fireEvent.click(within(folders).getByTitle("Alpine / Summer"));
    expect(renderedNames()).toEqual(["folder.png"]);
    expect(screen.getByText("Alpine / Summer · 1 shown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unfiled 1" }));
    expect(renderedNames()).toEqual(["hero.png"]);
    expect(screen.queryByRole("button", { name: /Trash/ })).toBeNull();
  });

  it("omits folders when the store has no snapshot capability and keeps the unavailable-provider banner", async () => {
    const { provider, filesystem } = await libraryFixture();
    const plain: AssetProvider = { ...provider, store: { provider: provider.descriptor, list: () => filesystem.list(), get: (id) => filesystem.get(id), put: provider.store.put, delete: provider.store.delete, clear: provider.store.clear } };
    const rendered = render(<AssetPickerDialog provider={plain} kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "hero.png" });
    expect(screen.queryByRole("region", { name: "Folders" })).toBeNull();
    rendered.unmount();
    render(<AssetPickerDialog kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/The Assets library and upload authoring are available only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this image" })).toBeDisabled();
  });

  it("shares decoded dimensions by immutable version and respects provider display URLs", async () => {
    const { provider, hero } = await libraryFixture();
    const previewUrl = vi.fn((url: string) => `https://example.test${url}`);
    render(<AssetPickerDialog provider={{ ...provider, previewUrl }} kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    const item = await screen.findByRole("button", { name: "hero.png" });
    const img = item.querySelector("img")!;
    expect(img).toHaveAttribute("src", previewUrl(hero.document.versions[0]!.url));
    Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: 400 }, naturalHeight: { value: 300 } });
    fireEvent.load(img);
    expect(item).toHaveTextContent("PNG · 12 B · 400×300");
    fireEvent.click(item);
    const details = screen.getByRole("complementary", { name: "Asset details" });
    expect(details).toHaveTextContent("400×300");
    expect(details).toHaveTextContent("Mountain sunrise");
    expect(details).toHaveTextContent(hero.id);
    expect(details.querySelector("time")).toHaveAttribute("datetime", hero.createdAt);
    expect(details).not.toHaveTextContent("Used in Content");
  });

  it("peels the details drawer then the library overlay before allowing Dialog to close", async () => {
    stubTier({ sideOverlay: true, detailDrawer: true });
    const { provider } = await libraryFixture();
    const close = vi.fn();
    render(<AssetPickerDialog provider={provider} kind="image" onSelect={vi.fn()} onClose={close} />);
    await screen.findByRole("button", { name: "hero.png" });
    expect(screen.getByRole("button", { name: "Show library" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Show library" }));
    const search = screen.getByRole("searchbox", { name: "Search assets" });
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fireEvent(search, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "Show asset details" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Hide library" })).toHaveAttribute("aria-expanded", "true");
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Show library" })).toHaveAttribute("aria-expanded", "false");
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reads tier changes from computed positions and closes a library overlay after choosing a facet", async () => {
    const observer = stubTier({ sideOverlay: false, detailDrawer: true });
    const { provider } = await libraryFixture();
    const first = render(<AssetPickerDialog provider={provider} kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "hero.png" });
    expect(observer.observe).toHaveBeenCalledWith(screen.getByRole("dialog", { name: "Choose an image" }));
    expect(screen.getByRole("button", { name: "Hide library" })).toHaveAttribute("aria-expanded", "true");
    screen.getByRole("separator", { name: "Resize library" }).focus();
    observer.resize({ sideOverlay: true, detailDrawer: true });
    expect(screen.getByRole("button", { name: "Show library" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Show library" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Show library" }));
    const facet = screen.getByRole("button", { name: "Unfiled 1" });
    facet.focus(); fireEvent.click(facet);
    expect(screen.getByRole("button", { name: "Show library" })).toHaveFocus();
    expect(screen.getByText("Unfiled · 1 shown")).toBeInTheDocument();
    first.unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it("resizes by pointer and keyboard within 150–300px and persists the width", async () => {
    const { provider } = await libraryFixture();
    render(<AssetPickerDialog provider={provider} kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    const separator = screen.getByRole("separator", { name: "Resize library" });
    expect(separator).toHaveAttribute("aria-valuenow", "176");
    const pointer = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 1 }, button: { value: 0 }, clientX: { value: x } });
      fireEvent(separator, event);
    };
    pointer("pointerdown", 200);
    pointer("pointermove", 260);
    expect(separator).toHaveAttribute("aria-valuenow", "236");
    pointer("pointermove", 800);
    expect(separator).toHaveAttribute("aria-valuenow", "300");
    pointer("pointerup", 800);
    pointer("pointermove", 200);
    expect(separator).toHaveAttribute("aria-valuenow", "300");
    fireEvent.keyDown(separator, { key: "Home" });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "150");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "160");
    expect(document.querySelector(".sg-assets-picker")).toHaveStyle({ "--sg-assets-picker-side-w": "160px" });
    await waitFor(() => expect(JSON.parse(localStorage.getItem("sg-assets-picker:panes")!)).toMatchObject({ sideWidth: 160 }));
  });

  it.each(["broken", '{"side":true,"detail":false,"sideWidth":9999}'])("handles malformed or out-of-range pane preferences: %s", async (saved) => {
    localStorage.setItem("sg-assets-picker:panes", saved);
    const { provider } = await libraryFixture();
    render(<AssetPickerDialog provider={provider} kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("separator", { name: "Resize library" })).toHaveAttribute("aria-valuenow", saved === "broken" ? "176" : "300");
    await screen.findByRole("button", { name: "hero.png" });
  });

  it("keeps working when localStorage cannot be read or written", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked storage"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked storage"); });
    const { provider } = await libraryFixture();
    render(<AssetPickerDialog provider={provider} kind="image" onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "hero.png" });
    fireEvent.click(screen.getByRole("button", { name: "Hide library" }));
    expect(screen.getByRole("button", { name: "Show library" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Escape pane decision", () => {
  it.each([
    [{ sideOverlay: true, sideOpen: true, detailDrawer: true, detailOpen: true }, "detail"],
    [{ sideOverlay: true, sideOpen: true, detailDrawer: true, detailOpen: false }, "side"],
    [{ sideOverlay: false, sideOpen: true, detailDrawer: true, detailOpen: true }, "detail"],
    [{ sideOverlay: false, sideOpen: true, detailDrawer: false, detailOpen: true }, "dialog"],
    [{ sideOverlay: true, sideOpen: false, detailDrawer: true, detailOpen: false }, "dialog"],
  ] as const)("%j → %s", (state, action) => expect(nextEscapeAction(state)).toBe(action));
});
