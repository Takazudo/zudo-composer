import { describe, expect, it, vi } from "vitest";
import { createMediaRecord, type MediaSummary, type MediaType } from "../../../media";
import { createMediaLibraryController, mediaMarkdown, mediaPublicFileName, mediaUrl } from "../controller";
import { createMemoryMediaProvider } from "../fixtures";

const checksum = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
function record(id: string, fileName = `${id}.png`) { return createMediaRecord({ fileName, mediaType: "image/png", byteLength: 3, checksum }, { id, timestamp: "2026-01-01T00:00:00.000Z" }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("MediaLibraryController", () => {
  it("starts in Gallery and preserves the same records in Details", async () => {
    const controller = createMediaLibraryController(createMemoryMediaProvider({ records: [record("hero")] }));
    expect(controller.state.view).toBe("gallery");
    await controller.initialize();
    const records = controller.state.records;
    controller.setView("details");
    expect(controller.state.view).toBe("details");
    expect(controller.state.records).toBe(records);
  });

  it("surfaces injected initialization failures and can retry", async () => {
    const provider = createMemoryMediaProvider({ records: [record("hero")] });
    const initialize = vi.spyOn(provider.initialization, "initialize").mockRejectedValueOnce(new Error("list offline"));
    const controller = createMediaLibraryController(provider);
    await controller.initialize();
    expect(controller.state).toMatchObject({ phase: "error", message: "list offline" });
    initialize.mockRestore();
    await controller.retryInitialization();
    expect(controller.state).toMatchObject({ phase: "ready", records: [{ id: "hero" }] });
  });

  it("ignores a stale listing response that resolves after a newer request", async () => {
    const provider = createMemoryMediaProvider();
    const older = deferred<readonly MediaSummary[]>(); const newer = deferred<readonly MediaSummary[]>();
    vi.spyOn(provider.store, "list").mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const controller = createMediaLibraryController(provider);
    const first = controller.refresh(); const second = controller.refresh();
    newer.resolve([{ ...record("newer"), ...record("newer").document }]); await second;
    older.resolve([{ ...record("older"), ...record("older").document }]); await first;
    expect(controller.state.records.map(({ id }) => id)).toEqual(["newer"]);
  });

  it("does not publish async completions after disposal", async () => {
    const provider = createMemoryMediaProvider(); const pending = deferred<readonly MediaSummary[]>();
    vi.spyOn(provider.store, "list").mockReturnValueOnce(pending.promise);
    const controller = createMediaLibraryController(provider); const listener = vi.fn(); controller.subscribe(listener);
    const refresh = controller.refresh(); controller.dispose(); pending.resolve([{ ...record("late"), ...record("late").document }]); await refresh;
    expect(controller.state.records).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/gif", "gif"],
    ["image/webp", "webp"],
    ["application/pdf", "pdf"],
  ] as const)("derives the id-keyed public filename for %s", (mediaType, extension) => {
    const source = createMediaRecord({ fileName: "original.upload", mediaType: mediaType as MediaType, byteLength: 3, checksum }, { id: "asset-1", timestamp: "2026-01-01T00:00:00.000Z" });
    const summary = { ...source, ...source.document };
    expect(mediaPublicFileName(summary)).toBe(`media-asset-1.${extension}`);
    expect(mediaUrl(summary)).toBe(`/uploaded-media/media-asset-1.${extension}`);
  });

  it("copies renderable Markdown and treats reference results as advisory data", async () => {
    const writeClipboard = vi.fn(); const scanReferences = vi.fn().mockResolvedValue(["Content: Home"]);
    const controller = createMediaLibraryController(createMemoryMediaProvider({ records: [record("hero", "hero image.png")] }), { writeClipboard, scanReferences });
    await controller.initialize(); const summary = controller.state.records[0]!;
    await controller.copyMarkdown(summary); await controller.scanDeleteReferences(summary);
    expect(writeClipboard).toHaveBeenCalledWith("![hero image](/uploaded-media/media-hero.png)");
    expect(mediaMarkdown(summary)).toBe("![hero image](/uploaded-media/media-hero.png)");
    expect(scanReferences).toHaveBeenCalledWith("/uploaded-media/media-hero.png");
    expect(controller.state.referenceScan).toEqual({ status: "complete", mediaId: "hero", references: ["Content: Home"] });
  });

  it("escapes structural Markdown characters in display filenames", () => {
    const source = record("diagram", "hero [draft].png");
    const summary = { ...source, ...source.document };
    expect(mediaMarkdown(summary)).toBe(String.raw`![hero \[draft\]](/uploaded-media/media-diagram.png)`);
  });
});
