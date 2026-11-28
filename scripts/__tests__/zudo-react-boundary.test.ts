// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { build, type Rolldown } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { zudoReactOxc } from "../../plugins/module-resolution.mjs";
import { INLINED_RUNTIME_MARKER, ZUDO_REACT_EXTERNAL_ENTRIES, assertNoInlinedRuntime, isZudoReactExternal } from "../zudo-react-boundary.mjs";

const repo = resolve(import.meta.dirname, "../..");
const runtimeDir = dirname(createRequire(join(repo, "package.json")).resolve("@takazudo/zfb/zudo-react"));
const cache = join(repo, "node_modules/.cache");
mkdirSync(cache, { recursive: true });
const root = mkdtempSync(join(cache, "zr-boundary-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function bundle(external: boolean): Promise<string> {
  const entry = join(root, `entry-${external}.tsx`);
  writeFileSync(entry, 'import { signal } from "@takazudo/zfb/zudo-react";\nimport { mount } from "@takazudo/zfb/zudo-react/client";\nexport const count = signal(0);\nexport { mount };\nexport const view = <p>{count}</p>;\n');
  const output = await build({
    configFile: false, root: repo, logLevel: "silent",
    // A production graph: the dev runtime is never an allowed external.
    oxc: { jsx: { ...zudoReactOxc().jsx, development: false } },
    build: { write: false, minify: true, lib: { entry, formats: ["es"], fileName: "entry" },
      rolldownOptions: { external: external ? (id) => isZudoReactExternal(id) : [] } },
  });
  const results = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[];
  return results.flatMap((result) => result.output).filter((chunk) => chunk.type === "chunk").map((chunk) => chunk.code).join("\n");
}

describe("zudo-react emitted-chunk boundary", () => {
  it("recognises the runtime's own scheduler, reactive core and scope", () => {
    for (const file of ["scheduler.js", "reactive.js", "scope.js"]) expect(readFileSync(join(runtimeDir, file), "utf8"), file).toMatch(INLINED_RUNTIME_MARKER);
  });

  it("allows only the production subpaths a browser graph may import", () => {
    expect(ZUDO_REACT_EXTERNAL_ENTRIES).toEqual(["@takazudo/zfb/zudo-react", "@takazudo/zfb/zudo-react/jsx-runtime", "@takazudo/zfb/zudo-react/client"]);
    expect(isZudoReactExternal("@takazudo/zfb/zudo-react/jsx-dev-runtime")).toBe(false);
    expect(isZudoReactExternal("preact")).toBe(false);
  });

  it("passes a minified chunk that keeps the runtime external", async () => {
    const code = await bundle(true);
    expect(code).toMatch(/from\s*"@takazudo\/zfb\/zudo-react\/client"/);
    expect(code).toMatch(/from\s*"@takazudo\/zfb\/zudo-react\/jsx-runtime"/);
    expect(() => assertNoInlinedRuntime("entry.js", code)).not.toThrow();
  }, 60_000);

  it("rejects a minified chunk that inlined a runtime copy", async () => {
    const code = await bundle(false);
    expect(code).not.toMatch(/from\s*"@takazudo\//);
    expect(() => assertNoInlinedRuntime("entry.js", code)).toThrow(/inlines a zudo-react runtime copy/);
  }, 60_000);
});
