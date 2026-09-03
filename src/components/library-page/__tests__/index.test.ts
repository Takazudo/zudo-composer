import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as libraryPage from "../index";

const DIRECTORY = resolve("src/components/library-page");
const css = readFileSync(resolve(DIRECTORY, "library-page.css"), "utf8");

/** Comments name issues, colours and example routes; the code must not. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("library-page module", () => {
  it("carries its own stylesheet, so a route importing the pattern gets the CSS", () => {
    expect(readFileSync(resolve(DIRECTORY, "index.ts"), "utf8")).toContain('import "./library-page.css";');
  });

  it("keeps the pattern out of the global stylesheets", () => {
    expect(readFileSync(resolve("src/style.css"), "utf8")).not.toContain("components/library-page");
    expect(readFileSync(resolve("src/base.css"), "utf8")).not.toContain("components/library-page");
  });

  it("styles itself from tokens rather than colour literals", () => {
    const rules = stripComments(css);
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/);
  });

  it("keeps the `cms-` prefix, so no class collides with a generated Tailwind utility", () => {
    const selectors = stripComments(css).match(/\.[A-Za-z][\w-]*/g) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    expect([...new Set(selectors)].filter((selector) => !selector.startsWith(".cms-"))).toEqual([]);
  });

  it("reflows the chrome below 64rem while the table keeps scrolling in its own wrapper", () => {
    const start = css.indexOf("@media (max-width: 64rem)");
    expect(start).toBeGreaterThan(-1);
    // The scrollport belongs to `.cms-table-wrap` in the control library; this
    // sheet must not restyle it out from under the table.
    expect(stripComments(css)).not.toContain(".cms-table-wrap");
  });

  it("names no record type — the pattern is generic over the row contract", () => {
    const sources = readdirSync(DIRECTORY).filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of [...sources, "library-page.css"]) {
      const source = stripComments(readFileSync(resolve(DIRECTORY, name), "utf8"));
      expect(source, name).not.toMatch(/\b(?:Composition|Mapping|Sitemap)s?\b|\b(?:compositions|mappings|sitemaps|media assets)\b/);
    }
  });

  it("exports the pattern the record routes are built from", () => {
    expect(Object.keys(libraryPage).sort()).toEqual(
      [
        "BulkBar",
        "LibraryEmpty",
        "LibraryFacetMenu",
        "LibraryNoMatch",
        "LibraryPage",
        "LibraryPagination",
        "LibraryRecoveryBanner",
        "LibrarySkeleton",
        "LibrarySortMenu",
        "LibraryTable",
        "LibraryToolbar",
        "LibraryUnavailableBanner",
        "LibraryViewToggle",
        "RowMenu",
        "applyLibraryQuery",
        "defaultFacetValues",
        "formatLibraryTimestamp",
        "formatLibraryTimestampFull",
        "isLibraryQueryFiltered",
        "matchesLibrarySearch",
        "toLibraryDate",
        "useLibraryConfirm",
        "useLibraryQuery",
        "useLibrarySelection",
      ].sort(),
    );
  });
});
