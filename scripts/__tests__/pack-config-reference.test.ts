// @vitest-environment node

// `src/features/composer/pack-config.d.ts` is the only declaration of the
// `virtual:zudo-composer-pack` and `virtual:zudo-composer-host-styles`
// modules. Any `src/**` file that imports one of them must carry an explicit
// triple-slash reference to it, or a `tsc -b` program that reaches the file
// without also including the declaration reports TS2307 (issue #667/#668).
// AST-based detection (rather than plain text search) avoids false positives
// from files that merely mention the specifier in a string or comment, such
// as `src/app/__tests__/provider-css.test.ts` asserting generated output.

import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const srcRoot = join(repositoryRoot, "src");
const packConfigFile = resolve(repositoryRoot, "src/features/composer/pack-config.d.ts");
const virtualSpecifiers = new Set(["virtual:zudo-composer-pack", "virtual:zudo-composer-host-styles"]);
const sourceExtensions = new Set([".ts", ".tsx"]);

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (sourceExtensions.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
}

/** True for a real static/dynamic import or re-export of one of the virtual modules — never a string literal used only for an assertion. */
function importsVirtualPack(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const isTargetSpecifier = (node: ts.Node): boolean => ts.isStringLiteral(node) && virtualSpecifiers.has(node.text);
  const visit = (node: ts.Node) => {
    if (found) return;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && isTargetSpecifier(node.moduleSpecifier)) {
      found = true;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && isTargetSpecifier(node.arguments[0])) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function referencesPackConfig(sourceFile: ts.SourceFile, file: string): boolean {
  return sourceFile.referencedFiles.some((reference) => resolve(join(file, ".."), reference.fileName) === packConfigFile);
}

describe("ambient virtual-pack reference guard", () => {
  it("requires every src file that imports the virtual pack modules to reference pack-config.d.ts", () => {
    const offenders = listSourceFiles(srcRoot)
      .filter((file) => file !== packConfigFile)
      .map((file) => ({ file, text: readFileSync(file, "utf8") }))
      .map(({ file, text }) => ({ file, sourceFile: parse(file, text) }))
      .filter(({ sourceFile }) => importsVirtualPack(sourceFile))
      .filter(({ sourceFile, file }) => !referencesPackConfig(sourceFile, file));
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it("is not vacuous: it fails when a file's reference line is removed", () => {
    const file = join(srcRoot, "features/composer/active-pack.ts");
    const withReference = readFileSync(file, "utf8");
    expect(withReference).toMatch(/^\/\/\/ <reference path="\.\/pack-config\.d\.ts" \/>/);
    const withoutReference = withReference.replace(/^\/\/\/[^\n]*\n/, "");

    const original = parse(file, withReference);
    expect(importsVirtualPack(original)).toBe(true);
    expect(referencesPackConfig(original, file)).toBe(true);

    const stripped = parse(file, withoutReference);
    expect(importsVirtualPack(stripped)).toBe(true);
    expect(referencesPackConfig(stripped, file)).toBe(false);
  });
});
