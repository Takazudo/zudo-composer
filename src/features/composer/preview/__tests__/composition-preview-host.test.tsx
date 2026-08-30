import { act } from "preact/test-utils";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeComponentProvider } from "../../active-pack";
import { CompositionPreviewHost } from "../composition-preview-host";

const component = activeComponentProvider.manifest.components[0]!;
const previewDocument = (name: string) => ({ schemaVersion: 2 as const, id: `preview-${name}`, name, root: [{ id: "node", componentId: component.id, componentVersion: component.schemaVersion, props: { ...component.defaults }, slots: Object.fromEntries(component.slots.map((slot) => [slot.id, []])) }] });

describe("CompositionPreviewHost", () => {
  afterEach(() => cleanup());

  it("preserves iframe title/sandbox and the same iframe while enlarged, then restores trigger focus on close", () => {
    const createBridge = vi.fn(() => ({ render: vi.fn(), updateSession: vi.fn(), restoreFocus: vi.fn(), dispose: vi.fn(), ready: false, terminal: false, revision: 0 }));
    const { container } = render(<CompositionPreviewHost componentProvider={activeComponentProvider} document={previewDocument("one")} title="Current Entry preview" createBridge={createBridge as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} />);
    const frame = container.querySelector("iframe")!;
    expect(frame).toHaveAttribute("title", "Current Entry preview");
    expect(frame).toHaveAttribute("sandbox", "allow-same-origin allow-scripts");
    const enlarge = screen.getByRole("button", { name: "Enlarge Current Entry preview" });
    fireEvent.click(enlarge);
    const dialog = screen.getByRole("dialog", { name: "Current Entry preview, full screen" });
    expect(dialog.querySelector("iframe")).toBe(frame);
    const close = screen.getByRole("button", { name: "Close full-screen Current Entry preview" });
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(enlarge);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps only the newest document for bridge replay and reports current/error callbacks", () => {
    let options!: Parameters<NonNullable<Parameters<typeof CompositionPreviewHost>[0]["createBridge"]>>[0];
    const renderSnapshot = vi.fn();
    const createBridge = vi.fn((nextOptions) => {
      options = nextOptions;
      return { render: renderSnapshot, updateSession: vi.fn(), restoreFocus: vi.fn(), dispose: vi.fn(), ready: false, terminal: false, revision: 0 };
    });
    const current = vi.fn(); const error = vi.fn();
    const first = previewDocument("first"); const newest = previewDocument("newest");
    const location = { src: "/composer/preview", targetOrigin: "https://example.test" };
    const hostWindow = { addEventListener() {}, removeEventListener() {} };
    const view = render(<CompositionPreviewHost componentProvider={activeComponentProvider} document={first} onCurrent={current} onError={error} createBridge={createBridge as never} location={location} hostWindow={hostWindow} />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Composition preview" }));
    const frame = screen.getByTitle("Composition preview");
    const latestCurrent = vi.fn(); const latestError = vi.fn();
    view.rerender(<CompositionPreviewHost componentProvider={activeComponentProvider} document={newest} onCurrent={latestCurrent} onError={latestError} createBridge={createBridge as never} location={location} hostWindow={hostWindow} />);
    expect(screen.getByRole("dialog").querySelector("iframe")).toBe(frame);
    expect(renderSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ document: newest }), expect.objectContaining({ mode: "preview" }));
    act(() => options.onReady?.());
    act(() => options.onError?.("renderer failed", true, 2));
    expect(createBridge).toHaveBeenCalledOnce();
    expect(current).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(latestCurrent).toHaveBeenCalledOnce();
    expect(latestError).toHaveBeenCalledWith("renderer failed");
  });
});
