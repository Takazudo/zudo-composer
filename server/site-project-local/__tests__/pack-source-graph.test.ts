import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
