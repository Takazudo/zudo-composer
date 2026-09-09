import { commonmarkLanguage } from "@codemirror/lang-markdown";
import { isContentAssetUse, type ContentAssetUse } from "../../content/model";
import { ASSET_CHECKSUM_URL_PATTERN, assetDownloadFileName, assetByteLabel, assetTypeLabel, assetVersionUrl, isValidAssetFileName, isValidAssetByteLength, assetKindForMime, type AssetType } from "../model";
import type { ComponentManifest } from "@zudo-composer/component-contract";

export type AssetDownloadUse = Extract<ContentAssetUse, { kind: "download" }>;
export interface ResolvedAssetDownload { url: string; fileName: string; mimeType: string; byteLength: number }
export interface AssetDownloadBlock { use: AssetDownloadUse; resolved?: ResolvedAssetDownload }
const PREFIX = "<!--zudo-asset-download:";
export function assetDownloadMarkdown(use: AssetDownloadUse, resolved?: ResolvedAssetDownload): string {
  return `${PREFIX}${encodeURIComponent(JSON.stringify({ use, ...(resolved ? { resolved } : {}) }))}-->`;
}
function validResolved(value: unknown): value is ResolvedAssetDownload {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "byteLength,fileName,mimeType,url") return false;
  const item = value as ResolvedAssetDownload;
  return typeof item.url === "string" && ASSET_CHECKSUM_URL_PATTERN.test(item.url) && !!assetKindForMime(item.mimeType)
    && item.url === assetVersionUrl(item.url.slice("/uploaded-assets/sha256-".length).split(".")[0]!, item.mimeType as AssetType)
    && isValidAssetFileName(item.fileName) && item.fileName === assetDownloadFileName(item.fileName, item.mimeType) && isValidAssetByteLength(item.byteLength);
}
export function parseAssetDownloadBlock(source: string): AssetDownloadBlock | undefined {
  if (!source.startsWith(PREFIX) || !source.endsWith("-->")) return undefined;
  try {
    const value = JSON.parse(decodeURIComponent(source.slice(PREFIX.length, -3)));
    if (!value || typeof value !== "object" || !["use", "resolved,use"].includes(Object.keys(value).sort().join(",")) || !isContentAssetUse(value.use) || value.use.kind !== "download") return undefined;
    if ("resolved" in value && !validResolved(value.resolved)) return undefined;
    return value;
  } catch { return undefined; }
}
/** Only standalone top-level blocks, never code fences, inline text or raw HTML attributes. */
export function assetDownloadBlocks(source: string): { from: number; to: number; block: AssetDownloadBlock | undefined }[] {
  const blocks: ReturnType<typeof assetDownloadBlocks> = [];
  if (!source.includes(PREFIX)) return blocks;
  commonmarkLanguage.parser.parse(source).iterate({ enter(node) {
    if (node.name !== "CommentBlock" || node.node.parent?.name !== "Document") return;
    const raw = source.slice(node.from, node.to).trimEnd();
    if (raw.startsWith(PREFIX)) blocks.push({ from: node.from, to: node.from + raw.length, block: parseAssetDownloadBlock(raw) });
  } });
  return blocks;
}
export type AssetDownloadPart = { markdown: string } | { block: AssetDownloadBlock };
export function splitAssetDownloadMarkdown(source: string): AssetDownloadPart[] {
  const parts: AssetDownloadPart[] = []; let offset = 0;
  for (const item of assetDownloadBlocks(source)) {
    if (!item.block) continue;
    if (item.from > offset) parts.push({ markdown: source.slice(offset, item.from) });
    parts.push({ block: item.block }); offset = item.to;
  }
  if (offset < source.length || !parts.length) parts.push({ markdown: source.slice(offset) });
  if (parts.some((part) => "block" in part)) {
    const definitions: string[] = [];
    commonmarkLanguage.parser.parse(source).iterate({ enter(node) {
      if (node.name === "LinkReference") definitions.push(source.slice(node.from, node.to));
    } });
    if (definitions.length) for (const part of parts) if ("markdown" in part && part.markdown.trim()) part.markdown = `${definitions.join("\n")}\n\n${part.markdown}`;
  }
  return parts;
}
export function downloadMarkdownProperty(definition: ComponentManifest, props: Record<string, unknown>): string | undefined {
  // A single prose field is the explicit rendering seam. Multi-field/slot components
  // cannot be split without duplicating unrelated content.
  if (definition.slots.length || definition.fields.length !== 1) return undefined;
  const field = definition.fields[0]!;
  return field.schema.type === "string" && field.editor.kind === "text" && field.editor.mode === "markdown-source" && typeof props[field.prop] === "string" ? field.prop : undefined;
}
export function assetDownloadLabel(block: AssetDownloadBlock): string {
  return [block.use.label, block.resolved && block.use.showType ? assetTypeLabel(block.resolved.mimeType) : "", block.resolved && block.use.showSize ? assetByteLabel(block.resolved.byteLength) : ""].filter(Boolean).join(" · ");
}
