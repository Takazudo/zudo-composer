import type { AssetSummary } from "../../assets";

/** Byte sizes read as the file manager writes them: B, then one KB/MB step. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

/** `image/jpeg` reads as JPEG; the one non-image type reads as PDF. */
export function assetTypeLabel(mimeType: string): string {
  return mimeType === "application/pdf" ? "PDF" : mimeType.slice(mimeType.indexOf("/") + 1).toUpperCase();
}

export function isAssetImage(record: Pick<AssetSummary, "mimeType">): boolean {
  return record.mimeType.startsWith("image/");
}

/** Pixel dimensions, present only for an image whose bytes the browser decoded. */
export interface AssetPixelSize {
  readonly width: number;
  readonly height: number;
}

export function formatPixelSize(size: AssetPixelSize): string {
  return `${size.width}×${size.height}`;
}

/**
 * The caption under a grid tile: dimensions when the browser has decoded them,
 * then the stored byte size. A PDF never reports dimensions, and an image that
 * has not finished decoding shows its size alone rather than a placeholder.
 */
export function assetCaption(record: AssetSummary, size: AssetPixelSize | undefined): string {
  const bytes = formatBytes(record.byteLength);
  return size ? `${formatPixelSize(size)} · ${bytes}` : bytes;
}
