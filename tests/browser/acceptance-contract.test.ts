import { readFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireIsolatedRoots } from "./isolated-roots";
import { requireHostRoot } from "./isolated-host";
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
      const releaseRoot = join(parent, "release"), mediaRoot = join(parent, "media"), dataRoot = join(parent, "data");
      for (const root of [releaseRoot, mediaRoot, dataRoot]) mkdirSync(root);
      const env = { ZUDO_SITE_PROJECT_ROOT: releaseRoot, ZUDO_MEDIA_STORE_ROOT: mediaRoot, ZUDO_DATA_ROOT: dataRoot };
      expect(requireIsolatedRoots(env)).toEqual({ releaseRoot, mediaRoot, dataRoot });
      for (const invalid of [{}, { ZUDO_SITE_PROJECT_ROOT: releaseRoot }, { ...env, ZUDO_MEDIA_STORE_ROOT: "media-store" },
        { ...env, ZUDO_MEDIA_STORE_ROOT: join(process.cwd(), "media-store") }, { ...env, ZUDO_MEDIA_STORE_ROOT: `${mediaRoot}/` },
        { ...env, ZUDO_MEDIA_STORE_ROOT: releaseRoot }, { ...env, ZUDO_DATA_ROOT: undefined },
        { ...env, ZUDO_DATA_ROOT: join(process.cwd(), "data") }, { ...env, ZUDO_DATA_ROOT: mediaRoot }]) expect(() => requireIsolatedRoots(invalid)).toThrow();
      const config = read("playwright.site-project.config.ts");
      expect(config).toContain("requireIsolatedRoots(process.env)");
      expect(config).toContain("ZUDO_MEDIA_STORE_ROOT: mediaRoot"); expect(config).toContain("ZUDO_DATA_ROOT: dataRoot");
      expect(config).toContain("reuseExistingServer: false");
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("isolates release and Media beneath one cleaned temporary parent for child processes only", () => {
    const runner = read("scripts/run-site-project-browser.mjs");
    expect(runner).toContain('join(temporaryRoot, "release")');
    expect(runner).toContain('join(temporaryRoot, "media")');
    expect(runner).toContain('join(temporaryRoot, "data")');
    expect(runner).toContain("ZUDO_SITE_PROJECT_ROOT: releaseRoot");
    expect(runner).toContain("ZUDO_MEDIA_STORE_ROOT: mediaRoot");
    expect(runner).toContain("ZUDO_DATA_ROOT: dataRoot");
    expect(runner).toMatch(/finally\s*\{\s*await rm\(temporaryRoot, \{ recursive: true, force: true \}\)/);
    expect(runner).not.toMatch(/process\.env\.\w+\s*=/);
    expect(read("server/site-project-local/cli.ts")).toContain("validateMediaStoreRoot(process.env.ZUDO_MEDIA_STORE_ROOT)");
    const vite = read("vite.config.ts");
    expect(vite).toContain("process.env.ZUDO_MEDIA_STORE_ROOT");
    expect(vite).toContain("releaseApiPlugin({ mediaStoreRoot })");
    expect(vite).toMatch(/composerFileProviderPlugin\(\{[\s\S]*?\bmediaStoreRoot,/);
  });
  it("makes the installed-host lane own a disposable host project and reject direct config launch", () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "zudo-composer-host-browser-")));
    try {
      const hostRoot = join(parent, "host");
      mkdirSync(hostRoot);
      expect(requireHostRoot({ ZUDO_COMPOSER_HOST_ROOT: hostRoot })).toBe(hostRoot);
      // A real project root, a relative path, and the temporary parent itself
      // all have to be refused: this lane authors files beneath what it is given.
      for (const invalid of [{}, { ZUDO_COMPOSER_HOST_ROOT: "host" }, { ZUDO_COMPOSER_HOST_ROOT: parent },
        { ZUDO_COMPOSER_HOST_ROOT: process.cwd() }, { ZUDO_COMPOSER_HOST_ROOT: `${hostRoot}/` }]) {
        expect(() => requireHostRoot(invalid)).toThrow();
      }
      const runner = read("scripts/run-host-browser.mjs"), config = read("playwright.host.config.ts");
      expect(JSON.parse(read("package.json")).scripts["test:browser:host"]).toBe("node scripts/run-host-browser.mjs");
      expect(config).toContain("requireHostRoot(process.env)");
      expect(config).toContain("reuseExistingServer: false");
      // The bin, rooted at the disposable host — not this repository's own Vite.
      expect(config).toContain('"bin/zudo-composer.mjs"');
      expect(config).toContain("--strict-port");
      expect(runner).toContain('mkdtemp(join(tmpdir(), "zudo-composer-host-browser-"))');
      expect(runner).toMatch(/finally\s*\{\s*await rm\(temporaryRoot, \{ recursive: true, force: true \}\)/);
      expect(runner).not.toMatch(/process\.env\.\w+\s*=/);
      // The lane populates its libraries through the real release CLI rather
      // than by writing store files behind the application's back.
      expect(runner).toContain('"release"');
      for (const operation of ["plan", "apply", "build", "activate"]) expect(runner).toContain(`operation: "${operation}"`);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it("makes the canonical dev browser lane own isolated roots and reject direct config launch", () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "zudo-composer-dev-browser-")));
    try {
      const releaseRoot = join(parent, "release"), mediaRoot = join(parent, "media"),
        compositionsRoot = join(parent, "compositions"), dataRoot = join(parent, "data");
      for (const root of [releaseRoot, mediaRoot, compositionsRoot, dataRoot]) mkdirSync(root);
      const env = { ZUDO_SITE_PROJECT_ROOT: releaseRoot, ZUDO_MEDIA_STORE_ROOT: mediaRoot, ZUDO_COMPOSITIONS_ROOT: compositionsRoot, ZUDO_DATA_ROOT: dataRoot };
      expect(requireDevBrowserRoots(env)).toEqual({ releaseRoot, mediaRoot, compositionsRoot, dataRoot });
      for (const invalid of [{}, { ZUDO_MEDIA_STORE_ROOT: mediaRoot }, { ...env, ZUDO_MEDIA_STORE_ROOT: join(process.cwd(), "media-store") },
        { ...env, ZUDO_SITE_PROJECT_ROOT: mediaRoot }, { ...env, ZUDO_COMPOSITIONS_ROOT: undefined },
        { ...env, ZUDO_COMPOSITIONS_ROOT: join(process.cwd(), "compositions") }, { ...env, ZUDO_COMPOSITIONS_ROOT: mediaRoot },
        { ...env, ZUDO_DATA_ROOT: undefined }, { ...env, ZUDO_DATA_ROOT: join(process.cwd(), "data") }, { ...env, ZUDO_DATA_ROOT: mediaRoot },
      ]) expect(() => requireDevBrowserRoots(invalid)).toThrow();
      const runner = read("scripts/run-dev-browser.mjs"), config = read("playwright.dev.config.ts"), mediaTest = read("tests/browser-dev/media-upload.pw.ts");
      expect(JSON.parse(read("package.json")).scripts["test:browser:dev"]).toBe("node scripts/run-dev-browser.mjs");
      for (const text of ['join(temporaryRoot, "release")', 'join(temporaryRoot, "media")', 'join(temporaryRoot, "compositions")',
        'join(temporaryRoot, "data")', "ZUDO_SITE_PROJECT_ROOT: releaseRoot", "ZUDO_MEDIA_STORE_ROOT: mediaRoot",
        "ZUDO_COMPOSITIONS_ROOT: compositionsRoot", "ZUDO_DATA_ROOT: dataRoot"]) expect(runner).toContain(text);
      expect(runner).toMatch(/finally\s*\{\s*await rm\(temporaryRoot, \{ recursive: true, force: true \}\)/);
      expect(runner).not.toMatch(/process\.env\.\w+\s*=/); expect(runner).not.toContain(".zudo-site-project"); expect(runner).not.toContain('resolve(root, "media-store")');
      expect(config).toContain("requireDevBrowserRoots(process.env)"); expect(config).toContain("reuseExistingServer: false");
      expect(config).toContain("ZUDO_MEDIA_STORE_ROOT: mediaRoot"); expect(config).toContain("ZUDO_SITE_PROJECT_ROOT: releaseRoot");
      expect(config).toContain("ZUDO_COMPOSITIONS_ROOT: compositionsRoot"); expect(config).toContain("ZUDO_DATA_ROOT: dataRoot");
      // The dev server must take the foreign composition root from that
      // environment, never from the Vite root or the package directory.
      expect(read("plugins/composer-file-provider-plugin.mjs")).toContain('COMPOSITIONS_ROOT_ENV = "ZUDO_COMPOSITIONS_ROOT"');
      // The same root the workspace registry scopes and removes directories
      // under, or the lane would isolate compositions and nothing else.
      const vite = read("vite.config.ts");
      expect(vite).toContain("readRootEnvironment(process.env.ZUDO_COMPOSITIONS_ROOT, 'Compositions root')");
      // Content, mappings, sitemaps and the workspace registry follow the data
      // root, or the lane would isolate compositions and nothing else.
      expect(vite).toContain("readRootEnvironment(process.env.ZUDO_DATA_ROOT, 'Data root')");
      expect(vite).toContain("resolveWorkspaceRegistryRoot(dataRoot ?? composerConfig.paths.data)");
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
    const config = read("playwright.host.config.ts");
    expect(config).toContain('"**/*.responsive.pw.ts"'); expect(config).toContain("hasTouch: true");
  });
  it("has explicit degraded-state and keyboard/IME/index assertions, not screenshots alone", () => {
    const states = read(sources[2]!);
    // The degraded workspace state is reached by refusing the workspace domain
    // provider — the host's filesystem is the only workspace source there is.
    for (const text of ["__zudo_composer_workspace_provider", "Loading media…", "Retry loading",
      "No assets match these filters."]) expect(states).toContain(text);
    const outline = read(sources[3]!);
    for (const text of ["compositionstart", "compositionend", 'press("Escape")', "Exact first sibling", "Layout probe alpha", "toBeFocused"]) expect(outline).toContain(text);
    expect(read("tests/browser/content.pw.ts")).not.toContain('toHaveCSS("height", "56px")');
  });
});
