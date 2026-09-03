import { describe, expect, it, vi } from "vitest";
import { createMediaRecord, type MediaSummary, type MediaType } from "../../../media";
import { createMediaLibraryController, mediaMarkdown, mediaPublicFileName, mediaUrl } from "../controller";
import { createMemoryMediaProvider } from "../fixtures";

const checksum = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
function record(id: string, fileName = `${id}.png`) { return createMediaRecord({ fileName, mediaType: "image/png", byteLength: 3, checksum }, { id, timestamp: "2026-01-01T00:00:00.000Z" }); }
function summary(id: string, fileName = `${id}.png`): MediaSummary { const source = record(id, fileName); return { ...source, ...source.document }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("MediaLibraryController", () => {
  it("publishes the store's listing and leaves no stale loading state behind", async () => {
    const controller = createMediaLibraryController(createMemoryMediaProvider({ records: [record("hero")] }));
    expect(controller.state).toMatchObject({ phase: "idle", records: [], errorMessage: null, notice: null });
    await controller.initialize();
    expect(controller.state).toMatchObject({ phase: "ready", records: [{ id: "hero" }], errorMessage: null });
  });

  it("surfaces injected initialization failures and can retry", async () => {
    const provider = createMemoryMediaProvider({ records: [record("hero")] });
    const initialize = vi.spyOn(provider.initialization, "initialize").mockRejectedValueOnce(new Error("list offline"));
    const controller = createMediaLibraryController(provider);
    await controller.initialize();
    expect(controller.state).toMatchObject({ phase: "error", errorMessage: "list offline" });
    initialize.mockRestore();
    await controller.retryInitialization();
    expect(controller.state).toMatchObject({ phase: "ready", records: [{ id: "hero" }], errorMessage: null });
  });

  it("ignores a stale listing response that resolves after a newer request", async () => {
    const provider = createMemoryMediaProvider();
    const older = deferred<readonly MediaSummary[]>(); const newer = deferred<readonly MediaSummary[]>();
    vi.spyOn(provider.store, "list").mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const controller = createMediaLibraryController(provider);
    const first = controller.refresh(); const second = controller.refresh();
    newer.resolve([summary("newer")]); await second;
    older.resolve([summary("older")]); await first;
    expect(controller.state.records.map(({ id }) => id)).toEqual(["newer"]);
  });

  it("does not publish async completions after disposal", async () => {
    const provider = createMemoryMediaProvider(); const pending = deferred<readonly MediaSummary[]>();
    vi.spyOn(provider.store, "list").mockReturnValueOnce(pending.promise);
    const controller = createMediaLibraryController(provider); const listener = vi.fn(); controller.subscribe(listener);
    const refresh = controller.refresh(); controller.dispose(); pending.resolve([summary("late")]); await refresh;
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
    const asset = { ...source, ...source.document };
    expect(mediaPublicFileName(asset)).toBe(`media-asset-1.${extension}`);
    expect(mediaUrl(asset)).toBe(`/uploaded-media/media-asset-1.${extension}`);
  });

  it("copies renderable Markdown and treats reference results as advisory data", async () => {
    const writeClipboard = vi.fn(); const scanReferences = vi.fn().mockResolvedValue(["Content: Home"]);
    const controller = createMediaLibraryController(createMemoryMediaProvider({ records: [record("hero", "hero image.png")] }), { writeClipboard, scanReferences });
    await controller.initialize(); const asset = controller.state.records[0]!;
    await controller.copyMarkdown(asset); await controller.scanDeleteReferences(asset);
    expect(writeClipboard).toHaveBeenCalledWith("![hero image](/uploaded-media/media-hero.png)");
    expect(mediaMarkdown(asset)).toBe("![hero image](/uploaded-media/media-hero.png)");
    expect(scanReferences).toHaveBeenCalledWith("/uploaded-media/media-hero.png");
    expect(controller.state.referenceScan).toEqual({ status: "complete", mediaId: "hero", references: ["Content: Home"] });
  });

  it("copies the public URL and reports each copy as one dismissible notice", async () => {
    const writeClipboard = vi.fn();
    const controller = createMediaLibraryController(createMemoryMediaProvider({ records: [record("hero")] }), { writeClipboard });
    await controller.initialize(); const asset = controller.state.records[0]!;
    await controller.copyUrl(asset);
    expect(writeClipboard).toHaveBeenCalledWith("/uploaded-media/media-hero.png");
    expect(controller.state.notice).toEqual({ tone: "info", text: "Copied the public URL for hero.png." });
    controller.clearNotice();
    expect(controller.state.notice).toBeNull();
  });

  it("escapes structural Markdown characters in display filenames", () => {
    expect(mediaMarkdown(summary("diagram", "hero [draft].png"))).toBe(String.raw`![hero \[draft\]](/uploaded-media/media-diagram.png)`);
  });

  it("drops every asset a bulk delete actually removed, and reports the one that failed", async () => {
    const provider = createMemoryMediaProvider({ records: [record("one"), record("two"), record("three")] });
    const controller = createMediaLibraryController(provider);
    await controller.initialize();
    const byId = new Map(controller.state.records.map((asset) => [asset.id, asset]));
    vi.spyOn(provider.store, "delete").mockImplementation(async (id) => {
      if (id === "two") throw new Error("The store went away.");
      return true;
    });

    await controller.deleteMedia([byId.get("one")!, byId.get("two")!, byId.get("three")!]);
    // "one" is gone, "two" failed and stopped the run, so "three" was never tried.
    expect(controller.state.records.map(({ id }) => id)).toEqual(["three", "two"]);
    expect(controller.state.notice).toEqual({ tone: "err", text: "The store went away." });
  });

  it("names the single asset it deleted and counts a bulk deletion", async () => {
    const provider = createMemoryMediaProvider({ records: [record("one"), record("two")] });
    const controller = createMediaLibraryController(provider);
    await controller.initialize();
    const [first, second] = controller.state.records;

    await controller.deleteMedia([first!]);
    expect(controller.state.notice).toEqual({ tone: "info", text: `Deleted ${first!.fileName}.` });
    await controller.deleteMedia([second!]);
    expect(controller.state.records).toEqual([]);
    expect(await provider.store.list()).toEqual([]);
  });

  it("keeps a quarantine visible across the refresh an upload triggers", async () => {
    const provider = createMemoryMediaProvider({ records: [record("valid")] });
    const valid = record("valid");
    vi.spyOn(provider.initialization, "initialize").mockResolvedValue({
      status: "recovery-required",
      summaries: [{ ...valid, ...valid.document }],
      recovery: { kind: "quarantined", reason: "future-schema", sourcePreserved: true, affectedRecordIds: ["future"], message: "A newer record was preserved." },
    });
    const controller = createMediaLibraryController(provider);
    await controller.initialize();
    expect(controller.state).toMatchObject({ phase: "recovery", recoveryMessage: "A newer record was preserved." });

    // A listing reports only the records that read correctly, so it is no
    // answer to the quarantine.
    await controller.refresh();
    expect(controller.state).toMatchObject({ phase: "recovery", records: [{ id: "valid" }] });
  });

  it("reports a failure raised by a caller-run action as an error notice", () => {
    const controller = createMediaLibraryController(createMemoryMediaProvider());
    controller.reportFailure(new Error("Clipboard access is unavailable."));
    expect(controller.state.notice).toEqual({ tone: "err", text: "Clipboard access is unavailable." });
    controller.reportFailure("not an error");
    expect(controller.state.notice).toEqual({ tone: "err", text: "Media action failed." });
  });
});
