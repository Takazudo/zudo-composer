import { readFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireIsolatedRoots } from "./isolated-roots";
import { requireDevBrowserRoots } from "../browser-dev/isolated-roots";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const read = (path: string) => readFileSync(path, "utf8");
const sources = [
  "tests/browser/workspace.responsive.pw.ts",
  "tests/browser-dev/workspace-bootstrap.ts",
  "tests/browser-dev/workspace-states.pw.ts",
  "tests/browser-dev/outline-tree.responsive.pw.ts",
  "tests/browser-dev/media-upload.pw.ts",
];

/** Source contract only: never reports a browser run or visual acceptance. */
describe("final browser acceptance source contract", () => {
  it("rejects missing, default, unresolved and unrelated roots before browser server startup", () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "zudo-composer-site-project-browser-")));
    try {
      const releaseRoot = join(parent, "release"), mediaRoot = join(parent, "media");
      mkdirSync(releaseRoot); mkdirSync(mediaRoot);
      const env = { ZUDO_SITE_PROJECT_ROOT: releaseRoot, ZUDO_MEDIA_STORE_ROOT: mediaRoot };
      expect(requireIsolatedRoots(env)).toEqual({ releaseRoot, mediaRoot });
      for (const invalid of [{}, { ZUDO_SITE_PROJECT_ROOT: releaseRoot }, { ...env, ZUDO_MEDIA_STORE_ROOT: "media-store" },
        { ...env, ZUDO_MEDIA_STORE_ROOT: join(process.cwd(), "media-store") }, { ...env, ZUDO_MEDIA_STORE_ROOT: `${mediaRoot}/` },
        { ...env, ZUDO_MEDIA_STORE_ROOT: releaseRoot }]) expect(() => requireIsolatedRoots(invalid)).toThrow();
      const config = read("playwright.site-project.config.ts");
      expect(config).toContain("requireIsolatedRoots(process.env)");
      expect(config).toContain("ZUDO_MEDIA_STORE_ROOT: mediaRoot");
      expect(config).toContain("reuseExistingServer: false");
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("isolates release and Media beneath one cleaned temporary parent for child processes only", () => {
    const runner = read("scripts/run-site-project-browser.mjs");
    expect(runner).toContain('join(temporaryRoot, "release")');
    expect(runner).toContain('join(temporaryRoot, "media")');
    expect(runner).toContain("ZUDO_SITE_PROJECT_ROOT: releaseRoot");
    expect(runner).toContain("ZUDO_MEDIA_STORE_ROOT: mediaRoot");
    expect(runner).toMatch(/finally\s*\{\s*await rm\(temporaryRoot, \{ recursive: true, force: true \}\)/);
    expect(runner).not.toMatch(/process\.env\.\w+\s*=/);
    expect(read("server/site-project-local/cli.ts")).toContain("validateMediaStoreRoot(process.env.ZUDO_MEDIA_STORE_ROOT)");
    const vite = read("vite.config.ts");
    expect(vite).toContain("process.env.ZUDO_MEDIA_STORE_ROOT");
    expect(vite).toContain("releaseApiPlugin({ mediaStoreRoot })");
    expect(vite).toContain("composerFileProviderPlugin({ mediaStoreRoot })");
  });
  it("makes the canonical dev browser lane own isolated roots and reject direct config launch", () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "zudo-composer-dev-browser-")));
    try {
      const releaseRoot = join(parent, "release"), mediaRoot = join(parent, "media"); mkdirSync(releaseRoot); mkdirSync(mediaRoot);
      const env = { ZUDO_SITE_PROJECT_ROOT: releaseRoot, ZUDO_MEDIA_STORE_ROOT: mediaRoot };
      expect(requireDevBrowserRoots(env)).toEqual({ releaseRoot, mediaRoot });
      for (const invalid of [{}, { ZUDO_MEDIA_STORE_ROOT: mediaRoot }, { ...env, ZUDO_MEDIA_STORE_ROOT: join(process.cwd(), "media-store") }, { ...env, ZUDO_SITE_PROJECT_ROOT: mediaRoot }]) expect(() => requireDevBrowserRoots(invalid)).toThrow();
      const runner = read("scripts/run-dev-browser.mjs"), config = read("playwright.dev.config.ts"), mediaTest = read("tests/browser-dev/media-upload.pw.ts");
      expect(JSON.parse(read("package.json")).scripts["test:browser:dev"]).toBe("node scripts/run-dev-browser.mjs");
      for (const text of ['join(temporaryRoot, "release")', 'join(temporaryRoot, "media")', "ZUDO_SITE_PROJECT_ROOT: releaseRoot", "ZUDO_MEDIA_STORE_ROOT: mediaRoot"]) expect(runner).toContain(text);
      expect(runner).toMatch(/finally\s*\{\s*await rm\(temporaryRoot, \{ recursive: true, force: true \}\)/);
      expect(runner).not.toMatch(/process\.env\.\w+\s*=/); expect(runner).not.toContain(".zudo-site-project"); expect(runner).not.toContain('resolve(root, "media-store")');
      expect(config).toContain("requireDevBrowserRoots(process.env)"); expect(config).toContain("reuseExistingServer: false");
      expect(config).toContain("ZUDO_MEDIA_STORE_ROOT: mediaRoot"); expect(config).toContain("ZUDO_SITE_PROJECT_ROOT: releaseRoot");
      expect(mediaTest).toContain("requireDevBrowserRoots(process.env)"); expect(mediaTest).toContain('join(mediaRoot, "versions"');
      expect(mediaTest).not.toContain('resolve("media-store/versions"');
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
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
  it("has explicit degraded-state and keyboard/IME/index assertions, not screenshots alone", () => {
    const states = read(sources[2]!);
    for (const text of ["indexedDB", "Loading media…", "Retry loading", "No assets match these filters."]) expect(states).toContain(text);
    const outline = read(sources[3]!);
    for (const text of ["compositionstart", "compositionend", 'press("Escape")', "Exact first sibling", "Layout probe alpha", "toBeFocused"]) expect(outline).toContain(text);
    expect(read("tests/browser/content.pw.ts")).not.toContain('toHaveCSS("height", "56px")');
  });
});
