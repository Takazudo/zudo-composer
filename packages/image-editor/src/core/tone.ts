import type { RgbaImage, Tone } from "./types";
import { ImageEditorError, validateImage } from "./limits";
export const neutralTone: Tone = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
};
export function createToneLut(tone: Tone): Uint8ClampedArray {
  for (const key of ["brightness", "contrast", "saturation", "hue"] as const)
    if (
      !Number.isFinite(tone[key]) ||
      Math.abs(tone[key]) > (key === "hue" ? 180 : 100)
    )
      throw new ImageEditorError("invalid-document");
  const lut = new Uint8ClampedArray(256),
    factor = (100 + tone.contrast) / Math.max(1, 100 - tone.contrast);
  for (let i = 0; i < 256; i++)
    lut[i] = (i - 127.5) * factor + 127.5 + tone.brightness * 2.55;
  return lut;
}
/** Hue rotates chroma in YIQ space; saturation scales chroma, preserving luma. */
export function* toneSteps(
  image: RgbaImage,
  tone: Tone,
): Generator<void, RgbaImage> {
  validateImage(image);
  const lut = createToneLut(tone);
  const out = { ...image, data: image.data.slice() };
  if (Object.values(tone).every((v) => v === 0)) return out;
  const angle = (tone.hue * Math.PI) / 180,
    cos = Math.cos(angle) * (1 + tone.saturation / 100),
    sin = Math.sin(angle) * (1 + tone.saturation / 100);
  for (let p = 0; p < out.data.length; p += 4) {
    if (p % (image.width * 4 * 16) === 0) yield;
    const r = lut[out.data[p]],
      g = lut[out.data[p + 1]],
      b = lut[out.data[p + 2]];
    if (tone.hue === 0 && tone.saturation === 0) {
      out.data[p] = r;
      out.data[p + 1] = g;
      out.data[p + 2] = b;
      continue;
    }
    const y = 0.299 * r + 0.587 * g + 0.114 * b,
      i = 0.596 * r - 0.274 * g - 0.322 * b,
      q = 0.211 * r - 0.523 * g + 0.312 * b,
      ii = i * cos - q * sin,
      qq = i * sin + q * cos;
    out.data[p] = y + 0.956 * ii + 0.621 * qq;
    out.data[p + 1] = y - 0.272 * ii - 0.647 * qq;
    out.data[p + 2] = y - 1.106 * ii + 1.703 * qq;
  }
  return out;
}

export function applyTone(image: RgbaImage, tone: Tone): RgbaImage {
  const steps = toneSteps(image, tone);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
