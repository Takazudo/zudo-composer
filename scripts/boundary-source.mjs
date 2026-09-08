// @ts-check

import ts from 'typescript';

/** @param {string} text @returns {string} */
const blank = (text) => text.replace(/[^\r\n]/g, ' ');

/**
 * Keep source positions and newlines intact while removing prose from boundary
 * scans. Dependency rules keep strings; symbol rules opt out of prose strings.
 * Property lookups, type discriminants, and comparisons retain their literal
 * values because they can encode the behavior a boundary forbids. Parsing
 * tokens avoids treating comment-like text in URLs, regexes, or templates as
 * comments, and preserves executable expressions inside template literals.
 * @param {string} source
 * @param {{fileName?: string, strings?: boolean}} [options]
 */
export function boundarySource(source, { fileName = 'source.tsx', strings = true } = {}) {
  if (fileName.endsWith('.css')) {
    return source.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?(?:\*\/|$)/g,
      (token) => token.startsWith('/*') || !strings ? blank(token) : token);
  }

  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  /** @type {string[]} */
  const pieces = [];
  let offset = 0;
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (ts.isJSDoc(node)) return;
    const children = node.getChildren(tree);
    if (children.length) {
      children.forEach(visit);
      return;
    }
    const start = node.getStart(tree);
    const end = node.end;
    if (end <= start) return;
    pieces.push(blank(source.slice(offset, start)));
    const semanticLiteral = node.parent && (ts.isElementAccessExpression(node.parent)
      || ts.isLiteralTypeNode(node.parent)
      || ts.isCaseClause(node.parent)
      || ts.isBinaryExpression(node.parent));
    const prose = (ts.isStringLiteralLike(node) && !semanticLiteral)
      || node.kind === ts.SyntaxKind.TemplateHead
      || node.kind === ts.SyntaxKind.TemplateMiddle
      || node.kind === ts.SyntaxKind.TemplateTail
      || node.kind === ts.SyntaxKind.JsxText;
    pieces.push(!strings && prose ? blank(source.slice(start, end)) : source.slice(start, end));
    offset = end;
  }
  visit(tree);
  pieces.push(blank(source.slice(offset)));
  return pieces.join('');
}
