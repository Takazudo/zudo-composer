import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createModuleEvaluator } from "../../module-evaluator.mjs";
import { enforceComputedLoadBoundary } from "../load-boundary";
import { collectPackSourceGraph } from "../pack-source-graph";

async function host(files: Record<string, string>): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "pack-source-graph-"));
  const root = join(parent, "host");
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "host", type: "module", exports: { "./components": "./components/index.tsx" } }),
    "components/index.tsx": "export const Widget = () => <div />;\n",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const collect = (root: string, extra: { sourceModules?: string[]; extraRoots?: string[] } = {}) =>
  collectPackSourceGraph({ hostRoot: root, entryPath: join(root, "pack.ts"), sourceModules: extra.sourceModules ?? [], extraRoots: extra.extraRoots });

const dependency = {
  "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.2.3", exports: { ".": "./index.js", "./style.css": "./style.css" } }),
  "node_modules/dep/index.js": "export const h = 1;\n",
  "node_modules/dep/style.css": ".dep {}\n",
  "node_modules/@scope/lib/package.json": JSON.stringify({ name: "@scope/lib", version: "0.4.0", exports: "./index.js" }),
  "node_modules/@scope/lib/index.js": "export const lib = 1;\n",
  "node_modules/preact/package.json": JSON.stringify({ name: "preact", version: "10.0.0", exports: { "./jsx-runtime": "./jsx-runtime.js" } }),
  "node_modules/preact/jsx-runtime.js": "export const jsx = () => null;\n",
};

