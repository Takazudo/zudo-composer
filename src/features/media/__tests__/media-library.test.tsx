import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaRecord } from "../../../media";
import { createMediaLibraryController } from "../controller";
import { createMemoryMediaProvider } from "../fixtures";
import { MediaApp } from "../media-app";

const checksum = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const hero = createMediaRecord({ fileName: "hero.png", mediaType: "image/png", byteLength: 2048, checksum }, { id: "hero", timestamp: "2026-01-01T00:00:00.000Z" });
afterEach(cleanup);

describe("Media library browse UI", () => {
  it("uses a complete roving Media layout tablist and labels Details overflow", async () => {
    render(<MediaApp provider={createMemoryMediaProvider({ records: [hero] })} />);
    const gallery = await screen.findByRole("tab", { name: "Gallery" }); const details = screen.getByRole("tab", { name: "Details" });
    expect(gallery).toHaveAttribute("aria-selected", "true"); expect(gallery).toHaveAttribute("tabindex", "0"); expect(screen.getAllByText("hero.png")).toHaveLength(2);
    gallery.focus(); fireEvent.keyDown(gallery, { key: "ArrowRight" }); expect(details).toHaveFocus(); expect(details).toHaveAttribute("aria-selected", "true"); expect(gallery).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("region", { name: "Media details, horizontally scrollable" })).toBeInTheDocument();
    fireEvent.keyDown(details, { key: "Home" }); expect(gallery).toHaveFocus();
    fireEvent.keyDown(gallery, { key: "End" }); expect(details).toHaveFocus();
    fireEvent.keyDown(details, { key: "ArrowRight" }); expect(gallery).toHaveFocus();
    fireEvent.keyDown(gallery, { key: "ArrowLeft" }); expect(details).toHaveFocus();
  });

  it("copies Markdown and requires explicit deletion with a non-authoritative warning", async () => {
    const writeClipboard = vi.fn(); const provider = createMemoryMediaProvider({ records: [hero] });
    const controller = createMediaLibraryController(provider, { writeClipboard, scanReferences: vi.fn().mockResolvedValue([]) });
    render(<MediaApp provider={provider} controller={controller} />);
    await screen.findAllByText("hero.png"); fireEvent.click(screen.getAllByRole("button", { name: "Copy Markdown" })[0]!);
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("![hero](/uploaded-media/hero.png)"));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    expect(screen.getByRole("dialog", { name: "Delete media?" })).toBeInTheDocument();
    expect(screen.getByText(/Not authoritative:/)).toBeInTheDocument();
    await screen.findByText(/found no references/);
    expect(await provider.store.list()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.queryAllByText("hero.png")).toHaveLength(0));
    expect(await provider.store.list()).toHaveLength(0);
  });
});
