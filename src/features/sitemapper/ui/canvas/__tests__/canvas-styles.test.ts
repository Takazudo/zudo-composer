import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/sitemapper/styles/canvas.css"), "utf8");

describe("Sitemapper canvas containment styles", () => {
  it("contains both axes in the canvas instead of the page", () => {
    const scrollRule = css.match(/\.sg-sitemapper-canvas__scroll\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(scrollRule).toContain("width: 100%");
    expect(scrollRule).toContain("max-width: 100%");
    expect(scrollRule).toContain("min-width: 0");
    expect(scrollRule).toContain("min-height: 0");
    expect(scrollRule).toContain("overflow: auto");
    expect(scrollRule).toContain("overscroll-behavior: contain");
    // Only one element scrolls: the floating controls ride on the frame.
    const canvasRule = css.match(/\.sg-sitemapper-canvas\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(canvasRule).toContain("overflow: hidden");
  });

  it("scales the stage from its own origin so zoom cannot drift the layout", () => {
    const stageRule = css.match(/\.sg-sitemapper-canvas__stage\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(stageRule).toContain("transform-origin: 0 0");
    expect(stageRule).toContain("position: absolute");
  });

  it("uses semantic z-index tokens and no numeric z-index", () => {
    const declarations = [...css.matchAll(/z-index:\s*([^;]+);/g)].map((match) => match[1]!.trim());
    expect(declarations.length).toBeGreaterThan(0);
    expect(declarations.every((value) => /^var\(--z-index-[^)]+\)$/.test(value))).toBe(true);
  });

  it("keeps hover affordances touch-safe", () => {
    const hoverIndexes = [...css.matchAll(/:hover/g)].map((match) => match.index!);
    const hoverMediaStart = css.indexOf("@media (hover: hover)");
    const nextMediaStart = css.indexOf("@media", hoverMediaStart + 1);
    expect(hoverIndexes.length).toBeGreaterThan(0);
    expect(hoverIndexes.every((index) => index > hoverMediaStart && (nextMediaStart < 0 || index < nextMediaStart))).toBe(true);
  });

  it("takes every colour from an application token", () => {
    const colours = [...css.matchAll(/(?:^|[\s:(])(#[0-9a-f]{3,8}|rgb|hsl|oklch)\b/gi)];
    expect(colours).toEqual([]);
  });
});
