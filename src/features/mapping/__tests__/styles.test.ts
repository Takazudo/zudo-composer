import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(`${process.cwd()}/src/features/mapping/styles.css`, "utf8");
describe("Mapping styling contract", () => {
  it("uses scoped provider tokens, flat panels, role spacing and the locked 64rem seam", () => {
    expect(css).toContain(".sg-mapping-workspace"); expect(css).toContain("grid-template-columns: minmax("); expect(css).toContain("min-width: 0"); expect(css).toContain("overscroll-behavior: contain");
    expect(css).toContain("@media (max-width: 63.999rem)"); expect(css).toContain("@media (min-width: 64rem)");
    for (const token of ["--spacing-vsp-2xs", "--spacing-vsp-xs", "--spacing-vsp-10", "--spacing-vsp-sm", "--spacing-hsp-sm", "--spacing-hsp-lg"]) expect(css).toContain(token);
    expect(css).toContain("box-shadow: none"); expect(css).toContain("box-shadow: var(--shadow-overlay)"); expect(css).not.toMatch(/border-radius:\s*(?:999|[1-9]\d)px/);
  });
  it("guards neutral hover, focus, coarse pointers and reduced motion", () => {
    expect(css).toContain("@media (hover: hover)"); expect(css).toContain(":focus-visible"); expect(css).toContain("@media (pointer: coarse)"); expect(css).toContain("min-height: 44px"); expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toContain("word-break: break-all"); expect(css).not.toContain("overflow-x: auto");
  });
});
