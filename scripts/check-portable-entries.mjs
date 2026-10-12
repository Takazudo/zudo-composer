// @ts-check
// Prove the EMITTED portable graph is browser/Worker-safe. Source-level scans
// cannot see what bundling pulls in, so this reads the committed `server/*.mjs`
// output that ships and proves two things about it:
//
//   1. Every module specifier it reaches is relative, or one of the
//      allowlisted portable packages. No Node builtin, Vite, Preact or
//      application tree.
//   2. The whole graph type-checks against the ES2023 + WebWorker libraries
//      and nothing else: a free reference to `window`, `document`,
//      `localStorage`, `process`, `require`, `Buffer` or any other
//      non-Worker global is an unresolved name, however it is spelled.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { PUBLIC_ENTRIES } from "./public-entries.mjs";

const root = resolve(import.meta.dirname, "..");
const { portableEntries } = PUBLIC_ENTRIES;
const allowedPackages = new Set(["@zudo-composer/component-contract", "zod", "@lezer/markdown"]);
const NODE_BUILTIN = /^node:|^(?:assert|buffer|child_process|crypto|events|fs|module|os|path|process|stream|url|util|worker_threads)(?:\/|$)/;
const UNRESOLVED_NAME_CODES = new Set([2304, 2552, 2583, 2584, 2591, 2593]);

/** @param {string} source @param {string} fileName @returns {string[]} */
function moduleSpecifiers(source, fileName) {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  /** @type {string[]} */
  const specifiers = [];
  /** @param {ts.Node} node */
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      specifiers.push(argument && ts.isStringLiteralLike(argument) ? argument.text : "<dynamic import()>");
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return specifiers;
}

/** @type {Map<string, string[]>} path -> imports */
const graph = new Map();
/** @type {string[]} */
const violations = [];

/** @param {string} file */
async function scan(file) {
  if (graph.has(file)) return;
  const source = await readFile(file, "utf8");
  const label = relative(root, file).replaceAll("\\", "/");
  const imports = moduleSpecifiers(source, file);
  for (const specifier of imports) {
    if (specifier.startsWith(".")) continue;
    if (specifier.startsWith("<")) violations.push(`${label}: dynamic import with a non-literal specifier`);
    else if (NODE_BUILTIN.test(specifier)) violations.push(`${label}: imports Node builtin ${specifier}`);
    else if (!allowedPackages.has(specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/"))) violations.push(`${label}: imports non-portable package ${specifier}`);
  }
  // A portable chunk must not be a Node chunk in disguise: the Node bundles
  // live beside these and share nothing.
  if (!/^server\/(?:content|host-storage|preview-protocol|export)\.mjs$|^server\/generated\/portable-/.test(label)) violations.push(`${label}: reached from the portable graph but not a portable output`);
  graph.set(file, imports);
  for (const specifier of imports) if (specifier.startsWith(".")) await scan(resolve(dirname(file), specifier));
}

for (const name of Object.keys(portableEntries)) await scan(join(root, "server", `${name}.mjs`));
assert.ok(graph.size >= Object.keys(portableEntries).length, "Portable entries were not found; run pnpm build:public");

// Free global references: compile the emitted JavaScript with only the
// Worker-compatible libraries and read the unresolved-name diagnostics.
const program = ts.createProgram([...graph.keys()], {
  allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2023.d.ts", "lib.webworker.d.ts"], types: [],
});
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
  if (!UNRESOLVED_NAME_CODES.has(diagnostic.code) || !diagnostic.file || !graph.has(resolve(diagnostic.file.fileName))) continue;
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
  violations.push(`${relative(root, diagnostic.file.fileName)}:${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
}

if (violations.length) {
  console.error("Portable entry scan failed:");
  for (const violation of [...new Set(violations)]) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Portable entry scan passed: ${graph.size} emitted modules resolve against ES2023 + WebWorker only; external imports limited to ${[...allowedPackages].join(", ")}.`);
}
