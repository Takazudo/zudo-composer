import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const read = (path: string) => readFileSync(path, "utf8");
const sources = [
  "tests/browser/workspace.responsive.pw.ts",
  "tests/browser/catalog-editorial-journey.ts",
  "tests/browser-dev/workspace-bootstrap.ts",
  "tests/browser-dev/workspace-states.pw.ts",
  "tests/browser-dev/outline-tree.responsive.pw.ts",
];

/** Source contract only: never reports a browser run or visual acceptance. */
describe("final browser acceptance source contract", () => {
  it.each(sources)("%s parses without syntax errors or focused/conditional-adoption escapes", (file) => {
    const source = read(file);
    const compiled = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    expect(compiled.diagnostics?.filter(({ category }) => category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(source).not.toMatch(/\btest\.(?:only|fixme)\s*\(/);
    expect(source).not.toMatch(/has not adopted OutlineTree/);
  });
  it("retains all five breakpoint cases, both themes and the responsive desktop/coarse routing convention", () => {
    const source = read(sources[0]!);
    expect(source).toContain("[1440, 1100, 761, 760, 390]");
    expect(source).toContain('["light", "dark"]');
    for (const path of ["/content", "/composer", "/mapping", "/sitemapper", "/media", "/review"]) expect(source).toContain(`"${path}"`);
    expect(source).toContain('reducedMotion: "reduce"');
    expect(source).toContain('getByRole("dialog", { name: "Navigation"');
    const config = read("playwright.config.ts");
    expect(config).toContain('"**/*.responsive.pw.ts"'); expect(config).toContain("hasTouch: true");
  });
  it("registers the destructive local activation journey last and only in the isolated dev lane", () => {
    const spec = read("tests/browser/site-project-acceptance.pw.ts");
    expect(spec.trimEnd().endsWith("registerCatalogJourney(BROWSER_LANE);")).toBe(true);
    const journey = read(sources[1]!);
    expect(journey).toContain('test.skip(lane !== "dev"');
    expect(journey).toContain("process.env.ZUDO_SITE_PROJECT_ROOT");
    for (const requirement of ["i < 31", "Confirm create separate project", "expectedMutationToken", "stageGeneration", "mediaLock.pins", "Activate locally", "Newer private working B"]) expect(journey).toContain(requirement);
    expect(journey).not.toMatch(/protocolVersion:\s*1\b/);
  });
  it("has explicit degraded-state and keyboard/IME/index assertions, not screenshots alone", () => {
    const states = read(sources[3]!);
    for (const text of ["indexedDB", "Loading media…", "Retry loading", "No assets match these filters."]) expect(states).toContain(text);
    const outline = read(sources[4]!);
    for (const text of ["compositionstart", "compositionend", 'press("Escape")', "Exact first sibling", "Layout probe alpha", "toBeFocused"]) expect(outline).toContain(text);
    expect(read("tests/browser/content.pw.ts")).not.toContain('toHaveCSS("height", "56px")');
  });
});
