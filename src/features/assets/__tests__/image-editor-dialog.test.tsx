import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DECODED_PIXELS, MAX_ENCODED_BYTES } from "@zudo-composer/image-editor";
import { ImageEditorDialog } from "../image-editor-dialog";
import type { AssetSummary } from "../../../assets";

type MockEditorProps = {
  mimeType: string;
  onSave(blob: Blob, mode: "replace" | "copy"): unknown;
  onSavingChange?: (saving: boolean) => void;
  onCancel(): void;
};

vi.mock("@zudo-composer/image-editor/ui", () => ({
  ImageEditor: (props: MockEditorProps) => {
    return <div data-testid="editor"><button type="button" onClick={() => void props.onSave(new Blob(["full export"], { type: props.mimeType }), "replace")}>Save</button><button type="button" onClick={() => props.onSavingChange?.(true)}>Begin saving</button><button type="button" onClick={() => props.onSavingChange?.(false)}>Finish saving</button><button type="button" onClick={props.onCancel}>Cancel</button></div>;
  },
}));

function record(overrides: Partial<AssetSummary> = {}): AssetSummary {
  return { id: "asset-1", fileName: "hero.png", mimeType: "image/png", byteLength: 4, checksum: "a".repeat(64), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", revision: 1, folderId: "folder", note: "", state: "active", versionId: "v1", url: "/uploaded-assets/sha256-a.png", authoringUrl: "/uploaded-assets/asset-1", ...overrides };
}

function response(bytes = new Uint8Array([1, 2, 3]), headers: Record<string, string> = {}): Response {
  return { ok: true, status: 200, headers: new Headers(headers), body: null, arrayBuffer: async () => bytes.buffer } as unknown as Response;
}

function dimensions(get: (id: string) => { width: number; height: number } | undefined = () => undefined) {
  return { get, record: vi.fn() };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Assets image editor dialog", () => {
  it("fetches the provider display URL, preserves source MIME, and passes the full export to save", async () => {
    const previewUrl = vi.fn(() => `blob:${window.location.origin}/version`);
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ImageEditorDialog record={record()} dimensions={dimensions()} previewUrl={previewUrl} onSave={onSave} onClose={vi.fn()} />);
    await screen.findByTestId("editor");
    expect(previewUrl).toHaveBeenCalledWith("/uploaded-assets/sha256-a.png");
    expect(fetch).toHaveBeenCalledWith(`blob:${window.location.origin}/version`, expect.objectContaining({ credentials: "same-origin" }));
    const bitmapBlob = vi.mocked(createImageBitmap).mock.calls[0]![0];
    expect(bitmapBlob).toBeInstanceOf(Blob);
    expect((bitmapBlob as Blob).type).toBe("image/png");
    expect(vi.mocked(createImageBitmap).mock.calls[0]![1]).toEqual({ imageOrientation: "from-image" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save", exact: true })); });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "image/png" }), "replace"));
  });

  it("does not fetch unsupported MIME types and explains the GIF gate", async () => {
    const onClose = vi.fn();
    render(<ImageEditorDialog record={record({ mimeType: "image/gif" })} dimensions={dimensions()} onSave={vi.fn()} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: /Edit image/ });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("GIF editing is not supported yet");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a cached over-ceiling image before fetch", async () => {
    render(<ImageEditorDialog record={record()} dimensions={dimensions(() => ({ width: 10_000, height: 4_001 }))} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/40 MP limit/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("guards encoded bytes before decode and suggests smaller dimensions", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(new Uint8Array(), { "content-length": String(MAX_ENCODED_BYTES + 1) }));
    render(<ImageEditorDialog record={record()} dimensions={dimensions(() => ({ width: 4_000, height: 3_000 }))} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Downscale to \d+ × \d+\?/);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("closes a decoded over-ceiling bitmap immediately", async () => {
    const close = vi.fn();
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 10_000, height: Math.ceil((MAX_DECODED_PIXELS + 1) / 10_000), close } as unknown as ImageBitmap);
    render(<ImageEditorDialog record={record()} dimensions={dimensions()} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/40 MP limit/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin provider URLs before starting a request", async () => {
    render(<ImageEditorDialog record={record({ url: "https://other.example/image.png" })} dimensions={dimensions()} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("same-origin");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gates every close path while saving and defers bitmap disposal after unmount", async () => {
    const bitmapClose = vi.fn(); const onClose = vi.fn();
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 800, height: 600, close: bitmapClose } as unknown as ImageBitmap);
    render(<ImageEditorDialog record={record()} dimensions={dimensions()} onSave={vi.fn()} onClose={onClose} />);
    await screen.findByTestId("editor");
    fireEvent.click(screen.getByRole("button", { name: "Begin saving", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Close image editor", exact: true }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finish saving", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });

  it("closes a stale decoded bitmap after source replacement without closing it twice", async () => {
    let finishFirst!: (value: ImageBitmap) => void; let finishSecond!: (value: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockReset().mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; })).mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
    const firstClose = vi.fn(); const secondClose = vi.fn(); const view = render(<ImageEditorDialog record={record()} dimensions={dimensions()} onSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    view.rerender(<ImageEditorDialog record={record({ id: "asset-2", versionId: "v2", url: "/uploaded-assets/sha256-b.png" })} dimensions={dimensions()} onSave={vi.fn()} onClose={vi.fn()} />);
    await act(async () => { finishFirst({ width: 10, height: 10, close: firstClose } as unknown as ImageBitmap); });
    await act(async () => { await Promise.resolve(); });
    expect(firstClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(finishSecond).toBeTypeOf("function"));
    await act(async () => { finishSecond({ width: 10, height: 10, close: secondClose } as unknown as ImageBitmap); });
    await screen.findByTestId("editor");
    expect(secondClose).not.toHaveBeenCalled();
  });

  it("disposes a decoded result when close wins before the editor surface mounts", async () => {
    let finish!: (value: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockReset().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const close = vi.fn();
    const view = render(<ImageEditorDialog record={record()} dimensions={dimensions()} onSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(screen.queryByTestId("editor")).toBeNull();
    finish({ width: 800, height: 600, close } as unknown as ImageBitmap);
    view.unmount();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
