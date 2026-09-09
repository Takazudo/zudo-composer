import { describe, expect, it } from "vitest";
import { sniffAsset } from "../sniff";

describe("asset signatures and declared text kinds", () => {
  it.each([
    ["image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff])],
    ["image/gif", new TextEncoder().encode("GIF89a")],
    ["image/webp", new TextEncoder().encode("RIFFxxxxWEBP")],
    ["application/pdf", new TextEncoder().encode("%PDF-1.7")],
    ["application/zip", Uint8Array.from([0x50, 0x4b, 0x03, 0x04])],
  ] as const)("sniffs %s", (mimeType, bytes) => {
    expect(sniffAsset(bytes)).toMatchObject({ mimeType });
  });

  it.each([
    ["text/plain", "notes"],
    ["text/csv", "name,value"],
    ["application/json", '{"ok":true}'],
  ] as const)("accepts signatureless %s only from its declaration", (mimeType, content) => {
    const bytes = new TextEncoder().encode(content);
    expect(sniffAsset(bytes, mimeType)).toMatchObject({ mimeType });
    expect(sniffAsset(bytes, `${mimeType}; charset=utf-8`)).toMatchObject({ mimeType });
    expect(sniffAsset(bytes)).toBeUndefined();
    expect(sniffAsset(bytes, "text/html")).toBeUndefined();
    expect(sniffAsset(bytes, "application/octet-stream")).toBeUndefined();
  });

  it("stores an Office ZIP container as application/zip regardless of its declaration", () => {
    expect(sniffAsset(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .toMatchObject({ mimeType: "application/zip", extension: "zip" });
  });

  it("rejects an executable signatureless upload", () => {
    expect(sniffAsset(new TextEncoder().encode("MZ"), "application/x-msdownload")).toBeUndefined();
  });
});