describe("collectPackSourceGraph", () => {
  it("follows scripts, re-exports, JSON, CSS and assets and records installed packages", async () => {
    const root = await host({
      ...dependency,
      "pack.ts": [
        'import type { Shape } from "./types";',
        'import { value } from "./lib/value";',
        'export * from "./reexport";',
        'import data from "./data.json";',
        'import raw from "./notes.txt?raw";',
        'import href from "./font.woff2?url";',
        'import inlined from "./inline.css?inline";',
        'import logo from "./logo.svg";',
        'import "./styles.css";',
        'import { h } from "dep";',
        'import { lib } from "@scope/lib";',
        'import { readFileSync } from "node:fs";',
        'import legacy from "./legacy.cjs";',
        'const lazy = () => import("./lazy");',
        'const template = () => import(`./template`);',
        'const asset = new URL("./asset.bin", import.meta.url);',
        "export const all: Shape | undefined = undefined;",
        "export { value, data, raw, href, inlined, logo, h, lib, lazy, template, asset, readFileSync, legacy };",
      ].join("\n"),
      "types.ts": "export interface Shape { a: number }\n",
      "lib/value.ts": 'export { deep } from "../deep";\nexport const value = 1;\n',
      "deep.ts": "export const deep = 1;\n",
      "reexport.tsx": "export const Re = () => <span />;\n",
      "data.json": "{}\n",
      "notes.txt": "raw import that must not be parsed as { code\n",
      "font.woff2": "font",
      "inline.css": '@import "./inline-nested.css";\n',
      "inline-nested.css": ".n {}\n",
      "logo.svg": "<svg />",
      "styles.css": '/* @import "./commented.css"; */\n@import "./nested.css";\n@import url(dep/style.css);\n.a { background: url("./images/bg.png"); mask: url(data:image/png;base64,AA); }\n.b { background: url(https://example.com/x.png); }\n',
      "nested.css": ".c { background: url(./images/nested.png) }\n",
      "images/bg.png": "png",
      "images/nested.png": "png",
      "lazy.ts": "export const lazy = 1;\n",
      "legacy.cjs": 'module.exports = require("./legacy-dep.cjs");\n',
      "legacy-dep.cjs": "module.exports = 1;\n",
      "template.ts": "export const template = 1;\n",
      "asset.bin": "bin",
    });
    const graph = await collect(root, { sourceModules: ["host/components"] });
    expect(graph.files).toEqual([
      "asset.bin",
      "components/index.tsx",
      "data.json",
      "deep.ts",
      "font.woff2",
      "images/bg.png",
      "images/nested.png",
      "inline-nested.css",
      "inline.css",
      "lazy.ts",
      "legacy-dep.cjs",
      "legacy.cjs",
      "lib/value.ts",
      "logo.svg",
      "nested.css",
      "notes.txt",
      "pack.ts",
      "reexport.tsx",
      "styles.css",
      "template.ts",
    ]);
    expect(graph.dependencies).toEqual([
      { name: "@scope/lib", version: "0.4.0" },
      { name: "dep", version: "1.2.3" },
      // The automatic JSX runtime import is part of the loaded graph.
      { name: "preact", version: "10.0.0" },
    ]);
  });

  it("takes extra roots such as the host stylesheet", async () => {
    const root = await host({ "pack.ts": "export {};\n", "styles/base.css": '@import "./more.css";\n', "styles/more.css": "" });
    expect((await collect(root, { extraRoots: [join(root, "styles/base.css")] })).files).toEqual(["pack.ts", "styles/base.css", "styles/more.css"]);
  });

  it("resolves tailwindcss CSS subpaths from the tool root when the host installs no tailwindcss", async () => {
    const root = await host({ "pack.ts": "export {};\n", "styles/base.css": '@import "tailwindcss/theme" layer(theme);\n@import "tailwindcss/preflight";\n' });
    const graph = await collect(root, { extraRoots: [join(root, "styles/base.css")] });
    expect(graph.files).toEqual(["pack.ts", "styles/base.css"]);
    expect(graph.dependencies.map((entry) => entry.name)).toEqual(["tailwindcss"]);
  });

  it("records a bare CSS @import through an exports style/.css mapping in an isolated pnpm layout", async () => {
    const store = "node_modules/.pnpm/kit@2.0.0/node_modules/kit";
    const root = await host({
      "pack.ts": "export {};\n",
      "styles/base.css": '@import "kit/theme";\n@import "kit/base.css";\n',
      [`${store}/package.json`]: JSON.stringify({ name: "kit", version: "2.0.0", exports: { "./theme": { style: "./dist/theme.css" }, "./base.css": "./dist/base.css" } }),
      [`${store}/dist/theme.css`]: ".theme {}\n",
      [`${store}/dist/base.css`]: ".base {}\n",
    });
    await symlink(join(root, store), join(root, "node_modules/kit"), "dir");
    const graph = await collect(root, { extraRoots: [join(root, "styles/base.css")] });
    expect(graph.files).toEqual(["pack.ts", "styles/base.css"]);
    expect(graph.dependencies).toEqual([{ name: "kit", version: "2.0.0" }]);
  });

  it("resolves CSS url() fragments and cache-busting queries to the file", async () => {
    const root = await host({
      "pack.ts": 'import "./icons.css";\n',
      "icons.css": ".icon { background: url(sprite.svg#icon); }\n@font-face { src: url(font.eot?#iefix) format(\"embedded-opentype\"); }\n",
      "sprite.svg": "<svg/>",
      "font.eot": "",
    });
    expect((await collect(root)).files).toEqual(["font.eot", "icons.css", "pack.ts", "sprite.svg"]);
  });

  it("skips an unresolvable root-absolute CSS url() but records one that resolves", async () => {
    const root = await host({
      "pack.ts": 'import "./fonts.css";\n',
      "fonts.css": "@font-face { src: url(/fonts/public.woff2); }\n.logo { background: url(/logo.svg); }\n",
      "logo.svg": "<svg/>",
    });
    expect((await collect(root)).files).toEqual(["fonts.css", "logo.svg", "pack.ts"]);
  });

  it("still fails closed on an unresolvable relative CSS url()", async () => {
    const root = await host({
      "pack.ts": 'import "./broken.css";\n',
      "broken.css": ".x { background: url(missing.png); }\n",
    });
    await expect(collect(root)).rejects.toThrow(/does not resolve/);
  });

  it.each([
    ["a computed dynamic import", "const name = './x'; export const load = () => import(name);", /dynamic import\(\)/],
    ["an interpolated template import", "const n = 'x'; export const load = () => import(`./${n}`);", /dynamic import\(\)/],
    ["a computed new URL", "const n = './x'; export const url = new URL(n, import.meta.url);", /new URL/],
    ["import.meta.glob", "export const modules = import.meta.glob('./*.ts');", /import\.meta\.glob/],
    ["a computed require", "declare const require: (id: string) => unknown; const n = './x'; export const x = require(n);", /require\(\)/],
    ["an unsupported query", "import worker from './pack.ts?worker'; export { worker };", /unsupported import query/],
    ["an unresolvable import", "import './missing';", /does not resolve/],
    ["a relative escape", "import '../outside';", /outside the host root/],
    ["an asset URL escape", "export const url = new URL('../outside.ts', import.meta.url);", /outside the host root/],
  ])("fails closed on %s", async (_label, source, message) => {
    const root = await host({ "pack.ts": source });
    await writeFile(join(root, "..", "outside.ts"), "export {};\n");
    await expect(collect(root)).rejects.toThrow(message);
  });

  it("attests a whole installed package whose loads cannot be proven, for editing", async () => {
    const root = await host({
      "node_modules/@scope/wasm/package.json": JSON.stringify({ name: "@scope/wasm", version: "5.1.5", exports: "./index.js" }),
      "node_modules/@scope/wasm/index.js": 'export const load = (specifier) => import(specifier);\nexport const glue = new URL("./glue.mjs", import.meta.url);\n',
      "node_modules/@scope/wasm/glue.mjs": "export {};\n",
      "node_modules/@scope/wasm/wasm/unreached.wasm": "bytes",
      "node_modules/@scope/wasm/node_modules/nested/index.js": "export {};\n",
      "pack.ts": 'import { load } from "@scope/wasm";\nexport { load };\n',
    });
    const graph = await collectPackSourceGraph({ hostRoot: root, entryPath: join(root, "pack.ts"), sourceModules: [], attestExternalFiles: true });
    const installed = (graph.attestedFiles ?? []).map(path => path.split(sep).join("/")).filter(path => path.includes("/@scope/wasm/")).map(path => path.split("/@scope/wasm/")[1]);
    expect(installed.sort()).toEqual(["glue.mjs", "index.js", "package.json", "wasm/unreached.wasm"]);
    expect(graph.dependencies).toContainEqual({ name: "@scope/wasm", version: "5.1.5" });
  });

  const installedUnder = (graph: { attestedFiles?: readonly string[] }, marker: string) =>
    (graph.attestedFiles ?? []).map(path => path.split(sep).join("/")).filter(path => path.includes(marker)).map(path => path.slice(path.lastIndexOf(marker) + marker.length)).sort();
  const computedLoader = {
    "node_modules/@scope/wasm/package.json": JSON.stringify({ name: "@scope/wasm", version: "5.1.5", exports: "./index.js", dependencies: { nested: "1.0.0", sibling: "2.0.0" }, optionalDependencies: { absent: "1.0.0" } }),
    "node_modules/@scope/wasm/index.js": "export const load = (specifier) => import(specifier);\n",
    "node_modules/@scope/wasm/internal/lazy.js": 'import { phantom } from "phantom";\nexport { phantom };\n',
    "node_modules/@scope/wasm/node_modules/nested/package.json": JSON.stringify({ name: "nested", version: "1.0.0", exports: "./index.js", dependencies: { deep: "3.0.0" } }),
    "node_modules/@scope/wasm/node_modules/nested/index.js": 'export * from "./more.js";\n',
    "node_modules/@scope/wasm/node_modules/nested/more.js": "export const more = 1;\n",
    "node_modules/@scope/wasm/node_modules/nested/node_modules/deep/package.json": JSON.stringify({ name: "deep", version: "3.0.0", exports: "./index.js" }),
    "node_modules/@scope/wasm/node_modules/nested/node_modules/deep/index.js": "export const deep = 1;\n",
    "node_modules/sibling/package.json": JSON.stringify({ name: "sibling", version: "2.0.0", exports: "./index.js" }),
    "node_modules/sibling/index.js": "export const sibling = 1;\n",
    "node_modules/phantom/package.json": JSON.stringify({ name: "phantom", version: "9.0.0", exports: "./index.js" }),
    "node_modules/phantom/index.js": "export const phantom = 1;\n",
    "pack.ts": 'import { load } from "@scope/wasm";\nexport { load };\n',
  };

  it("attests a computed load's nested and sibling declared dependencies, transitively", async () => {
    const root = await host(computedLoader);
    const graph = await collectPackSourceGraph({ hostRoot: root, entryPath: join(root, "pack.ts"), sourceModules: [], attestExternalFiles: true });
    expect(installedUnder(graph, "/@scope/wasm/node_modules/nested/").filter(path => !path.startsWith("node_modules/"))).toEqual(["index.js", "more.js", "package.json"]);
    expect(installedUnder(graph, "/nested/node_modules/deep/")).toEqual(["index.js", "package.json"]);
    expect(installedUnder(graph, "/node_modules/sibling/")).toEqual(["index.js", "package.json"]);
    expect(graph.dependencies.map(({ name }) => name)).toEqual(expect.arrayContaining(["@scope/wasm", "nested", "deep", "sibling"]));
  });

  it("confines an installed computed loader to attested files when it loads an undeclared nested or sibling target", async () => {
    const root = await host({
      ...computedLoader,
      "node_modules/@scope/wasm/glue.mjs": "export const glue = \"own\";\n",
      "node_modules/@scope/wasm/node_modules/undeclared/package.json": JSON.stringify({ name: "undeclared", version: "1.0.0", exports: "./index.js" }),
      "node_modules/@scope/wasm/node_modules/undeclared/index.js": "export const undeclared = 1;\n",
      "node_modules/stray/package.json": JSON.stringify({ name: "stray", version: "1.0.0", exports: "./index.js" }),
      "node_modules/stray/index.js": "export const stray = 1;\n",
      "loose.js": "export const loose = 1;\n",
    });
    const graph = await collectPackSourceGraph({ hostRoot: root, entryPath: join(root, "pack.ts"), sourceModules: [], attestExternalFiles: true });
    expect(graph.confinedPackages).toEqual([await realpath(join(root, "node_modules/@scope/wasm"))]);
    // The attestation itself never lists the undeclared targets, so only load-time confinement can cover them.
    expect(installedUnder(graph, "/wasm/node_modules/undeclared/")).toEqual([]);
    expect(installedUnder(graph, "/node_modules/stray/")).toEqual([]);
    enforceComputedLoadBoundary(graph);
    const file = (path: string) => pathToFileURL(join(root, path)).href;
    // Evaluate the pack exactly as editing does: the installed loader is externalized to native Node loading.
    const { load } = await createModuleEvaluator(root)(join(root, "pack.ts")) as { load: (specifier: string) => Promise<Record<string, unknown>> };
    await expect(load(file("node_modules/@scope/wasm/glue.mjs"))).resolves.toMatchObject({ glue: "own" });
    await expect(load(file("node_modules/@scope/wasm/node_modules/nested/more.js"))).resolves.toMatchObject({ more: 1 });
    await expect(load("sibling")).resolves.toMatchObject({ sibling: 1 });
    await expect(load(file("node_modules/@scope/wasm/node_modules/undeclared/index.js"))).rejects.toThrow(/did not attest/);
    await expect(load("undeclared")).rejects.toThrow(/did not attest/);
    await expect(load("stray")).rejects.toThrow(/did not attest/);
    await expect(load(file("loose.js"))).rejects.toThrow(/did not attest/);
    await expect(load("data:text/javascript,export default 1")).rejects.toThrow(/did not attest/);
    await expect(load("node:path")).resolves.toHaveProperty("join");
  });

  it("follows a dynamically reachable internal module into the dependency it imports", async () => {
    const root = await host(computedLoader);
    const graph = await collectPackSourceGraph({ hostRoot: root, entryPath: join(root, "pack.ts"), sourceModules: [], attestExternalFiles: true });
    expect(installedUnder(graph, "/@scope/wasm/")).toContain("internal/lazy.js");
    expect(installedUnder(graph, "/node_modules/phantom/")).toEqual(["index.js"]);
    expect(graph.dependencies).toContainEqual({ name: "phantom", version: "9.0.0" });
  });

  it("refuses a computed load whose declared dependency is not installed, or whose reachable module does not resolve", async () => {
    const missing = await host(computedLoader);
    await rm(join(missing, "node_modules/sibling"), { recursive: true, force: true });
    await expect(collectPackSourceGraph({ hostRoot: missing, entryPath: join(missing, "pack.ts"), sourceModules: [], attestExternalFiles: true })).rejects.toThrow(/declares "sibling", which is not installed/);
    const unresolved = await host({ ...computedLoader, "node_modules/@scope/wasm/internal/lazy.js": 'import "not-installed";\n' });
    await expect(collectPackSourceGraph({ hostRoot: unresolved, entryPath: join(unresolved, "pack.ts"), sourceModules: [], attestExternalFiles: true })).rejects.toThrow(/"not-installed" in ".*internal\/lazy\.js" does not resolve/);
  });

  it("still fails closed on an unprovable load in host-owned source while attesting installed files", async () => {
    const root = await host({ "pack.ts": "const name = './x'; export const load = () => import(name);" });
    await expect(collectPackSourceGraph({ hostRoot: root, entryPath: join(root, "pack.ts"), sourceModules: [], attestExternalFiles: true })).rejects.toThrow(/dynamic import\(\)/);
  });

  it("fails closed on a CSS escape and on a symlink leaving the host", async () => {
    const cssRoot = await host({ "pack.ts": 'import "./a.css";', "a.css": '@import "../outside.css";' });
    await writeFile(join(cssRoot, "..", "outside.css"), "");
    await expect(collect(cssRoot)).rejects.toThrow(/outside the host root/);

    const linkRoot = await host({ "pack.ts": 'import "./linked";' });
    await writeFile(join(linkRoot, "..", "target.ts"), "export {};\n");
    await symlink(join(linkRoot, "..", "target.ts"), join(linkRoot, "linked.ts"));
    await expect(collect(linkRoot)).rejects.toThrow(/outside the host root/);
  });

  it("lists the self-host fixture's components and imported CSS", async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/self-host");
    const graph = await collectPackSourceGraph({
      hostRoot: root,
      entryPath: join(root, "components/pack.ts"),
      sourceModules: ["self-host/components"],
      extraRoots: [join(root, "styles/base.css")],
    });
    expect(graph.files).toEqual(["components/components.tsx", "components/pack.ts", "styles/base.css"]);
    expect(graph.dependencies.map((entry) => entry.name)).toEqual(["@zudo-composer/component-contract", "preact", "tailwindcss"]);
  });
});
