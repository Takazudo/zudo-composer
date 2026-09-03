import { describe, expect, it } from "vitest";
import {
  initialMediaUploadState,
  MEDIA_UPLOAD_BUSY_REJECTION,
  mediaUploadItemId,
  reduceMediaUploadDrop,
  type MediaUploadState,
} from "../upload-reducer";

const file = (name: string) => new File([new Uint8Array([1])], name, { type: "image/png" });

function claim(state: MediaUploadState, batch: number, names: readonly string[], source: "drop" | "paste" | "picker" = "drop") {
  return reduceMediaUploadDrop(state, { type: "claim", source, batch, files: names.map(file) });
}

describe("reduceMediaUploadDrop", () => {
  it("claims a non-empty drop and preserves its queue order", () => {
    const state = claim(initialMediaUploadState, 1, ["b.png", "a.png"]);
    expect(state.busy).toBe(true);
    expect(state.items.map(({ fileName, status }) => ({ fileName, status }))).toEqual([
      { fileName: "b.png", status: "queued" },
      { fileName: "a.png", status: "queued" },
    ]);
  });

  it("rejects empty and busy claims without replacing the active queue", () => {
    expect(claim(initialMediaUploadState, 1, [])).toBe(initialMediaUploadState);
    const busy = claim(initialMediaUploadState, 1, ["one.png"]);
    expect(claim(busy, 2, ["two.png"], "paste")).toEqual({ ...busy, rejection: MEDIA_UPLOAD_BUSY_REJECTION });
  });

  it("records server names, failures and final settlement as status rather than byte progress", () => {
    let state = claim(initialMediaUploadState, 1, ["one.png", "two.png"]);
    const [first, second] = state.items.map((item) => item.id);
    state = reduceMediaUploadDrop(state, { type: "uploading", id: first! });
    state = reduceMediaUploadDrop(state, { type: "stored", id: first!, fileName: "server-one.webp" });
    state = reduceMediaUploadDrop(state, { type: "failed", id: second!, message: "Invalid bytes." });
    state = reduceMediaUploadDrop(state, { type: "settled" });
    expect(state.busy).toBe(false);
    expect(state.items).toMatchObject([
      { status: "stored", storedFileName: "server-one.webp" },
      { status: "failed", error: "Invalid bytes." },
    ]);
  });

  it("ignores an update addressed to a row that is no longer queued", () => {
    const state = claim(initialMediaUploadState, 1, ["one.png"]);
    expect(reduceMediaUploadDrop(state, { type: "stored", id: "drop-9-4", fileName: "ghost.png" })).toBe(state);
  });

  it("keys rows by batch, so a second drop cannot reuse the first drop's row identity", () => {
    const first = claim(initialMediaUploadState, 1, ["one.png"]);
    const settled = reduceMediaUploadDrop(
      reduceMediaUploadDrop(first, { type: "failed", id: mediaUploadItemId("drop", 1, 0), message: "Invalid bytes." }),
      { type: "settled" },
    );
    const second = claim(settled, 2, ["two.png"]);
    expect(second.items.map((item) => item.id)).toEqual([mediaUploadItemId("drop", 1, 0), mediaUploadItemId("drop", 2, 0)]);
    expect(new Set(second.items.map((item) => item.id)).size).toBe(2);
  });

  it("carries a failed row into the next batch and drops the stored ones", () => {
    let state = claim(initialMediaUploadState, 1, ["kept.png", "gone.png"]);
    const [failed, stored] = state.items.map((item) => item.id);
    state = reduceMediaUploadDrop(state, { type: "failed", id: failed!, message: "Invalid bytes." });
    state = reduceMediaUploadDrop(state, { type: "stored", id: stored!, fileName: "gone.png" });
    state = reduceMediaUploadDrop(state, { type: "settled" });

    const next = claim(state, 2, ["fresh.png"]);
    expect(next.items.map((item) => item.fileName)).toEqual(["kept.png", "fresh.png"]);
  });

  it("dismisses one row by id and leaves an unknown id alone", () => {
    const state = claim(initialMediaUploadState, 1, ["one.png", "two.png"]);
    const dismissed = reduceMediaUploadDrop(state, { type: "dismiss", id: state.items[0]!.id });
    expect(dismissed.items.map((item) => item.fileName)).toEqual(["two.png"]);
    expect(reduceMediaUploadDrop(dismissed, { type: "dismiss", id: "drop-9-9" })).toBe(dismissed);
  });
});
