/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SitemapProvider, SitemapRecord } from "../../../../sitemapper/library";
import { SitemapLibrary } from "../sitemap-library";

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function record(id = "product-map", name = "Product map", unassigned = true): SitemapRecord {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    document: {
      schemaVersion: 2,
      id,
      name,
      root: [{
        id: `${id}-home`,
        title: "Home",
        source: unassigned ? { kind: "unassigned" } : { kind: "composition", ref: { providerId: "browser", recordId: "hero" } },
        children: [],
      }],
    },
  };
}

function provider(initial: SitemapRecord[] = []): { provider: SitemapProvider; records: Map<string, SitemapRecord> } {
  const records = new Map(initial.map((item) => [item.id, item]));
  const summaries = () => [...records.values()].map((item) => ({
    id: item.id,
    name: item.document.name,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    pageCount: 1,
    unassignedCount: item.document.root[0]!.source.kind === "unassigned" ? 1 : 0,
  }));
  return {
    records,
    provider: {
      store: {
        list: async () => summaries(),
        get: async (id) => records.has(id) ? { status: "loaded", record: records.get(id)! } : { status: "not-found", id },
        put: async (next) => { records.set(next.id, next); },
        delete: async (id) => records.delete(id),
        clear: async () => records.clear(),
      },
      initialization: {
        initialize: async () => ({ status: "ready", summaries: summaries() }),
        retry: async () => ({ status: "ready", summaries: summaries() }),
        startFresh: async () => ({ status: "ready", summaries: [] }),
      },
    },
  };
}

const dataRows = () => screen.getAllByRole("row").slice(1);

