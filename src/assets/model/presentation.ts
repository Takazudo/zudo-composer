import { ASSET_KINDS, ASSET_FILE_NAME_MAX_LENGTH, assetKindForMime, type AssetKindName } from "./types";

export function assetTypeLabel(mimeType: string): string {
  const extension = assetKindForMime(mimeType)?.extension;
  return extension === "jpg" ? "JPEG" : (extension ?? mimeType.slice(mimeType.indexOf("/") + 1)).toUpperCase();
}
export const ASSET_UPLOAD_HINT = Object.keys(ASSET_KINDS).map(assetTypeLabel).join(", ");
export const ASSET_KIND_LABELS: Readonly<Record<AssetKindName, string>> = { image: "Images", document: "Documents", archive: "Archives", text: "Text" };
/** A display name may already contain an extension, including a stale one after replacement. */
export function assetDownloadFileName(fileName: string, mimeType: string): string {
  const extension = assetKindForMime(mimeType)?.extension;
  // eslint-disable-next-line no-control-regex
  const safe = fileName.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
  if (!extension) return safe || "download";
  const knownExtensions = new Set([...Object.values(ASSET_KINDS).map(({ extension }) => extension), "jpeg"]);
  const suffix = safe.slice(safe.lastIndexOf(".") + 1).toLowerCase();
  const stem = (safe.includes(".") && knownExtensions.has(suffix) ? safe.slice(0, safe.lastIndexOf(".")) : safe).replace(/\.+$/, "") || "download";
  return `${Array.from(stem).slice(0, ASSET_FILE_NAME_MAX_LENGTH - extension.length - 1).join("")}.${extension}`;
}
export function assetByteLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}
