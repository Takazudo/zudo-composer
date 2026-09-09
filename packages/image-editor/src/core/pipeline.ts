import type { EditDoc, RgbaImage } from "./types";
import {
  allocate,
  guardWorkingSet,
  validateImage,
  validateSize,
} from "./limits";
import { orientedSize, validateEditDoc } from "./geometry";
import { resampleSteps } from "./resample";
import { toneSteps } from "./tone";
export function* renderSteps(
  doc: EditDoc,
  source: RgbaImage,
  options: { maxEdge?: number } = {},
): Generator<void, RgbaImage> {
  validateImage(source);
  validateEditDoc(doc, source);
  let { width, height } = doc.resize;
  if (options.maxEdge !== undefined) {
    validateSize({ width: options.maxEdge, height: 1 });
    const scale = Math.min(1, options.maxEdge / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  const oriented = orientedSize(source, doc.rotate),
    c = doc.crop,
    x0 = Math.max(0, Math.floor(c.x * oriented.width)),
    y0 = Math.max(0, Math.floor(c.y * oriented.height)),
    x1 = Math.min(oriented.width, Math.ceil((c.x + c.width) * oriented.width)),
    y1 = Math.min(
      oriented.height,
      Math.ceil((c.y + c.height) * oriented.height),
    );
  const cropSize = {
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  };
  // Source, geometry, area-step buffers, output/tone copies, row scratch and resident preview.
  guardWorkingSet(
    source.data.byteLength,
    validateSize(cropSize) * 12,
    width * height * 12,
    Math.max(width, cropSize.width) * 256,
    1024 * 1024 * 8,
  );
  const crop = allocate(cropSize);
  for (let y = 0; y < crop.height; y++) {
    if (y % 16 === 0) yield;
    for (let x = 0; x < crop.width; x++) {
      const ox = doc.flipH ? oriented.width - 1 - (x + x0) : x + x0,
        oy = doc.flipV ? oriented.height - 1 - (y + y0) : y + y0;
      const [sx, sy] =
        doc.rotate === 90
          ? [oy, source.height - 1 - ox]
          : doc.rotate === 180
            ? [source.width - 1 - ox, source.height - 1 - oy]
            : doc.rotate === 270
              ? [source.width - 1 - oy, ox]
              : [ox, oy];
      const p = (sy * source.width + sx) * 4;
      crop.data.set(source.data.subarray(p, p + 4), (y * crop.width + x) * 4);
    }
  }
  return yield* toneSteps(yield* resampleSteps(crop, width, height), doc.tone);
}
export function renderToImageData(doc: EditDoc, source: RgbaImage): ImageData {
  const result = renderToRgba(doc, source);
  return new ImageData(
    new Uint8ClampedArray(result.data),
    result.width,
    result.height,
  );
}

export function renderToRgba(
  doc: EditDoc,
  source: RgbaImage,
  options: { maxEdge?: number } = {},
): RgbaImage {
  const steps = renderSteps(doc, source, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
