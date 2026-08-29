import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider CSS graph", () => {
  it("imports the canonical provider stylesheet once before app tokens, source, and rules", () => {
    const base = readFileSync(resolve("src/base.css"), "utf8");
    const providerImport = '@import "@zudo-sg/ui/styles/composer.css";';
    expect(base.match(/@zudo-sg\/ui\/styles\/composer\.css/g)).toHaveLength(1);
    const positions = [
      base.indexOf(providerImport),
      base.indexOf('@import "./styles/app-tokens.css";'),
      base.indexOf('@source "./";'),
      base.indexOf("* { box-sizing"),
    ];
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(readFileSync(resolve("src/style.css"), "utf8")).toContain('@import "./base.css";');
    expect(readFileSync(resolve("src/features/composer/preview/preview-entry.ts"), "utf8")).toContain('import "../../../base.css";');
  });

  it("preserves the installed provider import and package-source order", () => {
    const cssPath = fileURLToPath(import.meta.resolve("@zudo-sg/ui/styles/composer.css"));
    const css = readFileSync(cssPath, "utf8");
    const markers = [
      '@import "tailwindcss/preflight";',
      '@import "tailwindcss/utilities";',
      '@import "./tokens.css";',
      '@import "./colors.css";',
      '@import "./syntax-highlight.css";',
      '@import "../src/content/prose-md/prose-md.css";',
      '@source "../src";',
    ];
    const positions = markers.map((marker) => css.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("keeps app tokens structural and enables the Tailwind Vite plugin", () => {
    const tokens = readFileSync(resolve("src/styles/app-tokens.css"), "utf8");
    expect(tokens).not.toMatch(/@import|--zd-|--palette-|syntax-highlight|prose-md/);
    const vite = readFileSync(resolve("vite.config.ts"), "utf8");
    expect(vite).toContain("import tailwindcss from '@tailwindcss/vite'");
    expect(vite).toContain("tailwindcss()");
    const sitemapperTokens = readFileSync(resolve("src/features/sitemapper/styles/tokens.css"), "utf8");
    expect(sitemapperTokens).not.toContain("color-scheme:");
    for (const providerToken of [
      "--color-bg", "--color-surface", "--color-surface-2", "--color-fg", "--color-muted",
      "--color-border", "--color-accent", "--color-accent-hover", "--color-on-accent",
      "--color-focus", "--color-danger", "--color-warning",
      "--text-micro", "--text-caption", "--text-small", "--font-weight-semibold",
      "--radius-sm", "--radius-md", "--radius-full", "--shadow-overlay",
    ]) {
      expect(sitemapperTokens).not.toContain(`${providerToken}:`);
    }
    expect(sitemapperTokens).not.toMatch(/--spacing-(?:hsp|vsp)-[^:]+:/);
    expect(sitemapperTokens).toContain("--sg-header-h:");
  });
});
