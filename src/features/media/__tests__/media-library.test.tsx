import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaApp } from "../media-app";
import { MediaFieldPicker } from "../media-use-picker";
import { providerFixture, completeServices, PNG, PDF } from "./versioned-fixture";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
describe("Media workspace", () => {
  it("uses the shared insertion session for an exact between-folder index", async () => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.createFolder({ name: "A", parentId: null }, await filesystem.mutationToken());
    await filesystem.createFolder({ name: "C", parentId: null }, await filesystem.mutationToken());
    render(<MediaApp provider={provider} contentServices={completeServices()} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Insert before C" }));
    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    fireEvent.input(within(dialog).getByLabelText("Folder name"), { target: { value: "B" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New folder" })).toBeNull());
    expect((await filesystem.snapshot()).folders.map(({ name }) => name)).toEqual(["A", "B", "C"]);
    await waitFor(() => expect(screen.getByRole("treeitem", { name: /^B/ })).toHaveFocus());
  });
  it("shows truthful unavailability with no fabricated assets", () => {
    render(<MediaApp />);
    expect(screen.getByText(/provider is unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("filters grid/list and saves inspector metadata with the stable identity", async () => {
    const { provider, filesystem } = await providerFixture();
    const image = await filesystem.upload({ fileName: "hero.png", declaredMediaType: "image/png", bytes: PNG });
    await filesystem.upload({ fileName: "guide.pdf", declaredMediaType: "application/pdf", bytes: PDF });
    render(<MediaApp provider={provider} contentServices={completeServices()} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hero.png" }));
    const inspector = screen.getByRole("complementary", { name: "Asset details" });
    fireEvent.input(within(inspector).getByLabelText("Asset name"), { target: { value: "renamed.png" } });
    fireEvent.input(within(inspector).getByLabelText("Internal note"), { target: { value: "Internal library note" } });
    fireEvent.click(within(inspector).getByRole("button", { name: "Save details" }));
    await waitFor(async () => expect(await filesystem.get(image.id)).toMatchObject({ record: { id: image.id, document: { fileName: "renamed.png", note: "Internal library note" } } }));
    fireEvent.input(screen.getByRole("searchbox", { name: "Search media" }), { target: { value: "guide" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Inspect renamed.png" })).toBeNull());
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(await screen.findByRole("table", { name: "Media assets" })).toBeTruthy();
  });
  it("guards trash with complete structured usages and restores retained records", async () => {
    const { provider, filesystem } = await providerFixture();
    const asset = await filesystem.upload({ fileName: "hero.png", declaredMediaType: "image/png", bytes: PNG });
    render(<MediaApp provider={provider} contentServices={completeServices()} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select hero.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Trash…", exact: true }));
    const dialog = await screen.findByRole("dialog", { name: "Move assets to trash?" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Move to trash" })).toHaveProperty("disabled", false));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));
    await waitFor(async () => expect(await filesystem.get(asset.id)).toMatchObject({ record: { document: { state: "trash" } } }));
    fireEvent.click(screen.getByRole("button", { name: /^Trash \d/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hero.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore asset" }));
    await waitFor(async () => expect(await filesystem.get(asset.id)).toMatchObject({ record: { document: { state: "active" } } }));
  });
  it("returns typed field values with per-use accessible text separate from notes", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMediaType: "image/png", bytes: PNG, note: "Asset note" });
    const choose = vi.fn(); const close = vi.fn();
    render(<MediaFieldPicker provider={provider} kind="image" onSelect={choose} onClose={close} />);
    await screen.findByRole("option", { name: "hero.png" });
    fireEvent.change(screen.getByLabelText("Media asset"), { target: { value: record.id } });
    fireEvent.input(screen.getByLabelText("Alternative text for this usage"), { target: { value: "A contextual image description" } });
    fireEvent.click(screen.getByRole("button", { name: "Use in content" }));
    await waitFor(() => expect(choose).toHaveBeenCalledWith(expect.objectContaining({ kind: "image", asset: { providerId: provider.descriptor.id, assetId: record.id }, alt: "A contextual image description" })));
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { note: "Asset note" } } });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
