import { describe, expect, it } from "vitest";
import { assetDownloadFileName, createAssetRecord, summarizeAsset, type AssetType } from "../../../assets";
import { formatBytes, formatPixelSize, isAssetImage, assetCaption, assetTypeLabel } from "../assets-format";

const CHECKSUM = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";

function summary(mimeType: AssetType, byteLength: number) {
  const source = createAssetRecord({ fileName: "asset.bin", mimeType, byteLength, checksum: CHECKSUM }, { id: "asset", timestamp: "2026-01-01T00:00:00.000Z" });
  return summarizeAsset(source);
}

describe("asset formatting", () => {
  it("keeps a maximum-length display name valid after adding the canonical extension", () => {
    const name = assetDownloadFileName("資".repeat(255), "application/zip");
    expect(Array.from(name)).toHaveLength(255);
    expect(name.endsWith(".zip")).toBe(true);
    expect(assetDownloadFileName(name, "application/zip")).toBe(name);
  });
  it.each([["Release.v2", "application/zip", "Release.v2.zip"], ["photo.jpeg", "image/jpeg", "photo.jpg"], ["bundle.zip", "application/zip", "bundle.zip"], ["bundle", "application/zip", "bundle.zip"], ["old.png", "image/jpeg", "old.jpg"], ["DATA.CSV", "text/csv", "DATA.csv"]])("uses MIME extension without duplicating the display suffix: %s", (name, mime, expected) => {
    expect(assetDownloadFileName(name, mime)).toBe(expected);
  });
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
    ["application/zip", "ZIP"],
    ["text/plain", "TXT"],
    ["text/csv", "CSV"],
    ["application/json", "JSON"],
  ])("labels %s as %s", (mimeType, expected) => {
    expect(assetTypeLabel(mimeType)).toBe(expected);
  });

  it("separates images, which can report dimensions, from the one type that cannot", () => {
    expect(isAssetImage(summary("image/gif", 1))).toBe(true);
    expect(isAssetImage(summary("application/pdf", 1))).toBe(false);
  });

  it("captions an asset with its size, and adds dimensions only once a decode reported them", () => {
    const image = summary("image/png", 2048);
    expect(assetCaption(image, undefined)).toBe("2.0 KB");
    expect(assetCaption(image, { width: 2400, height: 1600 })).toBe("2400×1600 · 2.0 KB");
    expect(formatPixelSize({ width: 512, height: 512 })).toBe("512×512");
  });
});
