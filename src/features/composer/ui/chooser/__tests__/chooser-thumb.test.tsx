import "../../../test-support/cleanup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { createRef } from "preact";
import { ChooserThumb, type ChooserThumbProps } from "../chooser-thumb";
import { ChooserCardGrid } from "../chooser-card-grid";
import { fixtureCatalog, fixtureComponentProvider } from "../../tree/__tests__/fixtures";
import type { ComposerPreviewBridgeOptions } from "../../../preview/bridge";
import { createComponentCatalog } from "../../../../../composer/browser";
import { activeComponentProvider } from "../../../active-pack";
import { LiveAssetReferenceResolver } from "../../../../../assets/references";
import { buildChooserPreviewDocument } from "../chooser-preview-host";

const location = { src: "about:blank", targetOrigin: "https://thumb.test" };
const catalogById = new Map(fixtureCatalog.map((entry) => [entry.id, entry]));
function harness() {
  const instances: { options: ComposerPreviewBridgeOptions; dispose: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn> }[] = [];
  const createBridge: NonNullable<ChooserThumbProps["createBridge"]> = (options) => {
    const dispose = vi.fn();
    const render = vi.fn(() => 0);
    instances.push({ options, dispose, render });
    return { dispose, render, ready: false, terminal: false, revision: 0, updateSession: () => 0, restoreFocus: () => {} };
  };
  return { instances, createBridge };
}
function props(overrides: Partial<ChooserThumbProps> = {}): ChooserThumbProps {
  return { entry: fixtureCatalog[0]!, componentProvider: fixtureComponentProvider, catalogById, scrollerRef: createRef<HTMLUListElement>(), index: 0, location, ...overrides };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ChooserThumb", () => {
  it("renders a detached defaults and placeholder-slot document through its own bridge", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const placeholder = { ...fixtureCatalog[3]!, id: "ui.placeholder-box", source: { module: "@fixtures/placeholder", exportKind: "named" as const, exportName: "Placeholder" } };
    const catalog = new Map([...catalogById, [placeholder.id, placeholder]]);
    const bridge = harness();
    const { container, unmount } = render(<ChooserThumb {...props({ catalogById: catalog, componentProvider: { ...fixtureComponentProvider, catalog: createComponentCatalog({ ...fixtureComponentProvider.manifest, components: [...catalog.values()] }) }, createBridge: bridge.createBridge })} />);
    await waitFor(() => expect(bridge.instances[0]?.render).toHaveBeenCalled());
    const snapshot = bridge.instances[0]!.render.mock.calls[0]![0];
    expect(snapshot.document).toEqual(buildChooserPreviewDocument(fixtureCatalog[0]!, catalog));
    expect(snapshot.document.root[0].slots.left[0].componentId).toBe("ui.placeholder-box");
    expect(snapshot.document.root[0].props).toEqual(fixtureCatalog[0]!.defaults);
    expect(container.firstElementChild).toHaveAttribute("inert");
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("iframe")).toHaveAttribute("tabindex", "-1");
    expect(container.querySelector(".sg-composer-chooser-thumb-stage")).toHaveStyle({ visibility: "hidden" });
    act(() => bridge.instances[0]!.options.onReady?.());
    expect(container.querySelector(".sg-composer-chooser-thumb-stage")).toHaveStyle({ visibility: "visible" });
    expect(screen.queryByText("Loading preview…")).toBeNull();
    unmount();
    expect(bridge.instances[0]!.dispose).toHaveBeenCalledOnce();
  });

  it.each([ ["Actions", 400], ["Typography", 400], ["Media", 400], ["Layout", 720], ["Content", 720] ])("measures actual content width for %s's %ipx viewport", (category, viewport) => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    let resize: (() => void) | undefined;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    const { container } = render(<ChooserThumb {...props({ entry: { ...fixtureCatalog[0]!, category: String(category) } })} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.style.getPropertyValue("--chooser-thumb-scale")).toBe(String(300 / Number(viewport)));
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    act(() => resize?.());
    expect(tile.style.getPropertyValue("--chooser-thumb-scale")).toBe("1");
  });

  it("mounts only near the catalog scroller and disposes each departed frame", async () => {
    let notify: IntersectionObserverCallback = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    const constructor = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) { notify = callback; constructor(options); }
      observe = observe;
      disconnect = disconnect;
    });
    const root = document.createElement("ul");
    const bridge = harness();
    const { container, unmount } = render(<ChooserThumb {...props({ scrollerRef: { current: root }, createBridge: bridge.createBridge })} />);
    await waitFor(() => expect(observe).toHaveBeenCalled());
    expect(constructor).toHaveBeenCalledWith({ root, rootMargin: "160px 0px" });
    expect(container.querySelector("iframe")).toBeNull();
    const update = (isIntersecting: boolean) => act(() => notify([{ target: container.firstElementChild!, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
    update(true);
    await waitFor(() => expect(bridge.instances).toHaveLength(1));
    update(false);
    await waitFor(() => expect(bridge.instances[0]!.dispose).toHaveBeenCalledOnce());
    expect(container.querySelector("iframe")).toBeNull();
    update(true);
    await waitFor(() => expect(bridge.instances).toHaveLength(2));
    unmount();
    expect(bridge.instances[1]!.dispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("caps no-observer frames at four filtered tiles, including after filtering", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const grid = (entries: typeof fixtureCatalog) => <ChooserCardGrid entries={entries} componentProvider={fixtureComponentProvider} catalogById={catalogById} onPreview={() => {}} onConfirm={() => {}} location={location} />;
    const { container, rerender } = render(grid(fixtureCatalog));
    await waitFor(() => expect(container.querySelectorAll("iframe")).toHaveLength(4));
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getAllByText("Preview on focus")).toHaveLength(2);
    rerender(grid(fixtureCatalog.slice(3)));
    await waitFor(() => expect(container.querySelectorAll("iframe")).toHaveLength(3));
  });

  it.each(["renderer", "pack", "frame"])("replaces a %s failure with a fallback and disposes the bridge", async (failure) => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const bridge = harness();
    const { container } = render(<ChooserThumb {...props({ createBridge: bridge.createBridge })} />);
    await waitFor(() => expect(bridge.instances).toHaveLength(1));
    act(() => {
      const instance = bridge.instances[0]!;
      if (failure === "renderer") instance.options.onError?.("Renderer threw", false, 0);
      else if (failure === "pack") instance.options.onRejected?.("pack-mismatch");
      else fireEvent.error(container.querySelector("iframe")!);
    });
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
    expect(bridge.instances[0]!.dispose).toHaveBeenCalledOnce();
  });

  it("contains host-side document construction failures", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const entry = { ...fixtureCatalog[0]! };
    Object.defineProperty(entry, "defaults", { get() { throw new Error("Bad defaults"); } });
    render(<ChooserThumb {...props({ entry })} />);
    await waitFor(() => expect(screen.getByText("Preview unavailable")).toBeInTheDocument());
  });
});


