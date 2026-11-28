// @ts-check

import ts from "typescript";
// The zudo-react runtime ships inside the `@takazudo/zfb` package. Tool source
// may import only these runtime entry points; the bare package entry is the
// zfb application API and `/zudo-react/testing` is test-only.

export const ZUDO_REACT_PACKAGE_NAME = "@takazudo/zfb";

export const ZUDO_REACT_IMPORT_SPECIFIERS = Object.freeze([
  "@takazudo/zfb/zudo-react",
  "@takazudo/zfb/zudo-react/jsx-runtime",
  "@takazudo/zfb/zudo-react/jsx-dev-runtime",
  "@takazudo/zfb/zudo-react/client",
  "@takazudo/zfb/zudo-react/server",
]);

/** A manifest `dependencies`/`peerDependencies` key naming the runtime's package. */
export function isZudoReactPackageName(/** @type {string} */ name) {
  return name === ZUDO_REACT_PACKAGE_NAME;
}

/** An import specifier naming exactly one allowed runtime entry point. */
export function isZudoReactImportSpecifier(/** @type {string} */ specifier) {
  return ZUDO_REACT_IMPORT_SPECIFIERS.includes(specifier);
}

const runtimeSubpath = "\\/zudo-react(?:\\/(?:jsx-runtime|jsx-dev-runtime|client|server))?";

/**
 * Text that names zfb other than an allowed runtime entry point or the quoted
 * bare package name (a manifest key or a `resolve.dedupe` value).
 */
export const ZFB_APPLICATION_REFERENCE = new RegExp(`@takazudo\\/zfb(?!(?:${runtimeSubpath})?["'\`])`, "i");

/** zfb application, zudo-doc, virtual-zfb and styleguide-registry names removed from the standalone tool. */
const REMOVED_HOST_MODULE = /zudo-doc|(?:^|[/@-])zfb(?:[/@-]|$)|virtual-zfb|styleguide.*registry/i;

/** A direct dependency key the standalone tool must not declare (check-standalone-handoff). */
export function isRemovedHostDependency(/** @type {string} */ name) {
  return REMOVED_HOST_MODULE.test(name) && !isZudoReactPackageName(name);
}

/** An import specifier tool production source must not use (check-standalone-handoff). */
export function isRemovedHostImport(/** @type {string} */ specifier) {
  return REMOVED_HOST_MODULE.test(specifier) && !isZudoReactImportSpecifier(specifier);
}

/** The headless scan's text rule for production-domain source (check-headless-boundary). */
export const HEADLESS_PROVIDER_COUPLING = new RegExp(`@zudo-composer\\/ui|zudo-doc|${ZFB_APPLICATION_REFERENCE.source}|(?<!@takazudo\\/)\\bzfb\\b`, "i");

/** The same rule for the root manifest and Vite config, which also install the md-wasm pack dependency. */
export const ROOT_CONFIG_PROVIDER_COUPLING = new RegExp(`zudo-doc|${ZFB_APPLICATION_REFERENCE.source.replace("(?!", "(?!-md-wasm|")}|(?<!@takazudo\\/)\\bzfb\\b(?!-md-wasm)`, "i");

/**
 * Every module specifier a TypeScript/JavaScript source names: static and
 * type-only imports, re-exports, `import()` calls and `import("…")` types.
 * Text inside other strings (such as generated source) is not a specifier.
 * @param {string} source
 * @param {string} [fileName]
 * @returns {string[]}
 */
export function moduleSpecifiers(source, fileName = "source.tsx") {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  /** @type {string[]} */
  const found = [];
  /** @param {import("typescript").Node} node */
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) found.push(node.arguments[0].text);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) found.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

/** A UI runtime a headless production domain must never import. */
export function isUiRuntimeSpecifier(/** @type {string} */ specifier) {
  return /^(?:preact|@takazudo\/zfb)(?:\/|$)/.test(specifier);
}
