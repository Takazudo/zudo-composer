import type { AssetSummary } from "../../assets";

export { assetByteLabel as formatBytes, assetTypeLabel } from "../../assets/model";
import { assetByteLabel as formatBytes } from "../../assets/model";

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
