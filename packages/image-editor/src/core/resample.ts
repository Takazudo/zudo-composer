import type { RgbaImage } from "./types";
import {
  allocate,
  guardWorkingSet,
  validateImage,
  validateSize,
} from "./limits";
type Tap = { index: number; weight: number };
const sinc = (x: number) =>
  x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
function taps(index: number, src: number, dst: number): Tap[] {
  if (src === dst) return [{ index, weight: 1 }];
  if (dst < src) {
    const a = (index * src) / dst,
      b = ((index + 1) * src) / dst,
      result: Tap[] = [];
    for (let p = Math.floor(a); p < Math.ceil(b); p++)
      result.push({
        index: Math.min(src - 1, p),
        weight: (Math.min(b, p + 1) - Math.max(a, p)) / (b - a),
      });
    return result;
  }
  const center = ((index + 0.5) * src) / dst - 0.5,
    result: Tap[] = [];
  let total = 0;
  for (let p = Math.ceil(center - 3); p <= Math.floor(center + 3); p++) {
    const distance = center - p,
      weight = Math.abs(distance) < 3 ? sinc(distance) * sinc(distance / 3) : 0;
    result.push({ index: Math.max(0, Math.min(src - 1, p)), weight });
    total += weight;
  }
  return result.map((t) => ({ ...t, weight: t.weight / total }));
}
function* pass(
  source: RgbaImage,
  width: number,
  height: number,
): Generator<void, RgbaImage> {
  validateSize({ width, height });
  guardWorkingSet(
    source.data.byteLength,
    width * height * 4,
    width * 4 * 8 * 8,
  );
  const out = allocate({ width, height });
  // Only the source rows referenced by this output row exist as floating-point scratch.
  for (let y = 0; y < height; y++) {
    if (y % 16 === 0) yield;
    const ys = taps(y, source.height, height),
      rows = ys.map((yt) => {
        const row = new Float64Array(width * 4);
        for (let x = 0; x < width; x++)
          for (const xt of taps(x, source.width, width)) {
            const p = (yt.index * source.width + xt.index) * 4,
              a = source.data[p + 3] / 255;
            row[x * 4] += source.data[p] * a * xt.weight;
            row[x * 4 + 1] += source.data[p + 1] * a * xt.weight;
            row[x * 4 + 2] += source.data[p + 2] * a * xt.weight;
            row[x * 4 + 3] += a * xt.weight;
          }
        return row;
      });
    for (let x = 0; x < width; x++) {
      const values = [0, 0, 0, 0];
      for (let j = 0; j < ys.length; j++)
        for (let c = 0; c < 4; c++)
          values[c] += rows[j][x * 4 + c] * ys[j].weight;
      const p = (y * width + x) * 4,
        a = Math.max(0, Math.min(1, values[3]));
      out.data[p + 3] = a * 255;
      if (a > 1e-8 && out.data[p + 3] > 0)
        for (let c = 0; c < 3; c++) out.data[p + c] = values[c] / values[3];
    }
  }
  return out;
}
export function* resampleSteps(
  source: RgbaImage,
  width: number,
  height: number,
): Generator<void, RgbaImage> {
  validateImage(source);
  validateSize({ width, height });
  if (width === source.width && height === source.height)
    return { ...source, data: source.data.slice() };
  let current = source;
  while (current.width > width * 2 || current.height > height * 2) {
    current = yield* pass(
      current,
      Math.min(current.width, Math.max(width, Math.ceil(current.width / 2))),
      Math.min(current.height, Math.max(height, Math.ceil(current.height / 2))),
    );
  }
  return yield* pass(current, width, height);
}

export function resample(
  source: RgbaImage,
  width: number,
  height: number,
): RgbaImage {
  const steps = resampleSteps(source, width, height);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
