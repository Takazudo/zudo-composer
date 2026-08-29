import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SitemapDocument, SitemapNode } from "../../../../../sitemapper/model";
import { SITEMAP_SCHEMA_VERSION } from "../../../../../sitemapper/model";
import SitemapCanvas from "../sitemap-canvas";

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

const page = (id: string, children: SitemapNode[] = []): SitemapNode => ({ id, title: id, children });
const doc = (root: SitemapNode[] = [page("Home", [page("Child")])]): SitemapDocument => ({
  schemaVersion: SITEMAP_SCHEMA_VERSION,
  id: "canvas-test",
  name: "Canvas test",
  root,
});

function props(document = doc()) {
  return {
    document,
    selectedId: null,
    onSelect: vi.fn(),
    onAddChild: vi.fn(),
    onAddSibling: vi.fn(),
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

  it("renders real node controls and a non-interactive connector overlay", () => {
    render(<SitemapCanvas {...props()} />);
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Child" })).toBeInTheDocument();
    const svg = document.querySelector(".sg-sitemapper-connectors");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Actions for Home" })).toHaveAttribute("data-sg-depth", "0");
  });

  it("dispatches controlled selection and node actions", () => {
    const callbacks = props();
    render(<SitemapCanvas {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Child" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Child" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add child" }));
    expect(callbacks.onSelect).toHaveBeenCalledWith("Child");
    expect(callbacks.onAddChild).toHaveBeenCalledWith("Child");
  });

  it("shows all selected narrow editing actions and explains protected root actions", () => {
    render(<SitemapCanvas {...props()} selectedId="Home" />);
    const tray = screen.getByRole("region", { name: "Sitemap canvas" })
      .querySelector(".sg-sitemapper-canvas__action-tray")!;
    expect(tray.querySelectorAll("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Add sibling" })).toBeDisabled();
    expect(screen.getByText("The root page cannot have a sibling.")).toBeInTheDocument();
  });

  it("renders the specified empty state without an SVG", () => {
    const callbacks = props(doc([]));
    const { container } = render(<SitemapCanvas {...callbacks} />);
    expect(screen.getByRole("heading", { name: "No sitemap yet" })).toBeInTheDocument();
    expect(screen.getByText("Create a Home page to start mapping this site.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Home page" }));
    expect(callbacks.onCreateRoot).toHaveBeenCalledOnce();
    expect(container.querySelector("svg")).toBeNull();
  });
});
