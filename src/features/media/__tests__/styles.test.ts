import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/media/styles.css"), "utf8");

describe("Media styling contract", () => {
  it("imports provider tokens and scopes every class", () => {
    expect(css).toContain('@import "@zudo-sg/ui/styles/tokens.css"');
    expect(css).toContain('@import "@zudo-sg/ui/styles/colors.css"');
    const classNames = [...css.slice(css.indexOf(".sg-media")).matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((match) => match[1]);
    expect(classNames.length).toBeGreaterThan(0);
    expect(classNames.every((name) => name.startsWith("sg-media"))).toBe(true);
  });

  it("locks the narrow-safe RAM Gallery grid and intact Details columns", () => {
    expect(css).toContain("repeat(auto-fill, minmax(min(15rem, 100%), 1fr))");
    expect(css).toContain("min-width: 52rem");
    expect(css).toContain("overflow-x: auto");
  });

  it("guards hover, focus, radius, coarse targets, and reduced motion", () => {
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css.slice(0, css.indexOf("@media (hover: hover)"))).not.toContain(":hover");
    expect(css).toContain("outline: 2px solid var(--color-focus)");
    expect(css).toContain("var(--radius-DEFAULT)");
    expect(css).not.toMatch(/border-radius:\s*(?:999|[1-9]\d)px/);
    expect(css).toContain("@media (pointer: coarse)"); expect(css).toContain("min-height: 44px");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
