import type { MediaSummary } from "../../media";

/** Byte sizes read as the file manager writes them: B, then one KB/MB step. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

/** `image/jpeg` reads as JPEG; the one non-image type reads as PDF. */
export function mediaTypeLabel(mediaType: string): string {
  return mediaType === "application/pdf" ? "PDF" : mediaType.slice(mediaType.indexOf("/") + 1).toUpperCase();
}

export function isMediaImage(record: Pick<MediaSummary, "mediaType">): boolean {
  return record.mediaType.startsWith("image/");
}

/** Pixel dimensions, present only for an image whose bytes the browser decoded. */
export interface MediaPixelSize {
  readonly width: number;
  readonly height: number;
}

export function formatPixelSize(size: MediaPixelSize): string {
  return `${size.width}×${size.height}`;
}

/**
 * The caption under a grid tile: dimensions when the browser has decoded them,
 * then the stored byte size. A PDF never reports dimensions, and an image that
 * has not finished decoding shows its size alone rather than a placeholder.
 */
export function mediaCaption(record: MediaSummary, size: MediaPixelSize | undefined): string {
  const bytes = formatBytes(record.byteLength);
  return size ? `${formatPixelSize(size)} · ${bytes}` : bytes;
}
