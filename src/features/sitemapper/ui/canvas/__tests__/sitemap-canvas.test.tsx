/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SitemapDocument, SitemapNode } from "../../../../../sitemapper/model";
import { SITEMAP_SCHEMA_VERSION } from "../../../../../sitemapper/model";
import type { PageSourceLabel } from "../page-source";
import SitemapCanvas, { canvasStageMargin, clampCanvasZoom, fitCanvasZoom, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from "../sitemap-canvas";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  Element.prototype.scrollIntoView = vi.fn();
});

const page = (id: string, children: SitemapNode[] = []): SitemapNode => ({ id, title: id, source: { kind: "unassigned" }, children });
const doc = (root: SitemapNode[] = [page("Home", [page("Child")])]): SitemapDocument => ({
  schemaVersion: SITEMAP_SCHEMA_VERSION, navigation: { primary: [], footer: [] },
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
  it.each(["cluster", "outline"] as const)("settles an indefinite padded %s scroller within two observer passes", async (layoutPreference) => {
    let notify: () => void = () => {};
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notify = callback; }
      observe(): void {}
      disconnect(): void {}
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const { container } = render(<SitemapCanvas {...props()} layoutPreference={layoutPreference} />);
    const scroller = container.querySelector<HTMLElement>(".sg-sitemapper-canvas__scroll")!;
    const viewport = container.querySelector<HTMLElement>(".sg-sitemapper-canvas__viewport")!;
    const stage = container.querySelector<HTMLElement>(".sg-sitemapper-canvas__stage")!;
    scroller.style.padding = "16px";
    Object.defineProperties(scroller, {
      clientWidth: { get: () => 832 },
      // Model the browser's content-derived height, including its padding.
      clientHeight: { get: () => Number.parseFloat(viewport.style.height) + 32 },
    });
    const sample = () => ({ height: viewport.style.height, top: stage.style.top, width: stage.style.width });
    const resize = async () => {
      await act(() => {
        notify();
        notify(); // Coalesce a burst of node/scroller notifications.
        expect(frames).toHaveLength(1);
        frames.shift()!(0);
      });
    };
    await resize();
    await resize();
    const settled = sample();
    for (let pass = 0; pass < 4; pass += 1) {
      await resize();
      expect(sample()).toEqual(settled);
    }
    expect(viewport.style.width).toBe("800px");
    expect(stage.style.top).toBe("0px");
  });

  it("uses available content dimensions for Fit and includes the stage margin when centering", async () => {
    let notify: () => void = () => {};
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notify = callback; }
      observe(): void {}
      disconnect(): void {}
    });
    const callbacks = { ...props(), selectedId: "Child", zoom: 0.5, layoutPreference: "cluster" as const };
    const { container } = render(<SitemapCanvas {...callbacks} />);
    const scroller = container.querySelector<HTMLElement>(".sg-sitemapper-canvas__scroll")!;
    scroller.style.padding = "16px";
    Object.defineProperties(scroller, { clientWidth: { value: 832 }, clientHeight: { value: 132 } });
    await act(() => {
      notify();
      frames.shift()!(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Fit", exact: true }));
    // The two-row stage is 224px tall: 100 available pixels fit at 45%,
    // whereas the 132px padding box would incorrectly choose 59%.
    expect(callbacks.onZoomChange).toHaveBeenCalledWith(0.45);
    const child = container.querySelectorAll<HTMLElement>(".sg-sitemapper-node-wrap")[1]!;
    Object.defineProperties(child, {
      offsetLeft: { value: 700 }, offsetTop: { value: 100 },
      offsetWidth: { value: 200 }, offsetHeight: { value: 56 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Center on selection" }));
    expect(scroller.scrollLeft).toBe(200);
    expect(scroller.scrollTop).toBe(14);
  });

  it("offers Add child page for a Mapping-sourced canvas node", async () => {
    const value = doc(); value.root[0]!.source = { kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: "articles" }, route: { kind: "entry-field", fieldId: "slug" } };
    const callbacks = props(value); render(<SitemapCanvas {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Home" }));
    const add = await screen.findByRole("menuitem", { name: "Add child page" });
    expect(add).not.toHaveAttribute("aria-disabled", "true"); fireEvent.click(add);
    expect(callbacks.onAddChild).toHaveBeenCalledWith("Home");
  });
  it("reveals a selection once, not again on every later layout", async () => {
    // A layout recomputation is a measurement settling, not a request to
    // scroll. Re-asserting the reveal on each one scrolled the selected node's
    // ancestors repeatedly, which pulls the page back under whoever is working
    // in it and moves every other row on the route while it happens.
    const reveal = vi.mocked(Element.prototype.scrollIntoView);
    reveal.mockClear();
    const callbacks = { ...props(), selectedId: "Home" };
    const { rerender } = render(<SitemapCanvas {...callbacks} />);
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1));

    // A re-render that changes the measured geometry, and so the layout, but
    // not the selection.
    rerender(<SitemapCanvas {...callbacks} zoom={1.5} />);
    rerender(<SitemapCanvas {...callbacks} zoom={2} />);
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1));

    // Choosing a different node is a request, and is honoured.
    rerender(<SitemapCanvas {...callbacks} selectedId="Child" />);
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(2));
  });

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

  it("fits against the limiting viewport dimension, including tall maps", () => {
    expect(fitCanvasZoom(1000, 500, 1000, 2000)).toBe(0.4);
    expect(fitCanvasZoom(500, 1000, 1000, 500)).toBe(0.5);
    expect(fitCanvasZoom(2000, 2000, 1000, 1000)).toBe(MAX_CANVAS_ZOOM);
    expect(canvasStageMargin(1000, 500, 1)).toBe(250);
    expect(canvasStageMargin(500, 1000, 0.5)).toBe(0);
    expect(canvasStageMargin(800, 100, 1)).toBe(350);
    expect(canvasStageMargin(1000, 500, 0.4)).toBe(400);
    expect(canvasStageMargin(1000, 500, 0.5)).toBe(375);
    expect(canvasStageMargin(1000, 500, MAX_CANVAS_ZOOM)).toBe(125);
  });

  it("exposes explicit layout choices while keeping Auto as the responsive default", async () => {
    const callbacks = { ...props(), layoutPreference: "auto" as const, onLayoutPreferenceChange: vi.fn() };
    render(<SitemapCanvas {...callbacks} />);
    expect(screen.getByRole("radiogroup", { name: "Layout" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Outline" }));
    expect(callbacks.onLayoutPreferenceChange).toHaveBeenCalledWith("outline");
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
