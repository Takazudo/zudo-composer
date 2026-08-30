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

  it("overrides structural colors without merging semantic state roles", () => {
    const theme = read("src/styles/app-tokens.css");
    for (const token of ["bg", "surface", "surface-2", "border", "fg", "muted", "accent", "accent-hover", "on-accent", "focus"]) {
      expect(theme).toContain(`--color-${token}:`);
    }
    for (const state of ["danger", "success", "warning", "info"]) {
      expect(theme).not.toContain(`--color-${state}:`);
    }
  });
});
