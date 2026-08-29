import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/sitemapper/styles/inspector.css"), "utf8");

describe("Sitemapper inspector styles", () => {
  it("uses the existing modal z-index tokens for the picker and backdrop", () => {
    const dialogRule = css.match(/\.sg-sitemapper-picker\s*\{([^}]*)\}/)?.[1] ?? "";
    const backdropRule = css.match(/\.sg-sitemapper-picker::backdrop\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(dialogRule).toContain("z-index: var(--z-index-modal)");
    expect(backdropRule).toContain("z-index: var(--z-index-modal-backdrop)");

    const values = [...css.matchAll(/z-index:\s*([^;]+);/g)].map((match) => match[1]!.trim());
    expect(values).toEqual(["var(--z-index-modal)", "var(--z-index-modal-backdrop)"]);
  });

  it("keeps hover styles inside a hover-capable media query and exposes focus treatment", () => {
    const hoverMedia = css.indexOf("@media (hover: hover)");
    expect(hoverMedia).toBeGreaterThan(-1);
    expect([...css.matchAll(/:hover/g)].every((match) => match.index! > hoverMedia)).toBe(true);
    expect(css).toContain(":focus-visible");
    expect(css).toMatch(/\.sg-sitemapper-inspector__control:focus\s*\{/);
  });

  it("keeps destructive composition actions on the semantic danger color", () => {
    expect(css).toMatch(/\.sg-sitemapper-composition button\.sg-sitemapper-danger\s*\{[^}]*color:\s*var\(--color-danger\)/);
  });
});
