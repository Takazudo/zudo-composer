import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/sitemapper/styles/tree.css"), "utf8");

describe("Sitemapper tree styles", () => {
  it("pins semantic indent and guide variables to spacing tokens", () => {
    expect(css).toContain("--sg-sitemapper-tree-indent: var(--spacing-hsp-lg)");
    expect(css).toContain("--sg-sitemapper-tree-guide: var(--spacing-hsp-md)");
    expect(css).toContain("margin-inline-start: var(--sg-sitemapper-tree-indent)");
    expect(css).toContain("inset-inline-start: var(--sg-tree-guide)");
  });

  it("restores at least 44px hit targets for coarse pointers", () => {
    const coarseStart = css.indexOf("@media (pointer: coarse)");
    expect(coarseStart).toBeGreaterThanOrEqual(0);
    const coarse = css.slice(coarseStart);
    expect(coarse).toContain("min-height: 2.75rem");
    expect(coarse).toContain("min-width: 2.75rem");
    expect(coarse).toContain(".sg-sitemapper-tree-select");
    expect(coarse).toContain(".sg-sitemapper-tree-action");
    expect(coarse).toMatch(/\.sg-sitemapper-tree-row\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(coarse).toMatch(/\.sg-sitemapper-tree-row-actions\s*\{[^}]*flex:\s*1 1 100%[^}]*flex-wrap:\s*wrap/);
  });

  it("keeps hover styling behind a hover-capable media query", () => {
    const hoverStart = css.indexOf("@media (hover: hover)");
    expect(hoverStart).toBeGreaterThanOrEqual(0);
    const beforeHover = css.slice(0, hoverStart);
    expect(beforeHover).not.toMatch(/:hover/);
  });

  it("keeps every action control while visually compacting redundant icon labels", () => {
    expect(css).toMatch(/\.sg-sitemapper-tree-row-actions\s*\{[^}]*flex:\s*0 0 auto/);
    expect(css).toMatch(/\.sg-sitemapper-tree-action-label\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.sg-sitemapper-tree-action-label\s*\{[^}]*clip-path:\s*inset\(50%\)/);
    expect(css).not.toMatch(/\.sg-sitemapper-tree-row-actions\s*\{[^}]*display:\s*none/);
    expect(css).not.toMatch(/\.sg-sitemapper-tree-action-label\s*\{[^}]*display:\s*none/);
  });

  it("reserves a readable inline floor for every tree title", () => {
    expect(css).toMatch(/\.sg-sitemapper-tree-select-title\s*\{[^}]*min-inline-size:\s*2rem;/);
  });
});
