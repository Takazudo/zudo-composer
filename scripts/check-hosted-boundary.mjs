// @ts-check
import assert from "node:assert/strict";
import { dirname, isAbsolute, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const allowed = new Set(["zod", "@lezer/markdown", "@zudo-composer/component-contract"]);
/** @param {string} path @param {boolean} browser @param {Set<string>} seen */
async function visit(path, browser, seen, editor = browser) {
  if (seen.has(path)) return;
  seen.add(path);
  const program = ts.createProgram([path], { allowJs: true, noLib: true, noResolve: true, types: [] });
  const tree = program.getSourceFile(path);
  assert.ok(tree, `Missing emitted source ${path}`);
  const checker = program.getTypeChecker();
  /** @type {string[]} */
  const imports = [];
  /** @param {import('typescript').Node} node */
  const inspect = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), `${path}: dynamic import cannot be audited`);
      imports.push(node.arguments[0].text);
    }
    const propertyName = node.parent && (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      || (ts.isPropertyAssignment(node.parent) || ts.isMethodDeclaration(node.parent)) && node.parent.name === node);
    if (ts.isIdentifier(node) && !propertyName) {
      const locallyDeclared = checker.getSymbolAtLocation(node)?.declarations?.some(declaration => declaration.getSourceFile().fileName === path);
      if (!locallyDeclared) {
        assert.ok(!["process", "Buffer", "require"].includes(node.text), `${path}: Node global ${node.text}`);
        if (!browser) assert.ok(!["window", "document", "HTMLElement", "MutationObserver"].includes(node.text), `${path}: DOM global ${node.text}`);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(tree);
  for (const id of imports) {
    if (id.startsWith(".")) await visit(resolve(dirname(path), id), browser, seen, editor);
    else {
      assert.ok(!isAbsolute(id) && !id.startsWith("node:") && !id.startsWith("virtual:"), `${path}: forbidden import ${id}`);
      assert.ok(allowed.has(id) || editor && (id === "preact" || id.startsWith("preact/") || id.startsWith("@codemirror/") || id === "@lezer/highlight"), `${path}: unexpected dependency ${id}`);
    }
  }
}
const portable = new Set();
await visit(resolve(root, "server/hosted-content/index.mjs"), false, portable);
await visit(resolve(root, "server/hosted-content/testing.mjs"), false, portable);
const browser = new Set();
await visit(resolve(root, "server/hosted-content/editor.mjs"), true, browser);
const preview = new Set();
await visit(resolve(root, "server/hosted-content/preview.mjs"), true, preview, false);
console.log(`Hosted emitted boundaries verified: ${portable.size} portable modules; ${browser.size} browser modules.`);
