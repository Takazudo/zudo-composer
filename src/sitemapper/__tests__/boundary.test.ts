import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SitemapperRouteContent } from "../../features/sitemapper";

const repositoryRoot = resolve(process.cwd());
const roots = [resolve(repositoryRoot, "src/sitemapper"), resolve(repositoryRoot, "src/features/sitemapper")];
const composerDomainImport = /(?:from\s+|import\s*\(\s*)["'][^"']*\/composer(?:\/[^"']*)?["']/;

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }).filter((path) => [".ts", ".tsx", ".mts", ".mjs", ".css"].includes(extname(path)));
}

describe("standalone Sitemapper boundary", () => {
  it("keeps application and historical host dependencies out of the slice", () => {
    const violations: string[] = [];
    for (const file of roots.flatMap(files)) {
      if (file.endsWith("boundary.test.ts")) continue;
      const source = readFileSync(file, "utf8");
      const name = relative(repositoryRoot, file);
      if (/@\/|@takazudo\/zudo-doc|\bzfb\b|@zudo-sg\/ui|styleguide/i.test(source)) {
        violations.push(`${name}: forbidden host dependency`);
      }
      if (/\b(?:legacy|migrat(?:e|ion)|compatibility|alias|adapter|SITEMAP_SCHEMA_V0|ready-with-recovery)\b/i.test(source)) {
        violations.push(`${name}: compatibility branch`);
      }
      if (composerDomainImport.test(source)
        && !name.startsWith("src/sitemapper/catalog/")) {
        violations.push(`${name}: Composer domain import outside catalog`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("recognizes root, static subpath, and dynamic Composer imports", () => {
    expect(composerDomainImport.test('import type { X } from "../../composer"')).toBe(true);
    expect(composerDomainImport.test('import { X } from "../../composer/browser"')).toBe(true);
    expect(composerDomainImport.test('const store = import("../../composer/storage/indexeddb")')).toBe(true);
  });

  it("requires host catalog injection and owns a fresh database identity", () => {
    const app = readFileSync(resolve(repositoryRoot, "src/features/sitemapper/app/production-sitemapper-app.tsx"), "utf8");
    const storage = readFileSync(resolve(repositoryRoot, "src/sitemapper/storage/indexeddb/types.ts"), "utf8");
    expect(app).toContain("catalog: CompositionCatalog");
    expect(app).not.toContain("createIndexedDbCompositionProvider");
    expect(storage).toContain('SITEMAPPER_DATABASE_NAME = "zudo-composer-sitemapper"');
    expect(storage).toContain("SITEMAPPER_DATABASE_VERSION = 1");
    expect(SitemapperRouteContent).toBeTypeOf("function");
  });
});
