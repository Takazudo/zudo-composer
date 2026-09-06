import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("host and tool CSS ownership", () => {
  it("keeps pack CSS out of the tool's own sheet and loads the host's first", () => {
    // Since Takazudo/zudo-composer#264 the pack's stylesheet belongs to the HOST's `styles`
    // entry. The tool sheet is Tailwind utilities over its own tokens, so a
    // themeset that ships neither cannot break the editor chrome.
    const base = readFileSync(resolve("src/base.css"), "utf8");
    expect(base).not.toContain("@zudo-sg/ui");
    const positions = [
      base.indexOf('@import "tailwindcss/utilities";'),
      base.indexOf('@import "./styles/app-tokens.css";'),
      base.indexOf('@source "./";'),
      base.indexOf("* { box-sizing"),
    ];
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(readFileSync(resolve("src/style.css"), "utf8")).toContain('@import "./base.css";');

    // Both entries pull the host sheet before their own, so the pack's cascade
    // lands first and the chrome's own rules stay on top of it.
    const main = readFileSync(resolve("src/main.tsx"), "utf8");
    expect(main.indexOf('import("virtual:zudo-composer-host-styles")')).toBeGreaterThan(-1);
    expect(main.indexOf('import("virtual:zudo-composer-host-styles")')).toBeLessThan(main.indexOf('import("./style.css")'));
    const preview = readFileSync(resolve("src/features/composer/preview/preview-entry.ts"), "utf8");
    expect(preview.indexOf('import "virtual:zudo-composer-host-styles";')).toBeLessThan(preview.indexOf('import "../../../base.css";'));
  });

  it("makes the dogfood host the sole importer of its pack's CSS", () => {
    // The repo root is a host too: `pnpm dev` and the artifact gates resolve
    // their pack and styles through the root config exactly as an install does.
    const hostStyles = readFileSync(resolve("styles/base.css"), "utf8");
    expect(hostStyles.match(/@zudo-sg\/ui\/styles\/composer\.css/g)).toHaveLength(1);
    const config = readFileSync(resolve("zudo-composer.config.ts"), "utf8");
    expect(config).toContain('pack: "@zudo-sg/ui/composer-pack"');
    expect(config).toContain('styles: "styles/base.css"');
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
    // Since issue #165 the Sitemapper takes its height from the shell's grid
    // instead of re-deriving one, so it neither redefines nor reads the
    // header-height token the other route editors still subtract.
    expect(sitemapperTokens).not.toContain("--sg-header-h");
    expect(sitemapperTokens).not.toContain("100vh");
  });

  it("keeps the configured pack and WASM resources out of Vite's dev dependency optimizer", () => {
    const vite = readFileSync(resolve("vite.config.ts"), "utf8");
    expect(vite).toContain("publicDir: resolvePublicDir(composerConfig.workspaceRoot, composerConfig.paths.publicMedia)");
    // Derived, never spelled out: a literal here would re-hardcode the very
    // provider that `pack` exists to make swappable.
    expect(vite).toMatch(
      /optimizeDeps\s*:\s*\{\s*exclude\s*:\s*\[\s*componentPack\.identity\.packageName\s*,\s*["']@takazudo\/zfb-md-wasm["']\s*\]\s*,?\s*\}/s,
    );
  });

  it("shares one shell height contract and accessible neutral navigation states", () => {
    const tokens = readFileSync(resolve("src/styles/app-tokens.css"), "utf8");
    const shell = readFileSync(resolve("src/app/shell.css"), "utf8");
    // The topbar remains fixed; mobile uses a modal drawer, not a bottom strip.
    expect(tokens).toContain("--zc-topbar-h: 48px");
    expect(tokens).toContain("--zc-rail-w: 244px");
    expect(tokens).toContain("--zc-rail-w-collapsed: 56px");
    // Untouched route editors still compute `calc(100vh - var(--sg-header-h))`.
    expect(tokens).toContain("--sg-header-h: var(--zc-topbar-h)");
    expect(tokens).not.toContain("--zudo-composer-header-height");
    expect(shell).toContain("grid-template-rows: var(--zc-topbar-h) minmax(0, 1fr)");
    expect(shell).toContain("@media (max-width: 760px)");
    expect(shell).toContain("@media (min-width: 761px) and (max-width: 1100px)");
    expect(shell).toContain("--zc-rail-w: 218px");
    expect(shell).toContain("width: min(320px, calc(100vw - 48px))");
    expect(shell).not.toContain("var(--zc-bottom-strip-h)");
    expect(shell).toMatch(/@media \(hover: hover\)[\s\S]*\.cms-rail__item:hover/);
    expect(shell).toMatch(/focus-visible \{ outline: 2px solid var\(--color-focus\)/);
    expect(shell).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
    expect(shell).toContain("overflow-x: clip");
    expect(shell).toContain("@media (prefers-reduced-motion: reduce)");
    // The shell sheet travels with `shell.tsx`, which the preview graph never
    // imports — that isolation is the reason it is not in `src/style.css`.
    expect(readFileSync(resolve("src/app/shell.tsx"), "utf8")).toContain('import "./shell.css";');
    expect(readFileSync(resolve("src/style.css"), "utf8")).not.toMatch(/\.app-header|\.app-route-|\.home-/);
  });
});
