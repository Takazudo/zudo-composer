import { describe, expect, it } from "vitest";
import { normalizedClipboardFiles, normalizedFilesFromTransfer } from "../upload-input";

const file = (name: string, type = "image/png") => new File([new Uint8Array([1])], name, { type });
const item = (value: File | null, kind = "file") => ({ kind, getAsFile: () => value });

describe("media upload input normalization", () => {
  it("prefers file-kind items and falls back to files only when no item files exist", () => {
    const fromItem = file("item.png");
    const fromFiles = file("files.png");
    expect(normalizedFilesFromTransfer({ items: [item(fromItem), item(null), item(fromFiles, "string")], files: [fromFiles] })).toEqual([fromItem]);
    expect(normalizedFilesFromTransfer({ items: [item(null), item(fromItem, "string")], files: [fromFiles] })).toEqual([fromFiles]);
  });

  it("gives nameless clipboard blobs deterministic MIME-derived names", () => {
    const nameless = file("", "image/jpeg");
    const [normalized] = normalizedClipboardFiles({ items: [item(nameless)], files: [] }, 12345);
    expect(normalized?.name).toBe("pasted-image-12345.jpg");
    expect(normalized?.type).toBe("image/jpeg");
  });
});
