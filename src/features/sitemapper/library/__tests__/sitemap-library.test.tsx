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

function record(name = "Product map"): SitemapRecord {
  return {
    id: "product-map",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    document: {
      schemaVersion: 2,
      id: "product-map",
      name,
      root: [{ id: "home", title: "Home", source: { kind: "unassigned" }, children: [] }],
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

describe("SitemapLibrary dialogs", () => {
  it("validates create names, supports Enter, and never calls native prompt", async () => {
    const setup = provider();
    const onOpen = vi.fn();
    const prompt = vi.fn();
    vi.stubGlobal("prompt", prompt);
    render(<SitemapLibrary provider={setup.provider} onOpen={onOpen} idFactory={() => "new-map"} now={() => "2026-02-01T00:00:00.000Z"} />);

    const trigger = await screen.findByRole("button", { name: "New sitemap" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Create sitemap" });
    const input = within(dialog).getByRole("textbox", { name: "Sitemap name" }) as HTMLInputElement;
    expect(input).toHaveFocus();

    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(onOpen).not.toHaveBeenCalled();
    expect(input.validationMessage).toBe("Enter a sitemap name.");

    fireEvent.input(input, { target: { value: "Launch map" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
    expect(setup.records.get("new-map")?.document.name).toBe("Launch map");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("cancels with Escape and restores focus to the rename trigger", async () => {
    const setup = provider([record()]);
    render(<SitemapLibrary provider={setup.provider} onOpen={() => undefined} />);
    const trigger = await screen.findByRole("button", { name: "Rename Product map" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Rename sitemap" });
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename sitemap" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(setup.records.get("product-map")?.document.name).toBe("Product map");
  });

  it("renames through the dialog and preserves the record identity", async () => {
    const setup = provider([record()]);
    render(<SitemapLibrary provider={setup.provider} onOpen={() => undefined} now={() => "2026-03-01T00:00:00.000Z"} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename Product map" }));
    const dialog = screen.getByRole("dialog", { name: "Rename sitemap" });
    const input = within(dialog).getByRole("textbox", { name: "Sitemap name" });
    fireEvent.input(input, { target: { value: "Launch architecture" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(setup.records.get("product-map")?.document.name).toBe("Launch architecture"));
    expect(setup.records.get("product-map")).toMatchObject({ id: "product-map", updatedAt: "2026-03-01T00:00:00.000Z" });
  });

  it("labels destructive deletion, focuses Cancel, and deletes only after confirmation", async () => {
    const setup = provider([record()]);
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    render(<SitemapLibrary provider={setup.provider} onOpen={() => undefined} />);
    const trigger = await screen.findByRole("button", { name: "Delete Product map" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Delete sitemap" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete sitemap" }));
    await screen.findByRole("heading", { name: "No sitemaps yet" });
    await waitFor(() => expect(screen.getByRole("button", { name: "New sitemap" })).toHaveFocus());
    expect(setup.records.has("product-map")).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});
