import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/sitemapper/styles/canvas.css"), "utf8");

describe("Sitemapper canvas containment styles", () => {
  it("contains both axes in the canvas instead of the page", () => {
    const canvasRule = css.match(/\.sg-sitemapper-canvas\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(canvasRule).toContain("width: 100%");
    expect(canvasRule).toContain("max-width: 100%");
    expect(canvasRule).toContain("min-width: 0");
    expect(canvasRule).toContain("min-height: 0");
    expect(canvasRule).toContain("overflow: auto");
    expect(canvasRule).toContain("overscroll-behavior: contain");
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
});
