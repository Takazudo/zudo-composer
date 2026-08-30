import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaRecord, type MediaRecord } from "../../../media";
import { MEDIA_UPLOAD_ACCEPT, MEDIA_UPLOAD_BUSY_REJECTION, MediaUpload, type MediaUploadStore } from "../media-upload";

const checksum = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const bytes = new Uint8Array([1]);
const file = (name: string, type = "image/png") => new File([bytes], name, { type });
const record = (fileName: string, id = "uploaded-media"): MediaRecord => createMediaRecord({ fileName, mediaType: fileName.endsWith(".pdf") ? "application/pdf" : "image/png", byteLength: 1, checksum }, { id, timestamp: "2026-01-01T00:00:00.000Z" });
const transfer = (files: File[], items: Array<{ kind: string; getAsFile(): File | null }> = []) => ({ files, items, types: ["Files"], dropEffect: "none" });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(upload = vi.fn<MediaUploadStore["upload"]>().mockImplementation((source) => Promise.resolve(record(source.name))), refresh = vi.fn().mockResolvedValue(undefined)) {
  const rendered = render(<MediaUpload store={{ upload }} refresh={refresh} now={() => 777} />);
  const surface = rendered.container.querySelector<HTMLElement>(".sg-media-upload")!;
  const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  return { ...rendered, surface, input, upload, refresh };
}

describe("MediaUpload", () => {
  it("offers the explicit native picker, resets it before awaiting, and allows a same-file re-pick", async () => {
    const first = deferred<MediaRecord>();
    const upload = vi.fn<MediaUploadStore["upload"]>().mockReturnValueOnce(first.promise).mockResolvedValue(record("same.png"));
    const { input } = setup(upload);
    expect(input).toHaveAttribute("multiple");
    expect(input).toHaveAttribute("accept", MEDIA_UPLOAD_ACCEPT);
    Object.defineProperty(input, "value", { value: "C:\\fakepath\\same.png", writable: true, configurable: true });
    fireEvent.change(input, { target: { files: [file("same.png")] } });
    expect(input.value).toBe("");
    first.resolve(record("same.png"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose files" })).toBeEnabled());
    fireEvent.change(input, { target: { files: [file("same.png")] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  });

  it("prevents browser drag navigation, sets copy, and ignores child-crossing dragleave", async () => {
    const { surface } = setup();
    const dataTransfer = transfer([file("drop.png")]);
    expect(fireEvent.dragOver(surface, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(surface).toHaveClass("sg-media-upload--drag-active");
    const childLeave = new Event("dragleave", { bubbles: true, cancelable: true });
    Object.defineProperty(childLeave, "relatedTarget", { value: screen.getByRole("button", { name: "Choose files" }) });
    fireEvent(surface, childLeave);
    expect(surface).toHaveClass("sg-media-upload--drag-active");
    const outerLeave = new Event("dragleave", { bubbles: true, cancelable: true });
    Object.defineProperty(outerLeave, "relatedTarget", { value: document.body });
    fireEvent(surface, outerLeave);
    expect(surface).not.toHaveClass("sg-media-upload--drag-active");
    expect(fireEvent.drop(surface, { dataTransfer })).toBe(false);
    await screen.findByText("Stored");
  });

  it("uses item files before the transfer file list", async () => {
    const { surface, upload } = setup();
    const itemFile = file("item.png");
    fireEvent.drop(surface, { dataTransfer: transfer([file("fallback.png")], [{ kind: "file", getAsFile: () => itemFile }]) });
    await waitFor(() => expect(upload).toHaveBeenCalledWith(itemFile));
    expect(upload).not.toHaveBeenCalledWith(expect.objectContaining({ name: "fallback.png" }));
  });

  it("claims item-only image paste synchronously, generates its name, and leaves ordinary text paste unclaimed", async () => {
    const { surface, upload } = setup();
    const nameless = file("", "image/png");
    expect(fireEvent.paste(surface, { clipboardData: transfer([], [{ kind: "file", getAsFile: () => nameless }]) })).toBe(false);
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ name: "pasted-image-777.png" })));
    expect(fireEvent.paste(surface, { clipboardData: { files: [], items: [{ kind: "string", getAsFile: () => null }], types: ["text/plain"] } })).toBe(true);
  });

  it("uses a synchronous busy guard so a second paste is unclaimed", async () => {
    const pending = deferred<MediaRecord>();
    const upload = vi.fn<MediaUploadStore["upload"]>().mockReturnValue(pending.promise);
    const { surface } = setup(upload);
    const clipboardData = transfer([file("first.png")]);
    expect(fireEvent.paste(surface, { clipboardData })).toBe(false);
    expect(fireEvent.paste(surface, { clipboardData: transfer([file("second.png")]) })).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByText(MEDIA_UPLOAD_BUSY_REJECTION)).toBeInTheDocument();
    pending.resolve(record("first.png"));
    await screen.findByText("Stored");
  });

  it("uploads sequentially, continues after errors, displays server-returned names, and refreshes once", async () => {
    const first = deferred<MediaRecord>();
    const second = deferred<MediaRecord>();
    const third = deferred<MediaRecord>();
    const upload = vi.fn<MediaUploadStore["upload"]>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { input } = setup(upload, refresh);
    fireEvent.change(input, { target: { files: [file("one.png"), file("two.png"), file("three.png")] } });
    expect(upload).toHaveBeenCalledTimes(1);
    first.resolve(record("server-one.png"));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    second.reject(new Error("Invalid image bytes."));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    expect(refresh).not.toHaveBeenCalled();
    third.resolve(record("three.png"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const status = screen.getByRole("list", { name: "Upload status" });
    expect(within(status).getByText("Stored as server-one.png")).toBeInTheDocument();
    expect(within(status).getByText("Invalid image bytes.")).toBeInTheDocument();
    expect(within(status).getAllByText("Stored")).toHaveLength(2);
    expect(within(status).getByText("Failed")).toBeInTheDocument();
    expect(status.parentElement).toHaveAttribute("aria-live", "polite");
  });
});
