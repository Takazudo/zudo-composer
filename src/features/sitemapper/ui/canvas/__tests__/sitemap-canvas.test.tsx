/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SitemapDocument, SitemapNode } from "../../../../../sitemapper/model";
import { SITEMAP_SCHEMA_VERSION } from "../../../../../sitemapper/model";
import type { PageSourceLabel } from "../page-source";
import SitemapCanvas, { clampCanvasZoom, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from "../sitemap-canvas";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  Element.prototype.scrollIntoView = vi.fn();
});

const page = (id: string, children: SitemapNode[] = []): SitemapNode => ({ id, title: id, source: { kind: "unassigned" }, children });
const doc = (root: SitemapNode[] = [page("Home", [page("Child")])]): SitemapDocument => ({
  schemaVersion: SITEMAP_SCHEMA_VERSION,
  id: "canvas-test",
  name: "Canvas test",
  root,
});

function props(document = doc(), sources: ReadonlyMap<string, PageSourceLabel> = new Map()) {
  return {
    document,
    routes: new Map([["Home", "/"], ["Child", "/child"]]),
    sources,
    selectedId: null,
    zoom: 1,
    onZoomChange: vi.fn(),
    onSelect: vi.fn(),
    onAddChild: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onCreateRoot: vi.fn(),
  };
}

describe("SitemapCanvas", () => {
  it("follows the page media seam while measuring geometry from the canvas", async () => {
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const media = {
      matches: true,
      media: "(min-width: 64rem)",
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener),
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener),
    } as unknown as MediaQueryList;
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal("matchMedia", matchMedia);
    const { container, unmount } = render(<SitemapCanvas {...props()} />);

    await waitFor(() => expect(container.querySelector(".sg-sitemapper-canvas__stage"))
      .toHaveAttribute("data-sg-layout", "cluster"));
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 64rem)");

    Object.defineProperty(media, "matches", { configurable: true, value: false });
    for (const listener of listeners) {
      if (typeof listener === "function") listener.call(media, new Event("change"));
      else listener.handleEvent(new Event("change"));
    }
    await waitFor(() => expect(container.querySelector(".sg-sitemapper-canvas__stage"))
      .toHaveAttribute("data-sg-layout", "outline"));

    unmount();
    expect(listeners.size).toBe(0);
    matchMedia.mockRestore();
  });

  it("puts each node's route and source on the node, and Unassigned where there is none", () => {
    const sources = new Map<string, PageSourceLabel>([["Home", { kind: "composition", name: "Landing hero" }]]);
    const { container } = render(<SitemapCanvas {...props(doc(), sources)} />);
    expect(screen.getByText("Landing hero")).toBeInTheDocument();
    expect(screen.getByText("/child")).toBeInTheDocument();
    // The legend carries the same three words, so the chip is read off the node.
    expect(container.querySelectorAll(".sg-sitemapper-node__chip")).toHaveLength(1);
    expect(container.querySelector(".sg-sitemapper-node__chip")).toHaveTextContent("Unassigned");
    expect(container.querySelector(".sg-sitemapper-connectors")).toHaveAttribute("aria-hidden", "true");
  });

  it("dispatches controlled selection and node actions through the shared menu", () => {
    const callbacks = props();
    render(<SitemapCanvas {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: /^Child/ }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Child" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add child page" }));
    expect(callbacks.onSelect).toHaveBeenCalledWith("Child");
    expect(callbacks.onAddChild).toHaveBeenCalledWith("Child");
  });

  it("keeps the root page out of the destructive menu items", () => {
    render(<SitemapCanvas {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Home" }));
    const menu = screen.getByRole("menu", { name: "Home actions" });
    expect(menu.querySelector('[role="menuitem"][disabled]')).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeDisabled();
  });

  it("dismisses a node menu on Escape", () => {
    render(<SitemapCanvas {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Child" }));
    const menu = screen.getByRole("menu", { name: "Child actions" });
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Child actions" })).toBeNull();
  });

  it("clamps zoom to the canvas range", () => {
    expect(clampCanvasZoom(5)).toBe(MAX_CANVAS_ZOOM);
    expect(clampCanvasZoom(0)).toBe(MIN_CANVAS_ZOOM);
    expect(clampCanvasZoom(0.7549)).toBe(0.75);
  });

  it("wires Create Home page on an empty document", () => {
    const callbacks = props(doc([]));
    const { container } = render(<SitemapCanvas {...callbacks} />);
    expect(screen.getByText("No pages yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Home page" }));
    expect(callbacks.onCreateRoot).toHaveBeenCalledOnce();
    expect(container.querySelector(".sg-sitemapper-connectors")).toBeNull();
  });
});
