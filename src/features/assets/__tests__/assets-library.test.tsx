import { createWorkspaceSaveRegistry } from "../../../app/workspace-sessions";
import { AUTHORING_PERSISTENCE_CHANNELS, PROJECT_USAGE_CHANNELS, subscribeAuthoringPersistenceChanges } from "../../../app/persistence-channels";
import { notifyPersistenceChange } from "../../../shared/persistence-generation";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetApp } from "../assets-app";
import { AssetFieldPicker } from "../assets-use-picker";
import { createAssetLibraryController } from "../controller";
import { providerFixture, completeServices, PNG, PDF } from "./versioned-fixture";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
describe("Asset workspace", () => {
  it("uses provider display URLs for version links without changing canonical records", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "temporary.png", declaredMimeType: "image/png", bytes: PNG });
    const version = record.document.versions[0]!;
    const previewUrl = vi.fn((url: string) => `blob:https://example.test/${url.split("/").at(-1)}`);
    render(<AssetApp provider={{ ...provider, previewUrl }} contentServices={completeServices()} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect temporary.png" }));
    const inspector = screen.getByRole("complementary", { name: "Asset details" });
    expect(await within(inspector).findByRole("link", { name: version.id.slice(0, 12) })).toHaveAttribute("href", previewUrl(version.url));
    fireEvent.click(within(inspector).getByRole("button", { name: "Preview", exact: true }));
    const dialog = await screen.findByRole("dialog", { name: "temporary.png" });
    expect(within(dialog).getByRole("link", { name: "Open exact immutable version" })).toHaveAttribute("href", previewUrl(version.url));
    const stored = await filesystem.get(record.id);
    expect(stored.status === "loaded" && stored.record.document.versions[0]!.url).toBe(version.url);
  });

  it("refreshes both inspector and trash usage scans for every project dependency", async () => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const services = completeServices({ subscribeChanges: (listener) => subscribeAuthoringPersistenceChanges(PROJECT_USAGE_CHANNELS, listener) });
    const scan = vi.spyOn(services, "scan");
    render(<AssetApp provider={provider} contentServices={services} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hero.png" }));
    await waitFor(() => expect(scan).toHaveBeenCalled());
    for (const channel of AUTHORING_PERSISTENCE_CHANNELS) {
      scan.mockClear(); notifyPersistenceChange(channel);
      await waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
    }
    fireEvent.click(within(screen.getByRole("complementary", { name: "Asset details" })).getByRole("button", { name: "Trash…", exact: true }));
    await screen.findByRole("dialog", { name: "Move assets to trash?" });
    await waitFor(() => expect(scan.mock.calls.length).toBeGreaterThan(1));
    for (const channel of AUTHORING_PERSISTENCE_CHANNELS) {
      scan.mockClear(); notifyPersistenceChange(channel);
      // Inspector and open trash confirmation each invalidate their own scan.
      await waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    }
  });

  it("shows actionable additional project uses inside the blocked trash dialog", async () => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const services = completeServices({ scan: async () => ({ status: "complete", locations: [], tokens: {}, message: "Complete project scan", additionalLocations: [{ href: "/composer?record=page", location: { domain: "materialization", providerId: "files", recordId: "page", nodeId: "hero", property: "markdown", valuePath: ["markdown"], pathname: "/about", markdown: { from: 4, to: 32, useFrom: 0, useTo: 33 } } }] }) });
    render(<AssetApp provider={provider} contentServices={services} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hero.png" }));
    fireEvent.click(within(screen.getByRole("complementary", { name: "Asset details" })).getByRole("button", { name: "Trash…", exact: true }));
    const dialog = await screen.findByRole("dialog", { name: "Move assets to trash?" });
    expect(await within(dialog).findByRole("link", { name: "files / page" })).toHaveAttribute("href", "/composer?record=page");
    expect(dialog).toHaveTextContent("Markdown 4–32"); expect(dialog).toHaveTextContent("/about");
    expect(within(dialog).getByRole("button", { name: "Move to trash" })).toBeDisabled();
  });
  it("subscribes to usage changes only while an inspector asset is active", async () => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const stop = vi.fn(), subscribe = vi.fn(() => stop);
    render(<AssetApp provider={provider} contentServices={completeServices({ subscribeChanges: subscribe })} intent={{ status: "none" }} />);
    const inspect = await screen.findByRole("button", { name: "Inspect hero.png" });
    expect(subscribe).not.toHaveBeenCalled(); fireEvent.click(inspect);
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    fireEvent.click(within(screen.getByRole("complementary", { name: "Asset details" })).getByRole("button", { name: "Close", exact: true }));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });
  it("keeps missing asset links handled until an explicit link retry", async () => {
    const { provider, filesystem } = await providerFixture();
    const asset = await filesystem.upload({ fileName: "late.png", declaredMimeType: "image/png", bytes: PNG });
    const snapshot = await filesystem.snapshot();
    const read = vi.spyOn(filesystem, "snapshot").mockResolvedValue({ ...snapshot, records: [] });
    const controller = createAssetLibraryController(provider);
    render(<AssetApp provider={provider} controller={controller} intent={{ status: "matched", intent: { route: "assets", providerId: provider.descriptor.id, assetId: asset.id } }} />);
    await screen.findByText(/link targets a missing or unavailable/);
    read.mockRestore(); await controller.reload();
    await screen.findByRole("button", { name: "Inspect late.png" });
    expect(screen.queryByRole("heading", { name: "late.png" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry asset link" }));
    await screen.findByRole("heading", { name: "late.png" });
    expect(screen.queryByText(/link targets a missing or unavailable/)).toBeNull();
  });
  it("surfaces malformed asset intent without selecting another asset", async () => {
    const { provider } = await providerFixture();
    render(<AssetApp provider={provider} intent={{ status: "invalid", message: "Malformed asset identity" }} />);
    expect(await screen.findByText("Malformed asset identity")).toBeTruthy();
  });
  it("invalidates displayed usage claims when the injected Content generation changes", async () => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    let invalidate!: () => void;
    const services = completeServices({ subscribeChanges: (listener) => { invalidate = listener; return () => undefined; } });
    const scan = vi.spyOn(services, "scan").mockResolvedValue({ status: "complete", locations: [], tokens: {}, message: "Old complete snapshot" });
    render(<AssetApp provider={provider} contentServices={services} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hero.png" }));
    await screen.findByText("Old complete snapshot");
    let finish!: (value: Awaited<ReturnType<typeof services.scan>>) => void;
    scan.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    invalidate(); await screen.findByText("Checking structured Content uses…");
    expect(screen.queryByText("Old complete snapshot")).toBeNull();
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    finish({ status: "complete", locations: [], tokens: {}, message: "New complete snapshot" });
    await screen.findByText("New complete snapshot");
  });
  it("uses the shared insertion session for an exact between-folder index", async () => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.createFolder({ name: "A", parentId: null }, await filesystem.mutationToken());
    await filesystem.createFolder({ name: "C", parentId: null }, await filesystem.mutationToken());
    render(<AssetApp provider={provider} contentServices={completeServices()} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Insert before C" }));
    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    fireEvent.input(within(dialog).getByLabelText("Folder name"), { target: { value: "B" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New folder" })).toBeNull());
    expect((await filesystem.snapshot()).folders.map(({ name }) => name)).toEqual(["A", "B", "C"]);
    await waitFor(() => expect(screen.getByRole("treeitem", { name: /^B/ })).toHaveFocus());
  });
  it("shows truthful unavailability with no fabricated assets", () => {
    render(<AssetApp />);
    expect(screen.getByText(/The Assets library and upload authoring are available only/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("saves inspector details, accepts another edit, and flushes against the committed revision", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider, { contentServices: completeServices() });
    const sessions = createWorkspaceSaveRegistry();
    const session = sessions.register({ feature: "Asset metadata", providerId: provider.descriptor.id, recordId: record.id }, { flush: () => controller.flush() });
    const update = vi.spyOn(filesystem, "updateMetadata");
    render(<AssetApp provider={provider} controller={controller} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hero.png" }));
    const inspector = screen.getByRole("complementary", { name: "Asset details" });
    fireEvent.input(within(inspector).getByLabelText("Internal note"), { target: { value: "First save" } });
    fireEvent.click(within(inspector).getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(controller.hasDraft(record.id)).toBe(false));
    fireEvent.input(within(inspector).getByLabelText("Internal note"), { target: { value: "Second edit" } });
    expect(await sessions.flush()).toMatchObject({ status: "ready" });
    expect(update.mock.calls.map((call) => call[2]?.expectedRevision)).toEqual([1, 2]);
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { note: "Second edit" } } });
    expect(controller.hasDraft(record.id)).toBe(false); session.detach();
  });

  it("filters grid/list and saves inspector metadata with the stable identity", async () => {
    const { provider, filesystem } = await providerFixture();
    const image = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    await filesystem.upload({ fileName: "guide.pdf", declaredMimeType: "application/pdf", bytes: PDF });
    render(<AssetApp provider={provider} contentServices={completeServices()} intent={{ status: "none" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hero.png" }));
    const inspector = screen.getByRole("complementary", { name: "Asset details" });
    fireEvent.input(within(inspector).getByLabelText("Asset name"), { target: { value: "renamed.png" } });
    fireEvent.input(within(inspector).getByLabelText("Internal note"), { target: { value: "Internal library note" } });
    fireEvent.click(within(inspector).getByRole("button", { name: "Save details" }));
    await waitFor(async () => expect(await filesystem.get(image.id)).toMatchObject({ record: { id: image.id, document: { fileName: "renamed.png", note: "Internal library note" } } }));
    fireEvent.input(screen.getByRole("searchbox", { name: "Search assets" }), { target: { value: "guide" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Inspect renamed.png" })).toBeNull());
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(await screen.findByRole("table", { name: "Assets" })).toBeTruthy();
  });
  it("guards trash with complete structured usages and restores retained records", async () => {
    const { provider, filesystem } = await providerFixture();
    const asset = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    render(<AssetApp provider={provider} contentServices={completeServices()} intent={{ status: "none" }} />);
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
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG, note: "Asset note" });
    const choose = vi.fn(); const close = vi.fn();
    render(<AssetFieldPicker provider={provider} kind="image" onSelect={choose} onClose={close} />);
    await screen.findByRole("option", { name: "hero.png" });
    fireEvent.change(screen.getByLabelText("Asset"), { target: { value: record.id } });
    fireEvent.input(screen.getByLabelText("Alternative text for this usage"), { target: { value: "A contextual image description" } });
    fireEvent.click(screen.getByRole("button", { name: "Use in content" }));
    await waitFor(() => expect(choose).toHaveBeenCalledWith(expect.objectContaining({ kind: "image", asset: { providerId: provider.descriptor.id, assetId: record.id }, alt: "A contextual image description" })));
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { note: "Asset note" } } });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
