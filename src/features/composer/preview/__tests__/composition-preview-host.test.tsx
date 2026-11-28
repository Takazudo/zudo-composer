import { signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle } from "../../../../test/render";
import { describe, expect, it, vi } from "vitest";
import { activeComponentProvider } from "../../active-pack";
import { CompositionPreviewHost } from "../composition-preview-host";

const component = activeComponentProvider.manifest.components[0]!;
const previewDocument = (name: string) => ({ schemaVersion: 2 as const, id: `preview-${name}`, name, root: [{ id: "node", componentId: component.id, componentVersion: component.schemaVersion, props: { ...component.defaults }, slots: Object.fromEntries(component.slots.map((slot) => [slot.id, []])) }] });

describe("CompositionPreviewHost", () => {
  it("preserves iframe title/sandbox and the same iframe while enlarged, then restores trigger focus on close", async () => {
    const createBridge = vi.fn(() => ({ render: vi.fn(), updateSession: vi.fn(), restoreFocus: vi.fn(), dispose: vi.fn(), ready: false, terminal: false, revision: 0 }));
    const { container } = render(<CompositionPreviewHost componentProvider={activeComponentProvider} document={previewDocument("one")} title="Current Entry preview" createBridge={createBridge as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} />);
    const frame = container.querySelector("iframe")!;
    expect(frame).toHaveAttribute("title", "Current Entry preview");
    expect(frame).toHaveAttribute("sandbox", "allow-same-origin allow-scripts");
    const enlarge = screen.getByRole("button", { name: "Enlarge Current Entry preview" });
    fireEvent.click(enlarge);
    await settle();
    const dialog = screen.getByRole("dialog", { name: "Current Entry preview, full screen" });
    expect(dialog.querySelector("iframe")).toBe(frame);
    const close = screen.getByRole("button", { name: "Close full-screen Current Entry preview" });
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(enlarge);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps only the newest document for bridge replay and reports current/error callbacks", async () => {
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
    const documentValue = signal(first);
    const onCurrent = signal<() => void>(current); const onError = signal<(message: string) => void>(error);
    render(<CompositionPreviewHost componentProvider={activeComponentProvider} document={documentValue} onCurrent={onCurrent} onError={onError} createBridge={createBridge as never} location={location} hostWindow={hostWindow} />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Composition preview" }));
    await settle();
    const frame = screen.getByTitle("Composition preview");
    const latestCurrent = vi.fn(); const latestError = vi.fn();
    documentValue.value = newest; onCurrent.value = latestCurrent; onError.value = latestError;
    await settle();
    expect(screen.getByRole("dialog").querySelector("iframe")).toBe(frame);
    expect(renderSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ document: newest }), expect.objectContaining({ mode: "preview" }));
    options.onReady?.(); await settle();
    options.onError?.("renderer failed", true, 2); await settle();
    expect(createBridge).toHaveBeenCalledOnce();
    expect(current).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(latestCurrent).toHaveBeenCalledOnce();
    expect(latestError).toHaveBeenCalledWith("renderer failed");
  });

  it("reports current when an already-ready bridge accepts a new render", async () => {
    const renderSnapshot = vi.fn();
    const createBridge = vi.fn(() => ({
      render: renderSnapshot,
      updateSession: vi.fn(),
      restoreFocus: vi.fn(),
      dispose: vi.fn(),
      ready: true,
      terminal: false,
      revision: 0,
    }));
    const current = vi.fn();
    const location = { src: "/composer/preview", targetOrigin: "https://example.test" };
    const hostWindow = { addEventListener() {}, removeEventListener() {} };
    const documentValue = signal(previewDocument("first"));
    render(<CompositionPreviewHost componentProvider={activeComponentProvider} document={documentValue} onCurrent={current} createBridge={createBridge as never} location={location} hostWindow={hostWindow} />);
    await settle();

    expect(current).toHaveBeenCalledOnce();
    documentValue.value = previewDocument("second");
    await settle();

    expect(renderSnapshot).toHaveBeenCalledTimes(2);
    expect(current).toHaveBeenCalledTimes(2);
  });

  it("relays an already-resolved linked snapshot without projecting it to local-only data", async () => {
    const renderSnapshot = vi.fn();
    const createBridge = vi.fn(() => ({
      render: renderSnapshot,
      updateSession: vi.fn(),
      restoreFocus: vi.fn(),
      dispose: vi.fn(),
      ready: false,
      terminal: false,
      revision: 0,
    }));
    const local = previewDocument("consumer");
    const source = previewDocument("source");
    const snapshot = {
      document: local,
      localRecordId: "consumer",
      linked: {
        sourceRecordId: "source",
        sourceDocument: source,
        outlet: { id: "main", label: "Main", target: { parentId: "node", slotId: component.slots[0]?.id ?? "children" } },
      },
    };

    render(<CompositionPreviewHost componentProvider={activeComponentProvider} document={null} snapshot={snapshot} createBridge={createBridge as never} location={{ src: "/composer/preview", targetOrigin: "https://example.test" }} hostWindow={{ addEventListener() {}, removeEventListener() {} }} />);
    await settle();

    expect(renderSnapshot).toHaveBeenCalledWith(snapshot, expect.objectContaining({ mode: "preview" }));
  });
});
