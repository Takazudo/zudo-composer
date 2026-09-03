/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { IDBFactory as FDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSequentialIdFactory } from "../../../../shared";
import { createCompositionCatalog } from "../../../../sitemapper/catalog";
import { createIndexedDbSitemapProvider } from "../../../../sitemapper/storage/indexeddb/provider";
import { ProductionSitemapperApp } from "../production-sitemapper-app";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(cleanup);

const composition = {
  id: "hero-composition",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  document: { schemaVersion: 2 as const, id: "hero-composition", name: "Hero composition", root: [] },
};

function catalog() {
  return createCompositionCatalog([{
    descriptor: { id: "indexeddb", label: "Browser storage" },
    store: {
      list: async () => [{ id: composition.id, name: composition.document.name, createdAt: composition.createdAt, updatedAt: composition.updatedAt, nodeCount: 0 }],
      get: async (id: string) => id === composition.id
        ? { status: "loaded" as const, record: composition }
        : { status: "not-found" as const, id },
    },
  }]);
}

describe("production Sitemapper walkthrough", () => {
  it("creates a sitemap, then reopens it from the deep link the library handed out", async () => {
    const provider = createIndexedDbSitemapProvider({ idbFactory: new FDBFactory() });
    const navigate = vi.fn();
    const view = render(
      <ProductionSitemapperApp
        provider={provider}
        catalog={catalog()}
        idFactory={createSequentialIdFactory("map")}
        pageIdFactory={createSequentialIdFactory("page")}
        now={() => "2026-04-02T00:00:00.000Z"}
        navigate={navigate}
        location={{ pathname: "/sitemapper", search: "" }}
      />,
    );

    // A real IndexedDB provider under a loaded suite can take well over the
    // default second to finish initializing.
    fireEvent.click(await screen.findByRole("button", { name: "Create your first sitemap" }, { timeout: 10_000 }));
    const createDialog = screen.getByRole("dialog", { name: "Create sitemap" });
    fireEvent.input(within(createDialog).getByRole("textbox", { name: "Sitemap name" }), { target: { value: "Product map" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create sitemap" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sitemapper?sitemap=product-map-1"));

    // The link the library produced is the only state the editor needs.
    view.rerender(
      <ProductionSitemapperApp
        provider={provider}
        catalog={catalog()}
        pageIdFactory={createSequentialIdFactory("page")}
        now={() => "2026-04-02T00:00:00.000Z"}
        navigate={navigate}
        location={{ pathname: "/sitemapper", search: "?sitemap=product-map-1" }}
      />,
    );

    expect(await screen.findByRole("textbox", { name: "Sitemap name" }, { timeout: 10_000 })).toHaveValue("Product map");
    expect(screen.getByRole("tree", { name: "Pages" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /Home/ })).toBeInTheDocument();
  });

  it("adds, assigns and persists a page, and keeps the URL on the selected one", async () => {
    const provider = createIndexedDbSitemapProvider({ idbFactory: new FDBFactory() });
    await provider.store.put({
      id: "walk-map",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      document: {
        schemaVersion: 2,
        id: "walk-map",
        name: "Walk map",
        root: [{ id: "home", title: "Home", source: { kind: "unassigned" }, children: [] }],
      },
    });

    render(
      <ProductionSitemapperApp
        provider={provider}
        catalog={catalog()}
        pageIdFactory={createSequentialIdFactory("page")}
        now={() => "2026-04-02T00:00:00.000Z"}
        navigate={vi.fn()}
        location={{ pathname: "/sitemapper", search: "?sitemap=walk-map" }}
      />,
    );

    await screen.findByRole("tree", { name: "Pages" }, { timeout: 10_000 });
    // The tree's terminal row is called "Add page" too; this is the toolbar's.
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Pane" }).closest(".cms-editor__toolbar")!)
      .getByRole("button", { name: "Add page" }));
    const added = await screen.findByRole("treeitem", { name: /Untitled page/ });
    expect(added).toBeInTheDocument();
    expect(window.location.search).toContain("page=untitled-page-1");

    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Page source type" })).getByRole("radio", { name: "Composition" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose composition…" }));
    const picker = await screen.findByRole("dialog", { name: "Choose a composition" });
    fireEvent.click(await within(picker).findByRole("button", { name: /Assign Hero composition/ }));

    await waitFor(async () => {
      const loaded = await provider.store.get("walk-map");
      expect(loaded.status).toBe("loaded");
      if (loaded.status !== "loaded") return;
      expect(loaded.record.document.root[0]?.children[0]?.source).toEqual({
        kind: "composition",
        ref: { providerId: "indexeddb", recordId: "hero-composition" },
      });
    });
  });

  it("reports a sitemap that is gone rather than opening an empty editor", async () => {
    const provider = createIndexedDbSitemapProvider({ idbFactory: new FDBFactory() });
    const navigate = vi.fn();
    render(
      <ProductionSitemapperApp
        provider={provider}
        catalog={catalog()}
        navigate={navigate}
        location={{ pathname: "/sitemapper", search: "?sitemap=missing-map" }}
      />,
    );

    expect(await screen.findByText(/no longer exists/, undefined, { timeout: 10_000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Sitemaps" }));
    expect(navigate).toHaveBeenCalledWith("/sitemapper");
  });

  it("reports a malformed deep link on the library rather than guessing", async () => {
    const provider = createIndexedDbSitemapProvider({ idbFactory: new FDBFactory() });
    render(
      <ProductionSitemapperApp
        provider={provider}
        catalog={catalog()}
        navigate={vi.fn()}
        location={{ pathname: "/sitemapper", search: "?sitemap=..%2Fetc" }}
      />,
    );

    expect(await screen.findByText("The Sitemap id is malformed.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "New sitemap" }, { timeout: 10_000 })).toBeInTheDocument();
  });
});
