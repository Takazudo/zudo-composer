import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// happy-dom does not evaluate real media queries or perform layout. Keep the
// seam and overflow contract deterministic by asserting the authored CSS
// source, as the Composer shell tests do.
const css = readFileSync(resolve(process.cwd(), "src/features/sitemapper/styles/shell.css"), "utf8");

describe("Sitemapper workspace CSS geometry", () => {
  it("uses one minmax canvas column below the 64rem seam", () => {
    expect(css).toMatch(/\.sg-sitemapper-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it("switches to the five-track grid at exactly 64rem", () => {
    expect(css).toContain("@media (min-width: 64rem)");
    const desktopBlock = css.match(/@media \(min-width: 64rem\) \{([\s\S]*?)\n\}\n\n\/\* Generous hit area/);
    expect(desktopBlock).not.toBeNull();
    expect(desktopBlock![1]).toMatch(
      /grid-template-columns:\s*\n\s*var\(--sg-sitemapper-tree-w\)\s*\n\s*var\(--sg-sitemapper-resizer-w\)\s*\n\s*minmax\(0,\s*1fr\)\s*\n\s*var\(--sg-sitemapper-resizer-w\)\s*\n\s*var\(--sg-sitemapper-inspector-w\)/,
    );
  });

  it("hides rails and resizers by CSS below the seam while keeping markup available", () => {
    const narrow = css.slice(0, css.indexOf("@media (min-width: 64rem)"));
    expect(narrow).toMatch(/\.sg-sitemapper-tree-rail,\s*\n\.sg-sitemapper-inspector\s*\{\s*\n\s*display:\s*none;/);
    expect(narrow).toMatch(/\.sg-sitemapper-resizer\s*\{\s*\n\s*display:\s*none;/);
  });

  it("puts effective horizontal containment on the non-root shell", () => {
    expect(css).toMatch(/html\[data-sg-sitemapper-doc\]\s*body\s*\{\s*\n\s*overflow-x:\s*hidden;/);
    expect(css).toMatch(/\.sg-sitemapper-shell\s*\{[\s\S]*?overflow-x:\s*clip;/);
  });

  it("resets min sizes and contains independent scrolling surfaces", () => {
    expect(css).toContain("min-width: 0;");
    expect(css).toContain("min-height: 0;");
    expect(css.match(/overscroll-behavior:\s*contain;/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(css).toMatch(/\.sg-sitemapper-canvas\s*\{[\s\S]*?overflow:\s*auto;/);
  });

  it("uses semantic z-index tokens and no raw z-index values", () => {
    const values = [...css.matchAll(/z-index:\s*([^;]+);/g)].map((match) => match[1]!.trim());
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => /^var\(--z-index-[^)]+\)$/.test(value))).toBe(true);
  });

  it("keeps hover styling touch-safe and gives the resizer a 44px grab strip", () => {
    const hoverStart = css.indexOf("@media (hover: hover)");
    expect(hoverStart).toBeGreaterThanOrEqual(0);
    expect(css.indexOf(".sg-sitemapper-resizer:hover")).toBeGreaterThan(hoverStart);
    expect(css).toContain("inset-inline: calc(-1 * var(--spacing-hsp-lg));");
    expect(css).toContain("@media (pointer: coarse)");
  });

  it("namespaces every shell custom property", () => {
    const customProperties = [...css.matchAll(/--[a-z0-9-]+\s*:/g)].map((match) => match[0]);
    expect(customProperties.length).toBeGreaterThan(0);
    expect(customProperties.every((property) => property.includes("--sg-sitemapper-"))).toBe(true);
  });
});
