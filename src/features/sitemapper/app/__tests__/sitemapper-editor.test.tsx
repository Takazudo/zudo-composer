/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChromeContext, createChromeStore } from "../../../../app/chrome-context";
import { createSequentialIdFactory } from "../../../../shared";
import type { CompositionCatalog } from "../../../../sitemapper/catalog";
import type { SitemapRecord, SitemapStore } from "../../../../sitemapper/library";
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
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(cleanup);

const catalog: Pick<CompositionCatalog, "listCompositions" | "resolveComposition"> = {
  listCompositions: async () => ({ entries: [], failures: [] }),
  resolveComposition: async () => ({ status: "not-found" }),
};

function record(): SitemapRecord {
  return {
    id: "walk-map",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    document: {
      schemaVersion: 2,
      id: "walk-map",
      name: "Walk map",
      root: [{
        id: "home",
        title: "Home",
        source: { kind: "unassigned" },
        children: [
          { id: "about", title: "About", source: { kind: "unassigned" }, children: [] },
          { id: "contact", title: "Contact", source: { kind: "unassigned" }, children: [] },
        ],
      }],
    },
  };
}

type EditorStore = Pick<SitemapStore, "put" | "delete">;

interface Harness {
  store: EditorStore;
  chrome: ReturnType<typeof createChromeStore>;
  navigate: (href: string) => void;
}

function fakeStore(put: EditorStore["put"] = async () => {}) {
  return { put: vi.fn(put), delete: vi.fn<EditorStore["delete"]>(async () => true) };
}

function renderEditor(overrides: Partial<Harness> = {}, initialPageId?: string) {
  const store = (overrides.store ?? fakeStore()) as ReturnType<typeof fakeStore>;
  const chrome = overrides.chrome ?? createChromeStore();
  const navigate = vi.fn(overrides.navigate ?? (() => {}));
  const view = render(
    <ChromeContext.Provider value={chrome}>
      <SitemapperIntegration
        record={record()}
        store={store}
        catalog={catalog}
        initialPageId={initialPageId}
        navigate={navigate}
        idFactory={createSequentialIdFactory("page")}
        recordIdFactory={createSequentialIdFactory("map")}
        now={() => "2026-04-02T00:00:00.000Z"}
      />
    </ChromeContext.Provider>,
  );
  return { ...view, store, chrome, navigate };
}

/** The toolbar owns an "Add page" button and so does the tree's terminal row. */
function toolbar(): HTMLElement {
  return document.querySelector(".cms-editor__toolbar") as HTMLElement;
}

describe("Sitemapper editor chrome", () => {
  it("publishes its breadcrumb and save state to the application chrome", async () => {
    const { chrome } = renderEditor();

    await waitFor(() => expect(chrome.getSnapshot().breadcrumb).toEqual([
      { label: "Sitemaps", href: "/sitemapper" },
      { label: "Walk map" },
    ]));
    expect(chrome.getSnapshot().editorStatus).toEqual({ state: "saved" });

    fireEvent.click(within(toolbar()).getByRole("button", { name: "Add page" }));
    await waitFor(() => expect(chrome.getSnapshot().editorStatus?.state).not.toBe("saved"));
  });

  it("arms the shared unload guard only once the record is dirty", async () => {
    const listen = vi.spyOn(window, "addEventListener");
    // A write that never settles keeps the editor in its dirty state.
    const store = fakeStore(() => new Promise<void>(() => {}));
    renderEditor({ store });

    expect(listen.mock.calls.some(([type]) => type === "beforeunload")).toBe(false);
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Add page" }));
    await waitFor(() => expect(listen.mock.calls.some(([type]) => type === "beforeunload")).toBe(true));
    listen.mockRestore();
  });

  it("selects the page a deep link names and keeps the address bar on the selection", async () => {
    renderEditor({}, "contact");
    await waitFor(() => expect(window.location.search).toContain("page=contact"));
    expect(screen.getByRole("treeitem", { name: /Contact/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("treeitem", { name: /About/ }));
    await waitFor(() => expect(window.location.search).toContain("page=about"));
  });

  it("renames a page through the shared dialog rather than a native prompt", async () => {
    const prompt = vi.fn();
    vi.stubGlobal("prompt", prompt);
    renderEditor({}, "about");

    fireEvent.click(screen.getByRole("button", { name: "More actions for About" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const dialog = screen.getByRole("dialog", { name: "Rename page" });
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Page title" }), { target: { value: "About us" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));

    expect(await screen.findByRole("treeitem", { name: /About us/ })).toBeInTheDocument();
    expect(prompt).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("confirms a page deletion, counting what goes with it", async () => {
    const confirmSpy = vi.fn();
    vi.stubGlobal("confirm", confirmSpy);
    renderEditor({}, "home");

    fireEvent.click(screen.getByRole("button", { name: "More actions for About" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete About?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("treeitem", { name: /About/ })).toBeNull());
    expect(confirmSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("adds a page at the index the outline's own insert row names", async () => {
    const { store } = renderEditor();
    const addRow = document.querySelector(".cms-tree-cat > .cms-tree-children > .cms-tree-add-wrap .cms-tree-add");
    fireEvent.click(addRow as HTMLElement);
    const input = document.querySelector(".cms-tree-add-wrap .cms-tree-inline input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Careers" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByRole("treeitem", { name: /Careers/ })).toBeInTheDocument();
    await waitFor(() => expect(store.put).toHaveBeenCalled());
    const saved = store.put.mock.calls.at(-1)![0] as SitemapRecord;
    expect(saved.document.root[0]!.children.map((child) => child.title)).toEqual(["About", "Contact", "Careers"]);
  });

  it("deletes the whole Sitemap through the overflow menu and leaves for the library", async () => {
    const { store, navigate } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "More sitemap actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Delete Walk map?" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(store.delete).toHaveBeenCalledWith("walk-map"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sitemapper"));
  });
});
