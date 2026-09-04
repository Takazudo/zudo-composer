import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(resolve(path), "utf8");

describe("application theme CSS contract", () => {
  it("loads the app override after the provider stylesheet", () => {
    const base = read("src/base.css");
    expect(base.indexOf('@import "@zudo-sg/ui/styles/composer.css"')).toBeLessThan(
      base.indexOf('@import "./styles/app-tokens.css"'),
    );
  });

  it("uses higher-specificity root attributes so lazy provider chunks cannot win", () => {
    const theme = read("src/styles/app-tokens.css");
    expect(theme).toContain(':root[data-theme="light"]');
    expect(theme).toContain(':root[data-theme="dark"]');
    expect(theme).toMatch(/:root\[data-theme="light"\][\s\S]*color-scheme: light/);
    expect(theme).toMatch(/:root\[data-theme="dark"\][\s\S]*color-scheme: dark/);
    expect(theme).not.toContain("!important");
    expect(theme).not.toMatch(/transition:\s*all/);
    expect(theme).not.toMatch(/filter:\s*invert/);
  });

  it("overrides structural colors and now owns the state roles the CMS chrome speaks", () => {
    const theme = read("src/styles/app-tokens.css");
    for (const token of ["bg", "surface", "surface-2", "border", "fg", "muted", "accent", "accent-hover", "on-accent", "focus"]) {
      expect(theme).toContain(`--color-${token}:`);
    }
    // Epic #156 gives every route one status vocabulary, so danger/success/
    // warning are app roles now — declared in both themes, hue-matched to the
    // provider rungs they supersede. `info` stays the provider's: no chrome
    // surface uses it, and the accent already carries that meaning.
    for (const scheme of ["light", "dark"] as const) {
      const start = theme.indexOf(`:root[data-theme="${scheme}"] {`);
      const block = theme.slice(start, theme.indexOf("\n}", start));
      for (const state of ["danger", "success", "warning"]) expect(block).toContain(`--color-${state}:`);
    }
    expect(theme).not.toContain("--color-info:");
  });

  it("leaves the provider Tier-1 palette alone", () => {
    // The provider's contract is that only its own sheet writes --palette-*;
    // the app maps semantic roles, never raw rungs.
    expect(read("src/styles/app-tokens.css")).not.toContain("--palette-");
  });
});
