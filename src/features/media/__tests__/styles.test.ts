import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/media/styles.css"), "utf8");
/** Prose in the header comments names classes and files; only rules are audited. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("Media styling contract", () => {
  it("owns only what a media library adds, and prefixes every class it declares", () => {
    // `src/base.css` already pulls the provider sheets in; a feature stylesheet
    // that imports them again ships the same tokens twice.
    expect(css).not.toContain("@import");
    const classNames = [...rules.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((match) => match[1]!);
    expect(classNames.length).toBeGreaterThan(0);
    // `cms-` names appear only as descendant hooks into the shared controls.
    expect(classNames.every((name) => name.startsWith("sg-media") || name.startsWith("cms-"))).toBe(true);
    expect([...new Set(classNames.filter((name) => name.startsWith("cms-")))].sort()).toEqual(["cms-btn", "cms-check"]);
  });

  it("keeps the drop strip a control-height row rather than a hero box", () => {
    const strip = css.slice(css.indexOf(".sg-media-drop {"), css.indexOf(".sg-media-upload--drag-active"));
    expect(strip).toContain("min-height: 44px");
    expect(strip).not.toContain("aspect-ratio");
    expect(strip).not.toMatch(/(?<![-a-z])height:\s*\d+px/);
  });

  it("keeps the grid narrow-safe and the detail panel out of the way when it cannot be a column", () => {
    expect(css).toContain("repeat(auto-fill, minmax(min(11rem, 100%), 1fr))");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) 320px");
    const narrow = css.slice(css.indexOf("@media (max-width: 64rem)"));
    expect(narrow).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(narrow).toContain(".sg-media-detail { position: static; }");
  });

  it("reveals tile controls on hover only where hover exists", () => {
    const hoverQuery = "@media (hover: hover) and (pointer: fine)";
    expect(css).toContain(hoverQuery);
    expect(css.slice(0, css.indexOf(hoverQuery))).not.toContain(":hover");
    // Outside the query the controls stay visible, so a coarse pointer can
    // still reach the checkbox and the row menu.
    expect(css.slice(0, css.indexOf(hoverQuery))).not.toContain("opacity: 0");
    expect(css.slice(css.indexOf(hoverQuery))).toContain(":focus-within");
  });

  it("guards focus, radius, coarse targets, and reduced motion", () => {
    expect(css).toContain("outline: 2px solid var(--color-focus)");
    expect(css).toContain("var(--radius)");
    expect(css).not.toMatch(/border-radius:\s*(?:999|[1-9]\d)px/);
    expect(css).toContain("@media (pointer: coarse)");
    expect(css.slice(css.indexOf("@media (pointer: coarse)"))).toContain("min-height: 44px");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
