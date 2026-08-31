import { describe, expect, it } from "vitest";
import { initialMediaUploadState, MEDIA_UPLOAD_BUSY_REJECTION, reduceMediaUploadDrop } from "../upload-reducer";

const file = (name: string) => new File([new Uint8Array([1])], name, { type: "image/png" });

describe("reduceMediaUploadDrop", () => {
  it("claims a non-empty drop and preserves its queue order", () => {
    const state = reduceMediaUploadDrop(initialMediaUploadState, { type: "claim", source: "drop", files: [file("b.png"), file("a.png")] });
    expect(state.busy).toBe(true);
    expect(state.items.map(({ fileName, status }) => ({ fileName, status }))).toEqual([
      { fileName: "b.png", status: "queued" },
      { fileName: "a.png", status: "queued" },
    ]);
  });

  it("rejects empty and busy claims without replacing the active queue", () => {
    expect(reduceMediaUploadDrop(initialMediaUploadState, { type: "claim", source: "drop", files: [] })).toBe(initialMediaUploadState);
    const busy = reduceMediaUploadDrop(initialMediaUploadState, { type: "claim", source: "drop", files: [file("one.png")] });
    expect(reduceMediaUploadDrop(busy, { type: "claim", source: "paste", files: [file("two.png")] })).toEqual({
      ...busy,
      rejection: MEDIA_UPLOAD_BUSY_REJECTION,
    });
  });

  it("records server names, failures and final settlement as status rather than byte progress", () => {
    let state = reduceMediaUploadDrop(initialMediaUploadState, { type: "claim", source: "drop", files: [file("one.png"), file("two.png")] });
    state = reduceMediaUploadDrop(state, { type: "uploading", index: 0 });
    state = reduceMediaUploadDrop(state, { type: "stored", index: 0, fileName: "server-one.webp" });
    state = reduceMediaUploadDrop(state, { type: "failed", index: 1, message: "Invalid bytes." });
    state = reduceMediaUploadDrop(state, { type: "settled" });
    expect(state.busy).toBe(false);
    expect(state.items).toMatchObject([
      { status: "stored", storedFileName: "server-one.webp" },
      { status: "failed", error: "Invalid bytes." },
    ]);
  });
});
