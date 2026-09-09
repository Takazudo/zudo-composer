import { describe, expect, it } from "vitest";
import {
  applyTone,
  createEditDoc,
  createHistory,
  createToneLut,
  encode,
  fitAspectCrop,
  flipCropRect,
  guardWorkingSet,
  MAX_DECODED_PIXELS,
  MAX_ENCODED_BYTES,
  moveCropRect,
  orientedSize,
  renderToRgba,
  resample,
  resizeCropRect,
  rotateCropRect,
  validateSize,
} from "../index";
import type { CropHandle, RgbaImage } from "../index";
const image = (width = 7, height = 5): RgbaImage => ({
  width,
  height,
  data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 37) % 256,
  ),
});
describe("geometry", () => {
  it("anchors all eight handles and combines physical aspect with centered resizing", () => {
    const c = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
      bounds = { width: 1200, height: 600 };
    for (const handle of [
      "nw",
      "n",
      "ne",
      "e",
      "se",
      "s",
      "sw",
      "w",
    ] as CropHandle[]) {
      const next = resizeCropRect(c, handle, { x: 0.03, y: 0.04 }, bounds);
      if (handle.includes("w")) expect(next.x + next.width).toBeCloseTo(0.6);
      else if (handle.includes("e")) expect(next.x).toBe(0.2);
      if (handle.includes("n")) expect(next.y + next.height).toBeCloseTo(0.6);
      else if (handle.includes("s")) expect(next.y).toBe(0.2);
      const locked = resizeCropRect(c, handle, { x: 0.9, y: 0.8 }, bounds, {
        aspect: 2,
        fromCenter: true,
      });
      expect((locked.width * 1200) / (locked.height * 600)).toBeCloseTo(2);
      expect(locked.x + locked.width / 2).toBeCloseTo(0.4);
      expect(locked.y + locked.height / 2).toBeCloseTo(0.4);
      expect(locked.x).toBeGreaterThanOrEqual(0);
    }
    expect(resizeCropRect(c, "se", { x: -1, y: -1 }, bounds).width).toBe(0.01);
    expect(() =>
      resizeCropRect(c, "se", { x: 0, y: 0 }, bounds, { aspect: 100000 }),
    ).toThrow();
    expect(moveCropRect(c, { x: 1, y: -1 })).toEqual({ ...c, x: 0.6, y: 0 });
    const ogp = fitAspectCrop(bounds, 1200 / 630);
    expect((ogp.width * 1200) / (ogp.height * 600)).toBeCloseTo(1200 / 630);
  });
  it("preserves selected content through quarter turns and flips", () => {
    const c = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    let rotated = c;
    for (let n = 0; n < 4; n++) rotated = rotateCropRect(rotated, 90);
    for (const key of ["x", "y", "width", "height"] as const)
      expect(rotated[key]).toBeCloseTo(c[key]);
    expect(orientedSize({ width: 7, height: 5 }, 90)).toEqual({
      width: 5,
      height: 7,
    });
    expect(flipCropRect(flipCropRect(c, true), true).x).toBeCloseTo(c.x);
    const src = image(4, 2),
      doc = createEditDoc(src);
    doc.crop = { x: 0, y: 0, width: 0.5, height: 1 };
    doc.resize = { width: 2, height: 2 };
    const before = renderToRgba(doc, src);
    doc.crop = rotateCropRect(doc.crop, 90);
    doc.rotate = 90;
    const after = renderToRgba(doc, src);
    expect([...after.data.slice(0, 4)]).toEqual([...before.data.slice(8, 12)]);
  });
});
describe("pixels and guards", () => {
  it("is deterministic and immutable at odd dimensions", () => {
    const src = image(),
      original = src.data.slice(),
      doc = createEditDoc(src);
    doc.resize = { width: 11, height: 9 };
    doc.rotate = 90;
    expect(renderToRgba(doc, src)).toEqual(renderToRgba(doc, src));
    expect(src.data).toEqual(original);
    expect(renderToRgba(createEditDoc(src), src)).toEqual(src);
  });
  it("preserves neutral bytes including transparent RGB and monotonic brightness", () => {
    const src = image();
    src.data[3] = 0;
    const tone = createEditDoc(src).tone;
    expect(applyTone(src, tone)).toEqual(src);
    expect([...createToneLut(tone)]).toEqual(
      Array.from({ length: 256 }, (_, i) => i),
    );
    const lut = createToneLut({ ...tone, brightness: 20 });
    expect([...lut].every((v, i) => i === 0 || v >= lut[i - 1])).toBe(true);
    expect(() => applyTone(src, { ...tone, hue: NaN })).toThrow();
  });
  it("preserves area energy, exact Lanczos dimensions and avoids transparent color fringes", () => {
    const src = image(31, 17);
    const small = resample(src, 3, 2);
    const mean = (data: Uint8ClampedArray) =>
      [0, 1, 2].map(
        (c) =>
          data.filter((_, i) => i % 4 === c).reduce((a, b) => a + b, 0) /
          (data.length / 4),
      );
    mean(src.data).forEach((v, c) =>
      expect(Math.abs(v - mean(small.data)[c])).toBeLessThan(2),
    );
    expect(resample(src, 63, 35)).toMatchObject({ width: 63, height: 35 });
    expect(resample(src, 10, 34)).toMatchObject({ width: 10, height: 34 });
    const edge = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]),
    };
    const up = resample(edge, 12, 1);
    for (let p = 0; p < up.data.length; p += 4) {
      expect(up.data[p + 1]).toBe(0);
      if (up.data[p + 3]) expect(up.data[p]).toBe(255);
    }
  });
  it("rejects unsafe dimensions and budgets before allocating output, and preserves full save size", () => {
    expect(MAX_DECODED_PIXELS).toBe(40_000_000);
    for (const size of [
      { width: 8000, height: 6000 },
      { width: NaN, height: 1 },
      { width: 1.5, height: 2 },
      { width: Number.MAX_SAFE_INTEGER, height: 4 },
    ])
      expect(() => validateSize(size)).toThrow();
    expect(() => guardWorkingSet(513 * 1024 * 1024)).toThrow();
    const src = image(2, 2),
      doc = createEditDoc(src);
    doc.resize = { width: 8000, height: 6000 };
    expect(() => renderToRgba(doc, src, { maxEdge: 2 })).toThrow();
    doc.resize = { width: 768, height: 768 };
    expect(renderToRgba(doc, src, { maxEdge: 10 }).width).toBe(10);
    expect(renderToRgba(doc, src).width).toBe(768);
  });
});
it("bounds document history and treats reset as an undoable edit", () => {
  const doc = createEditDoc(image()),
    history = createHistory(doc, { maxEntries: 3 });
  for (let n = 1; n <= 5; n++)
    history.commit({ ...doc, tone: { ...doc.tone, brightness: n } });
  expect(history.length).toBe(3);
  expect(history.undo().tone.brightness).toBe(4);
  history.reset();
  expect(history.current).toEqual(doc);
  expect(history.undo().tone.brightness).toBe(4);
  history.commit({ ...doc, flipH: true });
  expect(history.canRedo).toBe(false);
  expect(history.byteLength).toBeLessThan(2000);
  expect(() => createHistory(doc, { byteBudget: 1 })).toThrow();
});
it("encodes using injected canvas, flattens JPEG white and rejects fallback/oversize/null", async () => {
  const src = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 0]),
  };
  let pixels: RgbaImage | undefined;
  const seam = {
    imageDataFactory: (value: RgbaImage) => {
      pixels = value;
      return value as ImageData;
    },
  };
  const factory = (blob: Blob | null) => () => ({
    getContext: () => ({ putImageData: () => {} }),
    toBlob: (cb: (b: Blob | null) => void) => cb(blob),
  });
  await encode(src, {
    ...seam,
    type: "image/jpeg",
    canvasFactory: factory(new Blob(["ok"], { type: "image/jpeg" })),
  });
  expect([...pixels!.data]).toEqual([255, 255, 255, 255]);
  expect(src.data[3]).toBe(0);
  await expect(
    encode(src, {
      ...seam,
      type: "image/webp",
      canvasFactory: factory(new Blob(["x"], { type: "image/png" })),
    }),
  ).rejects.toMatchObject({ code: "encode-failed" });
  await expect(
    encode(src, { ...seam, type: "image/png", canvasFactory: factory(null) }),
  ).rejects.toMatchObject({ code: "encode-failed" });
  await expect(
    encode(src, {
      ...seam,
      type: "image/png",
      canvasFactory: factory({
        type: "image/png",
        size: MAX_ENCODED_BYTES + 1,
      } as Blob),
    }),
  ).rejects.toMatchObject({ code: "encoded-limit" });
  await encode(src, {
    ...seam,
    type: "image/webp",
    canvasFactory: () => ({
      getContext: () => ({ putImageData: () => {} }),
      convertToBlob: async (options) => {
        expect(options.quality).toBe(0.9);
        return new Blob(["ok"], { type: options.type });
      },
    }),
  });
});

it("keeps the immutable baseline inside the serialized history budget", () => {
  const doc = createEditDoc(image());
  expect(Object.keys(doc.resize).sort()).toEqual(["height", "width"]);
  const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
  const history = createHistory(doc, { byteBudget: bytes * 3 });
  history.baseline.tone.hue = 90;
  expect(history.baseline.tone.hue).toBe(0);
  history.commit({ ...doc, flipH: true });
  history.commit({ ...doc, flipV: true });
  expect(history.byteLength).toBeLessThanOrEqual(bytes * 3);
  expect(() =>
    resizeCropRect({ ...doc.crop, x: NaN }, "se", { x: 0, y: 0 }, image()),
  ).toThrow();
});

it("reduces the shrinking axis before expanding the other axis", () => {
  const source = {
    width: 1,
    height: 80001,
    data: new Uint8ClampedArray(80001 * 4).fill(255),
  };
  expect(resample(source, 1001, 1)).toMatchObject({ width: 1001, height: 1 });
});
