import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/content/styles.css"), "utf8");
/** Prose is not a selector; every structural assertion reads the rules only. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("Content styling contract", () => {
  it("imports provider tokens and scopes selectors", () => {
    expect(css).toContain('@import "@zudo-sg/ui/styles/tokens.css"');
    expect(css).toContain('@import "@zudo-sg/ui/styles/colors.css"');
    const classNames = [...rules.slice(rules.indexOf(".sg-content")).matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((match) => match[1]);
    expect(classNames.length).toBeGreaterThan(0);
    expect(classNames.every((name) => name.startsWith("sg-content"))).toBe(true);
  });

  it("leaves the shared chrome's own controls alone", () => {
    // `.sg-content-app` sits on `cms-editor`, so a bare element selector under
    // the route root would repaint the toolbar, the navigator and the panes —
    // controls this route does not own. Only the route's own classes and the
    // reduced-motion reset may hang off it.
    const rooted = [...rules.matchAll(/\.sg-content-app[^{,]*/g)].map((match) => match[0].trim());
    expect(rooted.length).toBeGreaterThan(0);
    expect(rooted.filter((selector) => !/^\.sg-content-app(--state)?( \*)?$/.test(selector))).toEqual([]);
    // The form's own resets carry their scope with them.
    expect(rules).toContain(".sg-content-form :where(button, input, select, textarea)");
  });

  it("locks the responsive seam, shrinking guards, and flat panels", () => {
    expect(css).toContain("@media (max-width: 63.999rem)"); expect(css).toContain("minmax(0, 1fr)"); expect(css).toContain("min-width: 0");
    expect(css).toContain("overscroll-behavior: contain"); expect(css).toContain("box-shadow: none");
  });

  it("guards neutral hover, coarse 44px targets, focus, radius, and reduced motion", () => {
    expect(css).toContain("@media (hover: hover)"); expect(css).toContain("background: var(--color-surface-2)");
    expect(css).toContain("@media (pointer: coarse)"); expect(css).toContain("min-height: 44px");
    expect(css).toContain("outline: 2px solid var(--color-focus)"); expect(css).toContain("var(--radius-DEFAULT)");
    expect(css).not.toMatch(/border-radius:\s*(?:999|[1-9]\d)px/); expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("uses the locked dense role pairs and no unguarded hover selectors", () => {
    for (const value of ["--spacing-vsp-2xs", "--spacing-vsp-xs", "--spacing-vsp-10", "--spacing-vsp-sm", "--spacing-hsp-sm", "--spacing-hsp-lg"]) expect(css).toContain(value);
    expect(rules.slice(0, rules.indexOf("@media (hover: hover)"))).not.toContain(":hover");
    expect(css).not.toContain("word-break: break-all");
  });
});