describe("Sitemaps library", () => {
  it("validates create names, opens the new record by deep link, and never calls native prompt", async () => {
    const setup = provider();
    const navigate = vi.fn();
    const prompt = vi.fn();
    vi.stubGlobal("prompt", prompt);
    render(<SitemapLibrary provider={setup.provider} navigate={navigate} idFactory={() => "new-map"} now={() => "2026-02-01T00:00:00.000Z"} />);

    fireEvent.click(await screen.findByRole("button", { name: "New sitemap" }));
    const dialog = screen.getByRole("dialog", { name: "Create sitemap" });
    const input = within(dialog).getByRole("textbox", { name: "Sitemap name" }) as HTMLInputElement;
    expect(input).toHaveFocus();

    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sitemap" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Enter a sitemap name.")).toBeInTheDocument();

    fireEvent.input(input, { target: { value: "Launch map" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sitemapper?sitemap=new-map"));
    expect(setup.records.get("new-map")?.document.name).toBe("Launch map");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("links every row to its own record and reports its assignment state", async () => {
    const setup = provider([record(), record("brand-map", "Brand map", false)]);
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} />);

    expect(await screen.findByRole("link", { name: "Product map" })).toHaveAttribute("href", "/sitemapper?sitemap=product-map");
    expect(screen.getByText("1 unassigned")).toBeInTheDocument();
    expect(screen.getByText("All assigned")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 sitemaps · Browser storage")).toBeInTheDocument();
  });

  it("filters by assignment and comes back from Clear filters", async () => {
    const setup = provider([record(), record("brand-map", "Brand map", false)]);
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} />);
    await screen.findByRole("link", { name: "Product map" });

    fireEvent.input(screen.getByRole("searchbox", { name: "Filter sitemaps" }), { target: { value: "brand" } });
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByText("1 of 2 sitemaps · Browser storage")).toBeInTheDocument();

    fireEvent.input(screen.getByRole("searchbox", { name: "Filter sitemaps" }), { target: { value: "nothing here" } });
    expect(screen.getByText("No matches for “nothing here”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(dataRows()).toHaveLength(2);
  });

  it("renames through the shared dialog and preserves the record identity", async () => {
    const setup = provider([record()]);
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} now={() => "2026-03-01T00:00:00.000Z"} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Product map" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Product map actions" })).getByRole("menuitem", { name: "Rename…" }));

    const dialog = screen.getByRole("dialog", { name: "Rename sitemap" });
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Sitemap name" }), { target: { value: "Launch architecture" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(setup.records.get("product-map")?.document.name).toBe("Launch architecture"));
    expect(setup.records.get("product-map")).toMatchObject({ id: "product-map", updatedAt: "2026-03-01T00:00:00.000Z" });
  });

  it("reports a failed rename inside the dialog and keeps the typed name", async () => {
    const setup = provider([record()]);
    vi.spyOn(setup.provider.store, "put").mockRejectedValue(new Error("Storage quota exceeded."));
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Product map" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));

    const dialog = screen.getByRole("dialog", { name: "Rename sitemap" });
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Sitemap name" }), { target: { value: "Launch architecture" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Storage quota exceeded.");
    expect(within(dialog).getByRole("textbox", { name: "Sitemap name" })).toHaveValue("Launch architecture");
  });

  it("deletes one record through the row menu and the shared confirmation", async () => {
    const setup = provider([record()]);
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Product map" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete Product map?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await screen.findByText("No sitemaps yet");
    expect(setup.records.has("product-map")).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("deletes a bulk selection and leaves the bulk bar behind with it", async () => {
    const setup = provider([record(), record("brand-map", "Brand map", false)]);
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} />);
    await screen.findByRole("link", { name: "Product map" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Product map" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Brand map" }));
    expect(screen.getByText("2 sitemaps selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Delete 2 sitemaps?" })).getByRole("button", { name: "Delete" }));

    await screen.findByText("No sitemaps yet");
    expect(screen.queryByText("2 sitemaps selected")).toBeNull();
  });

  it("clears the library behind the shared confirmation", async () => {
    const setup = provider([record(), record("brand-map", "Brand map", false)]);
    const clear = vi.spyOn(setup.provider.store, "clear");
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Clear library" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Clear library?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Clear library" }));

    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("No sitemaps yet")).toBeInTheDocument();
  });

  it("leaves the Sitemap library untouched when clearing is cancelled", async () => {
    const setup = provider([record()]);
    const clear = vi.spyOn(setup.provider.store, "clear");
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Clear library" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Clear library?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(clear).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Product map" })).toBeInTheDocument();
    expect(setup.records.size).toBe(1);
  });

  it("keeps the records readable behind the recovery banner and confirms Start fresh", async () => {
    const setup = provider([record()]);
    setup.provider.initialization.initialize = async () => ({
      status: "recovery-required",
      summaries: [{ id: "product-map", name: "Product map", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", pageCount: 1, unassignedCount: 1 }],
      recovery: {
        kind: "quarantined",
        reason: "invalid",
        sourcePreserved: true,
        affectedRecordIds: ["broken"],
        message: "1 stored Sitemap could not be read.",
      },
    });
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} />);

    expect(await screen.findByText("Stored sitemaps need recovery.")).toBeInTheDocument();
    expect(dataRows()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Start fresh…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Start fresh?" })).getByRole("button", { name: "Start fresh" }));
    await screen.findByText("No sitemaps yet");
  });

  it("offers a Retry when the store cannot be opened at all", async () => {
    const setup = provider([record()]);
    const error = Object.assign(new Error("IndexedDB is unavailable."), { name: "SitemapPersistenceError" });
    setup.provider.initialization.initialize = async () => ({ status: "error", error: error as never });
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} />);

    expect(await screen.findByText("Sitemap library unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Product map" })).toBeInTheDocument();
  });

  it("reports a malformed deep link instead of silently showing the library", async () => {
    const setup = provider();
    render(<SitemapLibrary provider={setup.provider} navigate={vi.fn()} notice={<p role="alert">The Sitemap id is malformed.</p>} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The Sitemap id is malformed.");
  });
});

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});
