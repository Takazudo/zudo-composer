// @vitest-environment node
// Under zudo-react a `<Field>` has no context to hand its id to a control: the
// control is labelled only when the Field's function child passes the wiring
// on. This audits every production `<Field>` so a plain control child, which
// renders a `<label for>` pointing at nothing, cannot come back.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "../../../..");
const LABELABLE = new Set(["Input", "Select", "Textarea", "Switch", "Checkbox", "input", "select", "textarea"]);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(path);
    return entry.name.endsWith(".tsx") && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}

function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
}

function hasLabelableControl(node: ts.Node): boolean {
  if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && LABELABLE.has(tagName(node))) return true;
  return ts.forEachChild(node, hasLabelableControl) ?? false;
}

function references(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node) && node.text === name && !(ts.isParameter(node.parent) && node.parent.name === node)) return true;
  return ts.forEachChild(node, (child) => references(child, name)) ?? false;
}

interface Finding { at: string; problem: string }

function audit(path: string): { count: number; findings: Finding[] } {
  const tree = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imported = tree.statements.some((statement) => ts.isImportDeclaration(statement)
    && /components\/ui(?:\/field)?["']$|^["']\.\/field["']$|^["']\.\.?\/ui["']$/.test(statement.moduleSpecifier.getText())
    && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some((element) => element.name.text === "Field"));
  const findings: Finding[] = [];
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (imported && ts.isJsxElement(node) && tagName(node) === "Field") {
      count += 1;
      const at = `${relative(repository, path)}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      const children = node.children.filter((child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces));
      const only = children.length === 1 && ts.isJsxExpression(children[0]!) ? children[0].expression : undefined;
      if (only && (ts.isArrowFunction(only) || ts.isFunctionExpression(only))) {
        const parameter = only.parameters[0];
        if (!parameter || !ts.isIdentifier(parameter.name)) findings.push({ at, problem: "function child ignores the Field wiring" });
        else if (!references(only.body, parameter.name.text)) findings.push({ at, problem: `function child never passes \`${parameter.name.text}\` on` });
      } else if (children.some(hasLabelableControl)) {
        findings.push({ at, problem: "plain control child is not wired to the Field label" });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { count, findings };
}

describe("Field usages", () => {
  it("wire every wrapped form control to the Field label", () => {
    const results = sources(join(repository, "src")).map(audit);
    expect(results.reduce((total, result) => total + result.count, 0)).toBeGreaterThan(40);
    expect(results.flatMap((result) => result.findings)).toEqual([]);
  });
});
