import type { EditDoc, Rect, Size } from "./types";
import { ImageEditorError, validateSize } from "./limits";
export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const bad = (): never => {
  throw new ImageEditorError("invalid-document");
};
export function orientedSize(size: Size, rotate: number): Size {
  validateSize(size);
  if (![0, 90, 180, 270].includes(rotate)) bad();
  return rotate % 180
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}
export function createEditDoc(size: Size): EditDoc {
  validateSize(size);
  return {
    crop: { x: 0, y: 0, width: 1, height: 1 },
    rotate: 0,
    flipH: false,
    flipV: false,
    resize: { width: size.width, height: size.height },
    tone: { brightness: 0, contrast: 0, saturation: 0, hue: 0 },
  };
}
function validateRect(c: Rect): void {
  if (
    ![c.x, c.y, c.width, c.height].every(Number.isFinite) ||
    c.x < 0 ||
    c.y < 0 ||
    c.width <= 0 ||
    c.height <= 0 ||
    c.x + c.width > 1 + 1e-12 ||
    c.y + c.height > 1 + 1e-12
  )
    bad();
}
export function validateEditDoc(doc: EditDoc, size: Size): void {
  validateSize(size);
  validateSize(doc.resize);
  const c = doc.crop;
  validateRect(c);
  const oriented = orientedSize(size, doc.rotate);
  if (
    c.width + 1e-12 < Math.max(0.01, 1 / oriented.width) ||
    c.height + 1e-12 < Math.max(0.01, 1 / oriented.height)
  )
    bad();
  if (
    ![0, 90, 180, 270].includes(doc.rotate) ||
    typeof doc.flipH !== "boolean" ||
    typeof doc.flipV !== "boolean" ||
    ![c.x, c.y, c.width, c.height].every(Number.isFinite) ||
    c.x < 0 ||
    c.y < 0 ||
    c.width <= 0 ||
    c.height <= 0 ||
    c.x + c.width > 1 + 1e-12 ||
    c.y + c.height > 1 + 1e-12
  )
    bad();
  for (const [key, value] of Object.entries(doc.tone))
    if (
      !Number.isFinite(value) ||
      Math.abs(value) > (key === "hue" ? 180 : 100)
    )
      bad();
  for (const key of ["brightness", "contrast", "saturation", "hue"] as const)
    if (!Number.isFinite(doc.tone[key])) bad();
}
export function rotateCropRect(c: Rect, angle: 0 | 90 | 180 | 270): Rect {
  validateRect(c);
  if (![0, 90, 180, 270].includes(angle)) bad();
  if (angle === 90)
    return {
      x: Math.max(0, 1 - c.y - c.height),
      y: c.x,
      width: c.height,
      height: c.width,
    };
  if (angle === 180)
    return {
      x: Math.max(0, 1 - c.x - c.width),
      y: Math.max(0, 1 - c.y - c.height),
      width: c.width,
      height: c.height,
    };
  if (angle === 270)
    return {
      x: c.y,
      y: Math.max(0, 1 - c.x - c.width),
      width: c.height,
      height: c.width,
    };
  return { ...c };
}
export function flipCropRect(c: Rect, horizontal: boolean): Rect {
  validateRect(c);
  return {
    ...c,
    ...(horizontal
      ? { x: Math.max(0, 1 - c.x - c.width) }
      : { y: Math.max(0, 1 - c.y - c.height) }),
  };
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export function moveCropRect(c: Rect, delta: { x: number; y: number }): Rect {
  validateRect(c);
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) bad();
  return {
    ...c,
    x: clamp(c.x + delta.x, 0, 1 - c.width),
    y: clamp(c.y + delta.y, 0, 1 - c.height),
  };
}
/** Bounds are the oriented source pixel dimensions; deltas and rectangles are normalized. */
export function resizeCropRect(
  start: Rect,
  handle: CropHandle,
  delta: { x: number; y: number },
  bounds: Size,
  options: { aspect?: number; fromCenter?: boolean } = {},
): Rect {
  validateSize(bounds);
  validateRect(start);
  if (
    !["nw", "n", "ne", "e", "se", "s", "sw", "w"].includes(handle) ||
    ![delta.x, delta.y].every(Number.isFinite)
  )
    bad();
  const sx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0,
    sy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const center = options.fromCenter ?? false,
    factor = center ? 2 : 1;
  const ax =
    center || !sx
      ? start.x + start.width / 2
      : sx < 0
        ? start.x + start.width
        : start.x;
  const ay =
    center || !sy
      ? start.y + start.height / 2
      : sy < 0
        ? start.y + start.height
        : start.y;
  const maxW = center || !sx ? 2 * Math.min(ax, 1 - ax) : sx < 0 ? ax : 1 - ax;
  const maxH = center || !sy ? 2 * Math.min(ay, 1 - ay) : sy < 0 ? ay : 1 - ay;
  const minW = Math.max(1 / bounds.width, 0.01),
    minH = Math.max(1 / bounds.height, 0.01);
  let w = start.width + sx * delta.x * factor,
    h = start.height + sy * delta.y * factor;
  if (options.aspect !== undefined) {
    if (!Number.isFinite(options.aspect) || options.aspect <= 0) bad();
    const ratio = (options.aspect * bounds.height) / bounds.width;
    const low = Math.max(minW, minH * ratio),
      high = Math.min(maxW, maxH * ratio);
    if (low > high + 1e-12) bad();
    if (
      !sx ||
      (sy && Math.abs(h - start.height) * ratio > Math.abs(w - start.width))
    )
      w = h * ratio;
    w = clamp(w, low, high);
    h = w / ratio;
  } else {
    if (minW > maxW || minH > maxH) bad();
    w = sx ? clamp(w, minW, maxW) : start.width;
    h = sy ? clamp(h, minH, maxH) : start.height;
  }
  return {
    x: center || !sx ? ax - w / 2 : sx < 0 ? ax - w : ax,
    y: center || !sy ? ay - h / 2 : sy < 0 ? ay - h : ay,
    width: w,
    height: h,
  };
}
export function fitAspectCrop(bounds: Size, aspect: number): Rect {
  validateSize(bounds);
  if (!Number.isFinite(aspect) || aspect <= 0) bad();
  const ratio = (aspect * bounds.height) / bounds.width;
  const width = Math.min(1, ratio),
    height = Math.min(1, 1 / ratio);
  if (
    width < Math.max(0.01, 1 / bounds.width) ||
    height < Math.max(0.01, 1 / bounds.height)
  )
    bad();
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