it("retains the named selection button when an iframe fails", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const confirm = vi.fn();
  const { container } = render(<ChooserCardGrid entries={fixtureCatalog.slice(0, 1)} componentProvider={fixtureComponentProvider} catalogById={catalogById} onPreview={() => {}} onConfirm={confirm} location={location} />);
  await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
  fireEvent.error(container.querySelector("iframe")!);
  expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Split Layout", exact: true }));
  expect(confirm).toHaveBeenCalledWith(fixtureCatalog[0]!.id);
});

it("keeps a forty-item catalog bounded while moving the near-visible region", async () => {
  const observers: { callback: IntersectionObserverCallback; element?: Element; disconnect: ReturnType<typeof vi.fn<() => void>> }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    record: (typeof observers)[number];
    constructor(callback: IntersectionObserverCallback) { this.record = { callback, disconnect: vi.fn() }; observers.push(this.record); }
    observe(element: Element) { this.record.element = element; }
    disconnect() { this.record.disconnect(); }
  });
  const entries = Array.from({ length: 40 }, (_, index) => ({ ...fixtureCatalog[3]!, id: `test.tile-${index}`, title: `Tile ${index}`, source: { module: `@fixtures/tile-${index}`, exportKind: "named" as const, exportName: "Tile" } }));
  const provider = { ...fixtureComponentProvider, catalog: createComponentCatalog({ ...fixtureComponentProvider.manifest, components: entries }) };
  const { container, unmount } = render(<ChooserCardGrid entries={entries} componentProvider={provider} catalogById={new Map(entries.map((entry) => [entry.id, entry]))} onPreview={() => {}} onConfirm={() => {}} location={location} />);
  await waitFor(() => expect(observers).toHaveLength(40));
  const showRegion = (start: number) => act(() => observers.forEach(({ callback, element }, index) => callback([{ target: element!, isIntersecting: index >= start && index < start + 4 } as IntersectionObserverEntry], {} as IntersectionObserver)));
  showRegion(0);
  await waitFor(() => expect(container.querySelectorAll("iframe")).toHaveLength(4));
  showRegion(20);
  await waitFor(() => expect(container.querySelectorAll("iframe")).toHaveLength(4));
  expect(container.querySelector('[title="Tile 0 thumbnail"]')).toBeNull();
  expect(container.querySelector('[title="Tile 20 thumbnail"]')).not.toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(40);
  unmount();
  expect(observers.every(({ disconnect }) => disconnect.mock.calls.length === 1)).toBe(true);
});


it("turns rejected media resolution into a thumbnail fallback without an unhandled promise", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(LiveAssetReferenceResolver.prototype, "resolve").mockRejectedValue(new Error("Media offline"));
  const original = activeComponentProvider.manifest.components.find((entry) => entry.id === "ui.cta-button")!;
  const entry = { ...original, defaults: { ...original.defaults, href: "/uploaded-assets/asset-missing" } };
  const bridge = harness();
  render(<ChooserThumb {...props({ entry, componentProvider: activeComponentProvider, createBridge: bridge.createBridge })} />);
  await waitFor(() => expect(screen.getByText("Preview unavailable")).toBeInTheDocument());
  expect(bridge.instances[0]!.render).not.toHaveBeenCalled();
  await waitFor(() => expect(bridge.instances[0]!.dispose).toHaveBeenCalledOnce());
});


it("keeps a measured safe scale without ResizeObserver and updates on resize", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("ResizeObserver", undefined);
  const measure = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(240);
  const { container } = render(<ChooserThumb {...props()} />);
  const tile = container.firstElementChild as HTMLElement;
  expect(tile.style.getPropertyValue("--chooser-thumb-scale")).toBe(String(240 / 720));
  measure.mockReturnValue(360);
  fireEvent(window, new Event("resize"));
  expect(tile.style.getPropertyValue("--chooser-thumb-scale")).toBe("0.5");
});

it("bounds loading when a frame never handshakes", () => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", undefined);
  const bridge = harness();
  const { container } = render(<ChooserThumb {...props({ createBridge: bridge.createBridge })} />);
  expect(screen.getByText("Loading preview…")).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(15000); });
  expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  expect(container.querySelector("iframe")).toBeNull();
  expect(bridge.instances[0]!.dispose).toHaveBeenCalledOnce();
});
