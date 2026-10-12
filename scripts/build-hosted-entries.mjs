// @ts-check
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { build } from "vite";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const temporary = await mkdtemp(join(tmpdir(), "composer-hosted-build-"));
const output = join(temporary, "output");
const declarations = join(temporary, "types");
const entries = { index: "src/hosted-content/index.ts", editor: "src/hosted-content/browser.ts", preview: "src/hosted-content/preview-browser.ts", testing: "src/hosted-content/testing.ts" };
const allowed = new Set(["zod", "@lezer/markdown", "preact", "preact/hooks", "preact/jsx-runtime", "@zudo-composer/component-contract"]);
const packageData = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
for (const name of Object.keys(packageData.dependencies)) if (name.startsWith("@codemirror/") || name === "@lezer/highlight") allowed.add(name);

/** @param {string} directory @returns {Promise<string[]>} */
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result.sort();
}

try {
  await build({
    configFile: false, root, logLevel: "error", oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    build: { target: "es2022", minify: false, outDir: output, emptyOutDir: true, copyPublicDir: false,
      lib: { entry: Object.fromEntries(Object.entries(entries).map(([name, path]) => [name, resolve(root, path)])), formats: ["es"], fileName: (_format, name) => `${name}.mjs` },
      rolldownOptions: {
        external(id) {
          if (id.startsWith(".") || isAbsolute(id)) return false;
          assert.ok(allowed.has(id), `Forbidden dependency in hosted graph: ${id}`);
          return true;
        },
        output: { entryFileNames: "[name].mjs", chunkFileNames: "chunks/[name]-[hash].mjs" },
      },
    },
  });
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "preact", strict: true, skipLibCheck: true,
    declaration: true, emitDeclarationOnly: true, rootDir: root, outDir: declarations,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], types: [], newLine: ts.NewLineKind.LineFeed };
  const program = ts.createProgram(Object.values(entries).map((path) => join(root, path)), options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (path) => path, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  assert.ok(!program.emit().emitSkipped, "Hosted declaration emission failed");
  // TypeScript does not copy hand-written declarations of JavaScript modules; the bundler resolves them.
  for (const path of await files(join(root, "src"))) if (path.endsWith(".d.mts")) {
    const target = join(declarations, relative(root, path)); await mkdir(dirname(target), { recursive: true }); await writeFile(target, await readFile(path));
  }
  for (const [name, source] of Object.entries(entries)) {
    const bundle = await rollup({ input: join(declarations, source.replace(/\.tsx?$/, ".d.ts")),
      external: (id) => !id.startsWith(".") && !isAbsolute(id), plugins: [dts()], onwarn(warning) { throw new Error(warning.message); } });
    try { await bundle.write({ file: join(output, `${name}.d.mts`), format: "es" }); } finally { await bundle.close(); }
  }
  await writeFile(join(output, "editor.css"), await readFile(join(root, "src/hosted-content/editor.css")));
  const outputs = await files(output);
  const destination = join(root, "server/hosted-content");
  if (check) {
    assert.deepEqual((await files(destination)).map((path) => relative(destination, path)), outputs.map((path) => relative(output, path)), "Hosted output inventory drift");
    for (const path of outputs) assert.equal(await readFile(join(destination, relative(output, path)), "utf8"), await readFile(path, "utf8"), `Stale hosted output ${relative(output, path)}`);
  } else {
    await rm(destination, { recursive: true, force: true });
    for (const path of outputs) { const target = join(destination, relative(output, path)); await mkdir(dirname(target), { recursive: true }); await writeFile(target, await readFile(path)); }
  }
  console.log(`Hosted entries ${check ? "are current" : "built"}: ${outputs.length} files.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
