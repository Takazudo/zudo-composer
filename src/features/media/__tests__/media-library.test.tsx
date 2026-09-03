/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteIntentParseOutcome } from "../../../app/route-intents";
import { createMediaRecord, type MediaProvider, type MediaRecord, type MediaType } from "../../../media";
import { createMediaLibraryController } from "../controller";
import { createMemoryMediaProvider } from "../fixtures";
import { MediaApp } from "../media-app";

const CHECKSUM = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const NO_INTENT: RouteIntentParseOutcome = { status: "none" };

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function asset(id: string, fileName: string, mediaType: MediaType, byteLength: number, day: string): MediaRecord {
  return createMediaRecord({ fileName, mediaType, byteLength, checksum: CHECKSUM }, { id, timestamp: `2026-01-${day}T00:00:00.000Z` });
}

const HERO = asset("hero", "hero.png", "image/png", 2048, "03");
const TEAM = asset("team", "team.jpg", "image/jpeg", 307_200, "02");
const BRAND = asset("brand", "brand.pdf", "application/pdf", 1_900_000, "01");

/** The dev file provider is the only store with `upload`; a memory one is read-only. */
function uploadingProvider(records: readonly MediaRecord[] = [HERO, TEAM, BRAND]): MediaProvider {
  const provider = createMemoryMediaProvider({ records });
  return { ...provider, store: { ...provider.store, upload: vi.fn() } as MediaProvider["store"] };
}

function tileNames(): string[] {
  return screen.getAllByRole("listitem")
    .map((item) => item.querySelector(".sg-media-asset__name")?.textContent ?? "")
    .filter(Boolean);
}

async function renderRoute(provider: MediaProvider = uploadingProvider(), intent: RouteIntentParseOutcome = NO_INTENT) {
  const rendered = render(<MediaApp provider={provider} intent={intent} />);
  await screen.findByRole("list", { name: "Media assets" });
  return rendered;
}

