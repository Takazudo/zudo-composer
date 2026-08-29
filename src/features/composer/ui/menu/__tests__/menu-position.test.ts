import { describe, expect, it } from "vitest";
import { anchorBelowRect, clampMenuPosition } from "../menu-position";

describe("anchorBelowRect", () => {
  it("anchors left-aligned, just below the rect, with the default 4px gap", () => {
    expect(anchorBelowRect({ x: 10, y: 20, width: 100, height: 24 })).toEqual({ x: 10, y: 48 });
  });

  it("honors a custom gap", () => {
    expect(anchorBelowRect({ x: 0, y: 0, width: 10, height: 10 }, 10)).toEqual({ x: 0, y: 20 });
  });
});

describe("clampMenuPosition", () => {
  const VIEWPORT = { viewportWidth: 800, viewportHeight: 600 };

  it("leaves a position that already fits untouched", () => {
    expect(clampMenuPosition({ x: 100, y: 100, width: 200, height: 150, ...VIEWPORT })).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("clamps an overflow past the RIGHT edge", () => {
    const result = clampMenuPosition({ x: 750, y: 100, width: 200, height: 150, ...VIEWPORT });
    // 800 - 200 - 8(margin) = 592
    expect(result.x).toBe(592);
  });

  it("clamps an overflow past the BOTTOM edge", () => {
    const result = clampMenuPosition({ x: 100, y: 590, width: 200, height: 150, ...VIEWPORT });
    // 600 - 150 - 8(margin) = 442
    expect(result.y).toBe(442);
  });

  it("clamps a negative (off the LEFT/TOP) anchor to the margin", () => {
    const result = clampMenuPosition({ x: -50, y: -20, width: 200, height: 150, ...VIEWPORT });
    expect(result).toEqual({ x: 8, y: 8 });
  });

  it("clamps to the margin (never negative) when the menu is bigger than the viewport", () => {
    const result = clampMenuPosition({
      x: 100,
      y: 100,
      width: 2000,
      height: 2000,
      viewportWidth: 320,
      viewportHeight: 240,
    });
    expect(result).toEqual({ x: 8, y: 8 });
  });

  it("honors a custom margin", () => {
    const result = clampMenuPosition({ x: 790, y: 100, width: 200, height: 150, ...VIEWPORT, margin: 20 });
    expect(result.x).toBe(580); // 800 - 200 - 20
  });
});
