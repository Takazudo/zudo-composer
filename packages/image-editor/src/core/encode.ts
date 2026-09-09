import type { EditableMime, RgbaImage } from "./types";
import {
  guardWorkingSet,
  ImageEditorError,
  MAX_ENCODED_BYTES,
  validateImage,
} from "./limits";
export interface EncodingCanvas {
  getContext(
    type: "2d",
  ): { putImageData(data: ImageData, x: number, y: number): void } | null;
  convertToBlob?: (options: {
    type: string;
    quality?: number;
  }) => Promise<Blob>;
  toBlob?: (
    callback: (blob: Blob | null) => void,
    type: string,
    quality?: number,
  ) => void;
}
export type CanvasFactory = (width: number, height: number) => EncodingCanvas;
const defaultFactory: CanvasFactory = (width, height) => {
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};
export async function encode(
  image: RgbaImage,
  options: {
    type: EditableMime;
    quality?: number;
    canvasFactory?: CanvasFactory;
    imageDataFactory?: (image: RgbaImage) => ImageData;
  },
): Promise<Blob> {
  validateImage(image);
  if (!["image/png", "image/jpeg", "image/webp"].includes(options.type))
    throw new ImageEditorError("unsupported-mime");
  const quality =
    options.type === "image/png" ? undefined : (options.quality ?? 0.9);
  if (
    quality !== undefined &&
    (!Number.isFinite(quality) || quality < 0 || quality > 1)
  )
    throw new ImageEditorError("invalid-document");
  // Input, owned flattening copy, ImageData copy and canvas backing.
  // Native encoder scratch and browser overhead remain additional.
  guardWorkingSet(image.data.byteLength * 4);
  try {
    const pixels = { ...image, data: image.data.slice() };
    if (options.type === "image/jpeg")
      for (let p = 0; p < pixels.data.length; p += 4) {
        const a = pixels.data[p + 3] / 255;
        for (let c = 0; c < 3; c++)
          pixels.data[p + c] = pixels.data[p + c] * a + 255 * (1 - a);
        pixels.data[p + 3] = 255;
      }
    const canvas = (options.canvasFactory ?? defaultFactory)(
        image.width,
        image.height,
      ),
      context = canvas.getContext("2d");
    if (!context) throw new ImageEditorError("encode-failed");
    context.putImageData(
      options.imageDataFactory
        ? options.imageDataFactory(pixels)
        : new ImageData(
            new Uint8ClampedArray(pixels.data),
            image.width,
            image.height,
          ),
      0,
      0,
    );
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: options.type, quality })
      : await new Promise<Blob | null>((resolve, reject) => {
          if (!canvas.toBlob) {
            reject(new ImageEditorError("encode-failed"));
            return;
          }
          canvas.toBlob(resolve, options.type, quality);
        });
    if (!blob || blob.type !== options.type)
      throw new ImageEditorError("encode-failed");
    if (blob.size > MAX_ENCODED_BYTES)
      throw new ImageEditorError("encoded-limit");
    return blob;
  } catch (error) {
    if (error instanceof ImageEditorError) throw error;
    throw new ImageEditorError("encode-failed", String(error));
  }
}
