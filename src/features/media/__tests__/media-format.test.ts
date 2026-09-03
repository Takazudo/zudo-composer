import { describe, expect, it } from "vitest";
import { createMediaRecord, type MediaType } from "../../../media";
import { formatBytes, formatPixelSize, isMediaImage, mediaCaption, mediaTypeLabel } from "../media-format";

const CHECKSUM = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";

function summary(mediaType: MediaType, byteLength: number) {
  const source = createMediaRecord({ fileName: "asset.bin", mediaType, byteLength, checksum: CHECKSUM }, { id: "asset", timestamp: "2026-01-01T00:00:00.000Z" });
  return { ...source, ...source.document };
}

describe("media formatting", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [10 * 1024, "10 KB"],
    [1024 ** 2, "1.0 MB"],
    [10 * 1024 ** 2, "10 MB"],
  ])("reads %i bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it.each([
    ["image/png", "PNG"],
    ["image/jpeg", "JPEG"],
    ["image/webp", "WEBP"],
    ["application/pdf", "PDF"],
  ])("labels %s as %s", (mediaType, expected) => {
    expect(mediaTypeLabel(mediaType)).toBe(expected);
  });

  it("separates images, which can report dimensions, from the one type that cannot", () => {
    expect(isMediaImage(summary("image/gif", 1))).toBe(true);
    expect(isMediaImage(summary("application/pdf", 1))).toBe(false);
  });

  it("captions an asset with its size, and adds dimensions only once a decode reported them", () => {
    const image = summary("image/png", 2048);
    expect(mediaCaption(image, undefined)).toBe("2.0 KB");
    expect(mediaCaption(image, { width: 2400, height: 1600 })).toBe("2400×1600 · 2.0 KB");
    expect(formatPixelSize({ width: 512, height: 512 })).toBe("512×512");
  });
});
