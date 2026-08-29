/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { IDBFactory as FDBFactory } from "fake-indexeddb";
import { h } from "preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSequentialIdFactory } from "../../../../shared";
import { createCompositionCatalog } from "../../../../sitemapper/catalog";
import type { SitemapRecord } from "../../../../sitemapper/library";
import { createIndexedDbSitemapProvider } from "../../../../sitemapper/storage/indexeddb/provider";
import { ProductionSitemapperApp } from "../production-sitemapper-app";
import { SitemapperIntegration } from "../sitemapper-integration";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  Element.prototype.scrollIntoView = vi.fn();
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
  }
});
afterEach(cleanup);

const composition = {
  id: "hero-composition",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  document: { schemaVersion: 2 as const, id: "hero-composition", name: "Hero composition", root: [] },
};

describe("production Sitemapper walkthrough", () => {
  it("creates, edits, saves, indexes, and reopens one round-tripped sitemap", async () => {
    const provider = createIndexedDbSitemapProvider({
      idbFactory: new FDBFactory(),
    });
    const catalog = createCompositionCatalog([{
      descriptor: { id: "indexeddb", label: "Browser storage" },
      store: {
        list: async () => [{ id: composition.id, name: composition.document.name, createdAt: composition.createdAt, updatedAt: composition.updatedAt, nodeCount: 0 }],
        get: async (id: string) => id === composition.id
          ? { status: "loaded" as const, record: composition }
          : { status: "not-found" as const, id },
      },
    }]);
    vi.stubGlobal("prompt", vi.fn(() => "Product map"));

    const { container } = render(h(ProductionSitemapperApp, {
      provider,
      catalog,
      idFactory: createSequentialIdFactory("map"),
      pageIdFactory: createSequentialIdFactory("page"),
      now: () => "2026-04-02T00:00:00.000Z",
    }));

    fireEvent.click(await screen.findByRole("button", { name: "New sitemap" }));
    await screen.findByRole("toolbar", { name: "Sitemapper toolbar" });

    const tray = () => within(container.querySelector(".sg-sitemapper-canvas__action-tray") as HTMLElement);
    fireEvent.click(tray().getByRole("button", { name: "Add child" }));
    fireEvent.click(tray().getByRole("button", { name: "Duplicate" }));
    fireEvent.click(tray().getByRole("button", { name: "Delete" }));
    fireEvent.click(tray().getByRole("button", { name: "Add sibling" }));

    fireEvent.click(screen.getByRole("button", { name: "Expand Home" }));
    const movedRow = container.querySelector('[data-sg-tree-node-id="untitled-page-3"]') as HTMLElement;
    fireEvent.click(within(movedRow).getByRole("button", { name: "Move up" }));

    fireEvent.click(screen.getByRole("button", { name: "Choose composition" }));
    const picker = await screen.findByRole("dialog", { name: "Choose a composition" });
    fireEvent.click(await within(picker).findByRole("button", { name: /Assign Hero composition/ }));

    fireEvent.click(screen.getByRole("button", { name: "All sitemaps" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Product map ·/ }));
    await screen.findByRole("toolbar", { name: "Sitemapper toolbar" });

    await waitFor(async () => {
      const loaded = await provider.store.get("product-map-1");
      expect(loaded.status).toBe("loaded");
      if (loaded.status !== "loaded") return;
      expect(loaded.record.document.root[0]?.children.map((node) => node.id)).toEqual([
        "untitled-page-3",
        "untitled-page-1",
      ]);
      expect(loaded.record.document.root[0]?.children[0]?.composition).toEqual({
        providerId: "indexeddb",
        recordId: "hero-composition",
      });
    });
  });

  it("keeps the editor open when the save-before-index transition fails", async () => {
    const record: SitemapRecord = {
      id: "failure-map",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      document: {
        schemaVersion: 1,
        id: "failure-map",
        name: "Failure map",
        root: [{ id: "home", title: "Home", children: [] }],
      },
    };
    const onBack = vi.fn();
    const { container } = render(h(SitemapperIntegration, {
      record,
      store: { put: vi.fn(async () => { throw new Error("disk full"); }) },
      catalog: {
        listCompositions: async () => ({ entries: [], failures: [] }),
        resolveComposition: async () => ({ status: "not-found" as const }),
      },
      onBack,
      idFactory: createSequentialIdFactory("page"),
    }));

    fireEvent.click(within(container.querySelector(".sg-sitemapper-canvas__action-tray") as HTMLElement)
      .getByRole("button", { name: "Add child" }));
    fireEvent.click(screen.getByRole("button", { name: "All sitemaps" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByRole("toolbar", { name: "Sitemapper toolbar" })).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });
});