describe("Media route header and states", () => {
  it("replaces the header prose with a provider chip and the library pattern's header", async () => {
    await renderRoute();
    expect(screen.getByRole("heading", { name: "Media", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("dev · file provider connected");
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    // The file-provider protocol has upload and delete only; `put()` rejects.
    expect(screen.queryByRole("button", { name: /replace/i })).toBeNull();
  });

  it("marks a store without upload as read-only and offers no upload affordance", async () => {
    await renderRoute(createMemoryMediaProvider({ records: [HERO] }));
    expect(screen.getByRole("status")).toHaveTextContent("file provider read-only");
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose files" })).toBeNull();
  });

  it("explains that browsing needs the development file provider when none is connected", () => {
    render(<MediaApp intent={NO_INTENT} />);
    expect(screen.getByText("Media file provider not connected")).toBeInTheDocument();
    expect(screen.getByText(/development file provider/)).toBeInTheDocument();
    expect(screen.getByText(/only runs under/)).toBeInTheDocument();
  });

  it("offers the upload call to action from the empty state", async () => {
    render(<MediaApp provider={uploadingProvider([])} intent={NO_INTENT} />);
    expect(await screen.findByText("No media yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload your first asset" })).toBeInTheDocument();
  });
});

describe("Media browsing", () => {
  it("filters by type through a segmented control carrying the library's counts", async () => {
    await renderRoute();
    const types = screen.getByRole("radiogroup", { name: "Type" });
    expect(within(types).getByRole("radio", { name: /^All/ })).toHaveTextContent("All3");
    expect(within(types).getByRole("radio", { name: /^Images/ })).toHaveTextContent("Images2");
    expect(within(types).getByRole("radio", { name: /^PDFs/ })).toHaveTextContent("PDFs1");

    fireEvent.click(within(types).getByRole("radio", { name: /^PDFs/ }));
    expect(tileNames()).toEqual(["brand.pdf"]);
    // Counts describe the library, not the filtered view.
    expect(within(types).getByRole("radio", { name: /^All/ })).toHaveTextContent("All3");
  });

  it("filters by file name and offers a way back out of a search that matches nothing", async () => {
    await renderRoute();
    const search = screen.getByRole("searchbox", { name: "Filter media" });
    fireEvent.input(search, { target: { value: "team" } });
    expect(tileNames()).toEqual(["team.jpg"]);

    fireEvent.input(search, { target: { value: "nothing here" } });
    expect(screen.getByText("No matches for “nothing here”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(tileNames()).toEqual(["hero.png", "team.jpg", "brand.pdf"]);
  });

  it("sorts newest first by default and reorders through the sort menu", async () => {
    await renderRoute();
    expect(tileNames()).toEqual(["hero.png", "team.jpg", "brand.pdf"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort: Newest" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(tileNames()).toEqual(["brand.pdf", "hero.png", "team.jpg"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort: Name" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Size" }));
    expect(tileNames()).toEqual(["brand.pdf", "team.jpg", "hero.png"]);
  });

  it("switches to the list table and remembers the choice", async () => {
    const { unmount } = await renderRoute();
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent?.trim())).toEqual([
      "", "Name", "Type", "Size", "Added", "Row actions",
    ]);
    expect(localStorage.getItem("zudo-composer.media.view")).toBe("table");
    unmount();

    render(<MediaApp provider={uploadingProvider()} intent={NO_INTENT} />);
    expect(await screen.findByRole("table", { name: "Media assets" })).toBeInTheDocument();
  });

  it("reports what is on screen, what the library holds, and where the bytes are served from", async () => {
    await renderRoute();
    expect(screen.getByText("3 of 3 assets · 2.1 MB · /uploaded-media/")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Type" })).getByRole("radio", { name: /^PDFs/ }));
    expect(screen.getByText("1 of 3 assets · 2.1 MB · /uploaded-media/")).toBeInTheDocument();
  });
});

describe("Media detail panel", () => {
  it("opens the panel from a tile and reports the asset's identity and references", async () => {
    await renderRoute();
    expect(screen.getByText("No asset selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show details for hero.png" }));
    const panel = screen.getByRole("region", { name: "Media details" });
    expect(within(panel).getByRole("heading", { name: "hero.png" })).toBeInTheDocument();
    expect(within(panel).getByText("PNG")).toBeInTheDocument();
    expect(within(panel).getByText("2.0 KB")).toBeInTheDocument();
    expect(within(panel).getByText("hero")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Public URL")).toHaveValue("/uploaded-media/media-hero.png");
    expect(within(panel).getByLabelText("Markdown")).toHaveValue("![hero](/uploaded-media/media-hero.png)");
    // Dimensions come from a decode that jsdom never performs, so the row is
    // absent rather than showing a placeholder.
    expect(within(panel).queryByText("Dimensions")).toBeNull();
  });

  it("copies the public URL and the Markdown reference, one notice at a time", async () => {
    const writeClipboard = vi.fn();
    const provider = uploadingProvider();
    const controller = createMediaLibraryController(provider, { writeClipboard });
    render(<MediaApp provider={provider} controller={controller} intent={NO_INTENT} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show details for hero.png" }));

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("/uploaded-media/media-hero.png"));
    expect(await screen.findByText("Copied the public URL for hero.png.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("![hero](/uploaded-media/media-hero.png)"));
    expect(await screen.findByText("Copied Markdown for hero.png.")).toBeInTheDocument();
    expect(screen.queryByText("Copied the public URL for hero.png.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Copied Markdown for hero.png.")).toBeNull();
  });

  it("copies the public URL straight from a grid tile", async () => {
    const writeClipboard = vi.fn();
    const provider = uploadingProvider();
    render(<MediaApp provider={provider} controller={createMediaLibraryController(provider, { writeClipboard })} intent={NO_INTENT} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy URL for brand.pdf" }));
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("/uploaded-media/media-brand.pdf"));
  });
});

describe("Media deletion", () => {
  it("asks in an alertdialog carrying the advisory scan, then removes the asset", async () => {
    const provider = uploadingProvider();
    const scanReferences = vi.fn().mockResolvedValue(["Content: Home"]);
    render(<MediaApp provider={provider} controller={createMediaLibraryController(provider, { scanReferences })} intent={NO_INTENT} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show details for hero.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete hero.png?" });
    expect(await within(dialog).findByText(/found 1 possible reference: Content: Home\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/Not authoritative:/)).toBeInTheDocument();
    expect(scanReferences).toHaveBeenCalledWith("/uploaded-media/media-hero.png");
    expect(await provider.store.list()).toHaveLength(3);

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(tileNames()).toEqual(["team.jpg", "brand.pdf"]));
    expect(await provider.store.list()).toHaveLength(2);
    // The panel cannot keep showing a record that is gone.
    expect(screen.getByText("No asset selected")).toBeInTheDocument();
  });

  it("states the advisory exactly once per delete question", async () => {
    await renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "Show details for hero.png" }));
    expect(screen.queryByText(/Not authoritative:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(screen.getAllByText(/Not authoritative:/)).toHaveLength(1);
  });

  it("deletes a bulk selection and says no scan was run for it", async () => {
    const provider = uploadingProvider();
    await renderRoute(provider);
    fireEvent.click(screen.getByRole("checkbox", { name: "hero.png" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "team.jpg" }));
    expect(screen.getByText("2 assets selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete 2 assets?" });
    expect(within(dialog).getByText(/No reference scan is run for a bulk delete\./)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(tileNames()).toEqual(["brand.pdf"]));
    expect(screen.queryByText("2 assets selected")).toBeNull();
    expect(await provider.store.list()).toHaveLength(1);
  });

  it("offers Delete… last in a row menu, behind a separator", async () => {
    await renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "More actions for team.jpg" }));
    const menu = screen.getByRole("menu", { name: "team.jpg actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Show details", "Copy URL", "Copy Markdown", "Delete…",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Show details" }));
    expect(screen.getByRole("heading", { name: "team.jpg" })).toBeInTheDocument();
  });
});

describe("Media deep links", () => {
  it("opens the asset a /media?asset= link names", async () => {
    await renderRoute(uploadingProvider(), { status: "matched", intent: { route: "media", assetId: "brand" } });
    expect(await screen.findByRole("heading", { name: "brand.pdf" })).toBeInTheDocument();
  });

  it("says so when the link names an asset this library does not hold", async () => {
    await renderRoute(uploadingProvider(), { status: "matched", intent: { route: "media", assetId: "gone" } });
    expect(await screen.findByText("This library has no media asset with the id gone.")).toBeInTheDocument();
    expect(screen.getByText("No asset selected")).toBeInTheDocument();
  });

  it("reports a malformed link instead of silently opening the plain route", async () => {
    await renderRoute(uploadingProvider(), { status: "invalid", message: "The Media asset id is malformed." });
    expect(screen.getByText("The Media asset id is malformed.")).toBeInTheDocument();
  });
});
