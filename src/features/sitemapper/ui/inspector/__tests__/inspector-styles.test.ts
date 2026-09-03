import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/sitemapper/styles/inspector.css"), "utf8");

describe("Sitemapper page-source styles", () => {
  it("keeps hover styles inside a hover-capable media query", () => {
    const hoverMedia = css.indexOf("@media (hover: hover)");
    expect(hoverMedia).toBeGreaterThan(-1);
    expect([...css.matchAll(/:hover/g)].every((match) => match.index! > hoverMedia)).toBe(true);
  });

  it("leaves modal stacking to the shared overlay and declares no z-index of its own", () => {
    expect(css).not.toMatch(/z-index/);
  });

  it("takes every colour from an application token", () => {
    const colours = [...css.matchAll(/(?:^|[\s:(])(#[0-9a-f]{3,8}|rgb|hsl|oklch)\b/gi)];
    expect(colours).toEqual([]);
  });
});
