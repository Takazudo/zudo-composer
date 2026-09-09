import type { RgbaImage, Size } from "./types";
export const MAX_DECODED_PIXELS = 40_000_000;
export const MAX_ENCODED_BYTES = 25 * 1024 * 1024;
export const MAX_WORKING_BYTES = 512 * 1024 * 1024;
export type ErrorCode =
  | "invalid-dimensions"
  | "pixel-limit"
  | "encoded-limit"
  | "unsupported-mime"
  | "encode-failed"
  | "superseded"
  | "disposed"
  | "invalid-document"
  | "memory-limit"
  | "unknown-source"
  | "worker-failed";
export class ImageEditorError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "ImageEditorError";
  }
}
export function validateSize({ width, height }: Size): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(width * height)
  )
    throw new ImageEditorError("invalid-dimensions");
  if (width * height > MAX_DECODED_PIXELS)
    throw new ImageEditorError("pixel-limit");
  return width * height;
}
export function validateImage(image: RgbaImage): void {
  if (
    !(image.data instanceof Uint8ClampedArray) ||
    image.data.length !== validateSize(image) * 4
  )
    throw new ImageEditorError("invalid-dimensions");
}
export function guardWorkingSet(...bytes: number[]): void {
  if (
    bytes.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    bytes.reduce((a, b) => a + b, 0) > MAX_WORKING_BYTES
  )
    throw new ImageEditorError("memory-limit");
}
export function allocate(size: Size): RgbaImage {
  return { width: size.width, height: size.height, data: new Uint8ClampedArray(validateSize(size) * 4) };
}
