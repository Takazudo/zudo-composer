import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const featureDir = resolve(process.cwd(), "src/features/mapping");
const css = readFileSync(resolve(featureDir, "styles.css"), "utf8");
const sources = readdirSync(featureDir)
  .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
  .map((name) => readFileSync(resolve(featureDir, name), "utf8"))
  .join("\n");

describe("Mapping route styling contract", () => {
  it("scopes every rule to the route, so no foundation is restyled from here", () => {
    // The chrome, controls, table, panes, menus and dialogs bring their own CSS
    // with them; this sheet is a thin layer over them, and `src/base.css` scans
    // this tree, so an unprefixed selector would also collide with a generated
    // Tailwind utility of the same name.
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*)\{/g)]
      .map((match) => match[1]!.trim())
      .filter((selector) => selector !== "" && !selector.startsWith("@"))
      .flatMap((group) => group.split(",").map((selector) => selector.trim()));

    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((selector) => !selector.startsWith(".cms-mapping-"))).toEqual([]);
    for (const owned of ["cms-mapping-root", "cms-mapping-cell", "cms-mapping-unbound__chip", "cms-mapping-bind-menu__detail"]) {
      expect(css).toContain(`.${owned}`);
    }
  });

  it("has retired the sg-mapping surface entirely", () => {
    expect(css).not.toContain("sg-mapping");
    expect(sources).not.toContain("sg-mapping");
    // The old sheet reached past the app tokens into the provider's own.
    expect(css).not.toContain("@zudo-sg/ui/styles");
  });

  it("reads colour and spacing from the app tokens rather than literals", () => {
    expect(css).not.toMatch(/:\s*#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/:\s*(?:oklch|rgb|hsl)\(/);
    for (const token of ["--color-fg", "--color-muted", "--color-faint", "--color-border", "--sp-2", "--radius"]) {
      expect(css).toContain(token);
    }
  });

  it("keeps the touch and hover guards the epic requires", () => {
    expect(css).toContain("@media (hover: hover)");
    expect(css).toContain("@media (pointer: coarse)");
    expect(css).toContain("min-height: 44px");
  });
});
