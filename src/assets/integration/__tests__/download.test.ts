import { describe, expect, it } from "vitest";
import { isContentAssetUse, projectContentAssetUse } from "../../../content/model";
import { assetVersionUrl } from "../../model";
import { assetDownloadBlocks, assetDownloadMarkdown, parseAssetDownloadBlock, type AssetDownloadUse } from "../download";
const use: AssetDownloadUse = { kind: "download", asset: { providerId: "asset-files", assetId: "bundle" }, label: "Get bundle", showSize: true, showType: false };
const resolved = { url: assetVersionUrl("a".repeat(64), "application/zip"), fileName: "bundle.zip", mimeType: "application/zip", byteLength: 22 };

describe("download block boundary", () => {
  it("round-trips explicit references and exposes presentation flags without metadata leakage", () => {
    expect(parseAssetDownloadBlock(assetDownloadMarkdown(use, resolved))).toEqual({ use, resolved });
    expect(projectContentAssetUse(use, resolved.url)).toEqual({ href: resolved.url, label: use.label, showSize: true, showType: false });
    expect(isContentAssetUse({ ...use, showSize: "yes" })).toBe(false);
    expect(isContentAssetUse({ ...use, notes: "private" })).toBe(false);
  });
  it.each(["javascript:alert(1)", "data:text/plain,payload", "https://evil.test/file.zip", "/uploaded-assets/asset-bundle"])("rejects a forged resolved URL: %s", (url) => {
    expect(parseAssetDownloadBlock(assetDownloadMarkdown(use, { ...resolved, url }))).toBeUndefined();
  });
  it("rejects inconsistent extensions, unexpected metadata, and malformed references", () => {
    expect(parseAssetDownloadBlock(assetDownloadMarkdown(use, { ...resolved, mimeType: "application/pdf" }))).toBeUndefined();
    expect(parseAssetDownloadBlock(assetDownloadMarkdown(use, { ...resolved, fileName: "../bundle.zip" }))).toBeUndefined();
    expect(parseAssetDownloadBlock(assetDownloadMarkdown(use, { ...resolved, fileName: "bundle.png" }))).toBeUndefined();
    expect(parseAssetDownloadBlock(assetDownloadMarkdown({ ...use, asset: { providerId: "../bad", assetId: "bundle" } }))).toBeUndefined();
    const extra = `<!--zudo-asset-download:${encodeURIComponent(JSON.stringify({ use, resolved, html: "<script>" }))}-->`;
    expect(parseAssetDownloadBlock(extra)).toBeUndefined();
  });
  it("does not interpret inline comments or fenced examples as live downloads", () => {
    const token = assetDownloadMarkdown(use);
    expect(assetDownloadBlocks(`Example ${token}`)).toEqual([]);
    expect(assetDownloadBlocks(`\`\`\`\n${token}\n\`\`\``)).toEqual([]);
    expect(assetDownloadBlocks(`${token}\n\n${token}`)).toHaveLength(2);
  });
});
