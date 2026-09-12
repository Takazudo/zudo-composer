// @ts-check

// Consumers must be usable without the repository around them. The temporary
// ledger names exact violations (including their occurrence counts), not file
// exemptions or patterns. Remove entries as their owning issues fix them; do
// not regenerate the ledger to accept new coupling. Line numbers deliberately
// are not identities, so unrelated edits do not churn the ledger.
//
// With no arguments, discover demo-* and any package under packages/ or
// fixtures/ with a host config or a direct
// tool dependency. This includes fixtures/self-host outside pnpm's workspace.
// --root <repository> --host <directory> (repeatable) --ledger <json> also let
// the installed/generated-host gates scan isolated consumer trees. Only these
// trees are scanned; a packed lane's temporary dependency rewrite is not part
// of the default repository scan. The contract-only scan stays independent.

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { boundarySource } from './boundary-source.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultLedger = fileURLToPath(new URL('./consumer-boundary-ledger.json', import.meta.url));
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const textExtensions = new Set(['.md', '.mdx', '.yaml', '.yml', '.sh', '.bash', '.zsh', '.npmrc']);
const ignoredDirectories = new Set([
  'node_modules', '.git', 'dist', 'dist-site', 'dist-hosted-demo', '.zudo-site-project',
  '.vite', '.artifacts', 'coverage', 'test-results', 'playwright-report',
]);
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
// In-repository authoring uses these package workspaces. Packed-host lanes
// replace them with tarballs; this allowance never applies to host source,
// overrides, external hosts, arbitrary workspaces or file/link dependencies.
const authoringPackages = new Map([
  ['zudo-composer', 'package.json'],
  ['@zudo-composer/component-contract', 'packages/component-contract/package.json'],
  ['@zudo-composer/fixture-themeset', 'packages/fixture-themeset/package.json'],
]);
const rules = new Set([
  'outside-host-path', 'outside-host-import', 'dependency-protocol', 'workspace-command',
  'repository-import', 'undeclared-package', 'computed-import', 'outside-host-symlink',
]);

/** @typedef {{host: string, file: string, rule: string, detail: string, count: number}} Violation */
/** @typedef {Violation & {issue: number}} LedgerEntry */
/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {string} value */
const slash = (value) => value.replaceAll('\\', '/');
/** @param {string} root @param {string} candidate */
function outside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}
/** @param {Pick<Violation, 'host' | 'file' | 'rule' | 'detail'>} entry */
const identity = ({ host, file, rule, detail }) => JSON.stringify([host, file, rule, detail]);
/** @param {string} specifier */
const packageName = (specifier) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

/** @param {string} root @returns {string[]} */
export function discoverConsumerHosts(root) {
  /** @type {string[]} */
  const hosts = [];
  for (const directory of ['packages', 'fixtures']) {
    const parent = path.join(root, directory);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const candidate = path.join(parent, entry.name);
      const manifestFile = path.join(candidate, 'package.json');
      const hasConfig = ['ts', 'mts', 'js', 'mjs', 'cts', 'cjs'].some((ext) => existsSync(path.join(candidate, `zudo-composer.config.${ext}`)));
      // A missing manifest must not make an existing demo/configured host
      // disappear from coverage: scanConsumerHost will report the read error.
      const manifest = existsSync(manifestFile) ? object(JSON.parse(readFileSync(manifestFile, 'utf8'))) : {};
      if (entry.name.startsWith('demo-') || hasConfig || dependencySections.some((section) => Object.hasOwn(object(manifest[section]), 'zudo-composer'))) {
        hosts.push(candidate);
      }
    }
  }
  return hosts.sort();
}

/**
 * @param {{root: string, hostRoot: string}} options
 * @returns {Violation[]}
 */
export function scanConsumerHost({ root, hostRoot }) {
  root = path.resolve(root);
  hostRoot = path.resolve(root, hostRoot);
  const host = slash(path.relative(root, hostRoot)) || '.';
  const manifest = object(JSON.parse(readFileSync(path.join(hostRoot, 'package.json'), 'utf8')));
  const dependencies = new Set(dependencySections.flatMap((section) => Object.keys(object(manifest[section]))));
  if (typeof manifest.name === 'string') dependencies.add(manifest.name);
  const authoringHost = /^packages\/demo-[^/]+$/.test(host) || ['fixtures/host', 'fixtures/themeset-host'].includes(host);
  const authoringDependencies = new Set();
  if (authoringHost && !outside(realpathSync(root), realpathSync(hostRoot)) && existsSync(path.join(root, 'package.json'))
    && object(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))).name === 'zudo-composer') {
    for (const [name, relativeManifest] of authoringPackages) {
      const target = path.join(root, relativeManifest);
      if (existsSync(target) && !outside(realpathSync(root), realpathSync(target))
        && object(JSON.parse(readFileSync(target, 'utf8'))).name === name) authoringDependencies.add(name);
    }
  }
  /** @type {Map<string, Violation>} */
  const violations = new Map();
  /** @param {string} file @param {string} rule @param {string} detail */
  function record(file, rule, detail) {
    const entry = { host, file: slash(path.relative(hostRoot, file)), rule, detail, count: 1 };
    const previous = violations.get(identity(entry));
    if (previous) previous.count++;
    else violations.set(identity(entry), entry);
  }

  /** @param {string} specifier */
  function cleanSpecifier(specifier) {
    // Decode escapes used by URL imports, then strip Vite's query/hash suffix.
    try { specifier = decodeURIComponent(specifier); } catch { /* Keep malformed values visible. */ }
    return slash(specifier).split(/[?#]/, 1)[0];
  }
  /** @param {string} file @param {string} value @param {string} context */
  function protocol(file, value, context) {
    if (!/^(?:workspace|file|link):/i.test(value)) return false;
    record(file, 'dependency-protocol', `${context}: ${value}`);
    return true;
  }
  /** @param {string} file @param {string} value */
  function escapes(file, value) {
    const normalized = cleanSpecifier(value);
    if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return true;
    const target = path.resolve(path.dirname(file), normalized);
    if (outside(hostRoot, target)) return true;
    // pnpm may place an installed dependency's real files outside the host.
    // The install location itself is host-local; never follow those links when
    // deciding whether source reaches into the repository.
    if (!outside(path.join(hostRoot, 'node_modules'), target)) return false;
    // Inspect the nearest existing ancestor too: an extensionless import or a
    // not-yet-written target must not hide an escaping directory symlink.
    let ancestor = target;
    while (!existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
    return outside(realpathSync(hostRoot), realpathSync(ancestor));
  }
  /** @param {string} file @param {string} value @param {string} context */
  function localPath(file, value, context) {
    if (protocol(file, value, context)) return;
    if (escapes(file, value)) record(file, 'outside-host-path', `${context}: ${value}`);
    else if (context === '@source') {
      const target = path.resolve(path.dirname(file), cleanSpecifier(value));
      const installed = path.join(hostRoot, 'node_modules');
      if (!outside(installed, target) && !dependencies.has(packageName(slash(path.relative(installed, target))))) {
        record(file, 'undeclared-package', `${context}: ${value}`);
      }
    }
  }
  /** @param {string} file @param {string} value @param {string} context @param {boolean} [css] */
  function moduleReference(file, value, context, css = false) {
    if (protocol(file, value, context)) return;
    const normalized = cleanSpecifier(value);
    if (/^(?:\.{1,2}(?:\/|$)|\/|[a-z]:\/)/i.test(normalized)) {
      if (escapes(file, value)) record(file, 'outside-host-import', `${context}: ${value}`);
      // Direct node_modules paths bypass package resolution and declarations.
      else if (normalized.split('/').includes('node_modules')) record(file, 'repository-import', `${context}: ${value}`);
      return;
    }
    if (isBuiltin(value)) return;
    const name = packageName(normalized);
    if (normalized.split('/').includes('..') || /^(?:src|scripts|fixtures|packages)(?:\/|$)/.test(normalized)
      || /^zudo-composer\/(?:src|scripts|fixtures|packages)(?:\/|$)/.test(normalized)) {
      record(file, 'repository-import', `${context}: ${value}`);
      return;
    }
    // Epic decision 2: the tool resolves these public CSS imports from its own
    // Tailwind dependency. This does not admit JS imports or other packages.
    if (css && normalized.startsWith('tailwindcss/')) return;
    if (value.startsWith('#')) {
      const imports = object(manifest.imports);
      if (Object.keys(imports).some((key) => key === value || (key.includes('*') && value.startsWith(key.split('*')[0]) && value.endsWith(key.split('*')[1])))) return;
    }
    if (!dependencies.has(name)) record(file, 'undeclared-package', `${context}: ${value}`);
  }

  /** @param {string} file @param {string} command @param {string} context @param {boolean} [scanProtocols] */
  function commands(file, command, context, scanProtocols = true) {
    // Preserve quoted arguments and command boundaries; handle line continuations
    // before tokenizing. -- ends pnpm options, so forwarded -w is not a root flag.
    const tokens = command.replace(/\\\r?\n/g, ' ').match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|`]+|[;&|\n]/g) ?? [];
    const words = tokens.map((token) => token.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2'));
    for (let index = 0; index < words.length; index++) {
      if (words[index].startsWith('#')) {
        while (index < words.length && words[index] !== '\n') index++;
        continue;
      }
      if (scanProtocols) protocol(file, words[index], context);
      if (!/^(?:pnpm|pnpm\.cmd)$/.test(slash(words[index]).split('/').at(-1) ?? '')) continue;
      const invocation = [];
      for (let cursor = index + 1; cursor < words.length && !/^[;&|\n]$/.test(words[cursor]); cursor++) {
        if (words[cursor] === '--' || words[cursor].startsWith('#')) break;
        invocation.push(words[cursor]);
      }
      if (invocation.some((word) => /^--(?:workspace-root|filter(?:-prod)?)(?:=|$)/.test(word) || /^-[^-]*w/.test(word))) {
        record(file, 'workspace-command', `${context}: ${['pnpm', ...invocation].join(' ')}`);
      }
    }
    // Commands execute from the host directory, unlike relative module imports.
    for (const [index, word] of words.entries()) {
      const argument = word.replace(/^--(?:dir|prefix)=/, '');
      const directoryArgument = /^(?:-C|--dir|--prefix|cd)$/.test(words[index - 1] ?? '') || /^--(?:dir|prefix)=/.test(word);
      if ((/^\.\.(?:[\\/]|$)/.test(argument) || directoryArgument) && escapes(path.join(hostRoot, 'package.json'), argument)) {
        record(file, 'outside-host-path', `${context}: ${argument}`);
      }
    }
  }

  /** @param {string} file @param {string} source @param {string} [parserFile] */
  function scanSource(file, source, parserFile = file) {
    const tree = ts.createSourceFile(parserFile, source, ts.ScriptTarget.Latest, true);
    const requireNames = new Set(['require']);
    const createRequireNames = new Set(['createRequire']);
    const commandNames = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']);
    /** @param {import('typescript').Expression} expression */
    const createsRequire = (expression) => (ts.isIdentifier(expression) && createRequireNames.has(expression.text))
      || (ts.isPropertyAccessExpression(expression) && expression.name.text === 'createRequire');
    /** @param {import('typescript').Node} node */
    function collect(node) {
      if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'createRequire') createRequireNames.add(node.name.text);
      if (ts.isImportSpecifier(node) && commandNames.has((node.propertyName ?? node.name).text)) commandNames.add(node.name.text);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isCallExpression(node.initializer) && createsRequire(node.initializer.expression)) requireNames.add(node.name.text);
      }
      ts.forEachChild(node, collect);
    }
    collect(tree);
    /** @param {import('typescript').Node | undefined} node @returns {string | undefined} */
    function literal(node) {
      if (!node) return undefined;
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = literal(node.left), right = literal(node.right);
        if (left !== undefined && right !== undefined) return left + right;
      }
      if (ts.isTemplateExpression(node)) {
        let value = node.head.text;
        for (const span of node.templateSpans) {
          const part = literal(span.expression);
          if (part === undefined) return undefined;
          value += part + span.literal.text;
        }
        return value;
      }
      return undefined;
    }
    /** @param {import('typescript').Expression} expression @returns {boolean} */
    function isRequire(expression) {
      return (ts.isIdentifier(expression) && requireNames.has(expression.text))
        || (ts.isCallExpression(expression) && createsRequire(expression.expression));
    }
    /** @type {Set<import('typescript').Node>} */
    const consumed = new Set();
    /** @param {import('typescript').Node} node */
    function consume(node) { consumed.add(node); ts.forEachChild(node, consume); }
    /** @param {import('typescript').Node | undefined} node @param {string} context */
    function reference(node, context) {
      if (!node) return;
      const value = literal(node);
      if (value === undefined) record(file, 'computed-import', `${context}: ${node.getText(tree)}`);
      else moduleReference(file, value, context);
      consume(node);
    }
    /** @param {import('typescript').Node} node */
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isJSDocImportTag(node)) reference(node.moduleSpecifier, 'import');
      else if (ts.isExternalModuleReference(node)) reference(node.expression, 'require');
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) reference(node.argument.literal, 'import type');
      else if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if (expression.kind === ts.SyntaxKind.ImportKeyword) reference(node.arguments[0], 'dynamic import');
        else if (isRequire(expression) || (ts.isPropertyAccessExpression(expression) && expression.name.text === 'require')) reference(node.arguments[0], 'require');
        else if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'resolve'
          && (isRequire(expression.expression) || expression.expression.getText(tree) === 'import.meta')) reference(node.arguments[0], 'resolve');
        else if (ts.isPropertyAccessExpression(expression) && /^glob(?:Eager)?$/.test(expression.name.text) && expression.expression.getText(tree) === 'import.meta') {
          const argument = node.arguments[0];
          if (argument && ts.isArrayLiteralExpression(argument)) argument.elements.forEach((element) => reference(element, 'glob'));
          else reference(argument, 'glob');
        }
        const method = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
        if (commandNames.has(method)) {
          const command = literal(node.arguments[0]);
          const argument = node.arguments[1];
          if (command !== undefined) {
            const args = argument && ts.isArrayLiteralExpression(argument) ? argument.elements : [];
            commands(file, [command, ...args.map((element) => literal(element) ?? '')].join(' '), 'command');
            consume(node.arguments[0]);
            args.forEach(consume);
          }
        }
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL'
        && node.arguments?.[1]?.getText(tree) === 'import.meta.url') {
        const value = literal(node.arguments[0]);
        if (value !== undefined) { localPath(file, value, 'URL'); consumed.add(node.arguments[0]); }
        else record(file, 'computed-import', `URL: ${node.arguments[0].getText(tree)}`);
      } else if (ts.isPropertyAssignment(node) && /zudo-composer\.config\./.test(path.basename(file))
        && node.name.getText(tree).replace(/["']/g, '') === 'pack') reference(node.initializer, 'component pack');
      if (ts.isStringLiteralLike(node) && !consumed.has(node)) {
        if (!protocol(file, node.text, 'literal') && /^\.\.(?:[\\/]|$)/.test(node.text)) localPath(file, node.text, 'literal');
        if (/\bpnpm\b/.test(node.text)) commands(file, node.text, 'command');
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    // TypeScript keeps JSDoc outside ordinary forEachChild traversal. Its
    // import types and @import tags are dependencies, unlike comment prose.
    const docs = new Set();
    /** @param {import('typescript').Node} node */
    function visitDocs(node) {
      for (const doc of ts.getJSDocCommentsAndTags(node)) {
        if (!docs.has(doc)) { docs.add(doc); visit(doc); }
      }
      ts.forEachChild(node, visitDocs);
    }
    visitDocs(tree);
    for (const reference of tree.referencedFiles) localPath(file, reference.fileName, 'type reference');
    for (const reference of tree.typeReferenceDirectives) {
      const typePackage = `@types/${reference.fileName.replace(/^@/, '').replace('/', '__')}`;
      moduleReference(file, dependencies.has(typePackage) ? typePackage : reference.fileName, 'type reference');
    }
  }

  /** @param {string} file @param {string} source */
  function scanJson(file, source) {
    // Ordinary host data may be a top-level array. TypeScript's config parser
    // accepts JSON comments but requires an object, so use it only for configs.
    const parsed = path.extname(file) === '.jsonc' || /^tsconfig(?:\..+)?\.json$/.test(path.basename(file))
      ? ts.parseConfigFileTextToJson(file, source) : { config: JSON.parse(source) };
    if (parsed.error) throw new Error(`${file}: invalid JSON: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`);
    /** @param {unknown} value @param {string[]} keys */
    function visit(value, keys) {
      if (typeof value === 'string') {
        const context = keys.join('.');
        if (file === path.join(hostRoot, 'package.json') && keys.length === 2
          && ['dependencies', 'devDependencies'].includes(keys[0])
          && value === 'workspace:*' && authoringDependencies.has(keys[1])) return;
        if (keys[0] === 'imports' && path.basename(file) === 'package.json') moduleReference(file, value, context);
        else if (keys[0] === 'scripts' && path.basename(file) === 'package.json') commands(file, value, context);
        else if (!protocol(file, value, context) && /^\.\.(?:[\\/]|$)/.test(value)) localPath(file, value, context);
        if (keys[0] === 'extends' && /^tsconfig(?:\..+)?\.json$/.test(path.basename(file)) && !value.startsWith('.')) moduleReference(file, value, context);
      } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...keys, String(index)]));
      else for (const [key, item] of Object.entries(object(value))) visit(item, [...keys, key]);
    }
    visit(parsed.config, []);
  }

  /** @param {string} file @param {string} source */
  function scanCss(file, source) {
    const content = boundarySource(source, { fileName: 'style.css' });
    for (const match of content.matchAll(/@(import|reference|source|plugin|config)\s+(?:url\(\s*(?:["']([^"']+)["']|([^\s)]+))\s*\)|["']([^"']+)["'])/g)) {
      const value = match[2] ?? match[3] ?? match[4];
      if (match[1] === 'source' || match[1] === 'config') localPath(file, value, `@${match[1]}`);
      else moduleReference(file, value, `@${match[1]}`, match[1] === 'import' || match[1] === 'reference');
    }
  }

  /** @type {Set<string>} */
  const visited = new Set();
  /** @param {string} directory */
  function walk(directory) {
    const realDirectory = realpathSync(directory);
    if (visited.has(realDirectory)) return;
    visited.add(realDirectory);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (ignoredDirectories.has(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (!existsSync(file) || outside(realpathSync(hostRoot), realpathSync(file))) record(file, 'outside-host-symlink', 'symlink target leaves the host or is missing');
        // Local symlink targets are scanned at their real location; do not walk
        // installed links or cycles. Imports also check the resolved target.
        continue;
      }
      if (entry.isDirectory()) { walk(file); continue; }
      const ext = path.extname(entry.name);
      if (!sourceExtensions.has(ext) && !['.json', '.jsonc', '.css', '.html'].includes(ext) && !textExtensions.has(ext) && entry.name !== '.npmrc') continue;
      const source = readFileSync(file, 'utf8');
      if (sourceExtensions.has(ext)) scanSource(file, source);
      else if (ext === '.json' || ext === '.jsonc') scanJson(file, source);
      else if (ext === '.css') scanCss(file, source);
      else {
        commands(file, source, 'command', false);
        for (const match of source.matchAll(/\b(?:workspace|file|link):[^\s"'`<>)]+/gi)) protocol(file, match[0], 'text');
        if (ext === '.md' || ext === '.mdx') {
          for (const match of source.matchAll(/```(?:[cm]?[jt]sx?)\s*\n([\s\S]*?)```/g)) scanSource(file, match[1], file.replace(/\.mdx?$/, '.tsx'));
        }
        if (ext === '.html') {
          for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) scanSource(file, match[1]);
          for (const match of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) localPath(file, match[1], 'script src');
          scanCss(file, source);
        }
      }
    }
  }
  if (outside(realpathSync(root), realpathSync(hostRoot)) && !outside(root, hostRoot)) {
    record(path.join(hostRoot, 'package.json'), 'outside-host-symlink', 'host root resolves outside the scan root');
  } else walk(hostRoot);
  return [...violations.values()].sort((left, right) => identity(left).localeCompare(identity(right)));
}

/** @param {Violation[]} violations @param {unknown} ledger */
export function checkConsumerLedger(violations, ledger) {
  if (!Array.isArray(ledger)) throw new Error('Consumer boundary ledger must be an array.');
  /** @type {Map<string, LedgerEntry>} */
  const entries = new Map();
  for (const value of ledger) {
    const entry = object(value);
    if (Object.keys(entry).sort().join(',') !== 'count,detail,file,host,issue,rule'
      || !['host', 'file', 'rule', 'detail'].every((key) => typeof entry[key] === 'string' && entry[key].length > 0)
      || !Number.isSafeInteger(entry.count) || Number(entry.count) < 1
      || !Number.isSafeInteger(entry.issue) || Number(entry.issue) < 1
      || !rules.has(String(entry.rule))) throw new Error(`Invalid consumer boundary ledger entry: ${JSON.stringify(value)}`);
    const typed = /** @type {LedgerEntry} */ (entry);
    for (const name of [typed.host, typed.file]) {
      if (slash(name) !== name || path.posix.isAbsolute(name) || name.split('/').includes('..') || path.posix.normalize(name) !== name) throw new Error(`Non-canonical ledger path: ${name}`);
    }
    const key = identity(typed);
    if (entries.has(key)) throw new Error(`Duplicate consumer boundary ledger entry: ${key}`);
    entries.set(key, typed);
  }
  const actual = new Map(violations.map((entry) => [identity(entry), entry]));
  const unexpected = violations.filter((entry) => !entries.has(identity(entry)));
  const stale = [...entries.values()].filter((entry) => !actual.has(identity(entry)));
  const counts = violations.flatMap((entry) => {
    const expected = entries.get(identity(entry));
    return expected && expected.count !== entry.count ? [{ ...entry, expected: expected.count, issue: expected.issue }] : [];
  });
  return { ok: unexpected.length === 0 && stale.length === 0 && counts.length === 0, unexpected, stale, counts, remaining: entries.size };
}

/** @param {string[]} args */
export function runConsumerBoundary(args) {
  let root = repositoryRoot;
  let ledgerFile = defaultLedger;
  /** @type {string[]} */
  const requestedHosts = [];
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], value = args[++index];
    if (!['--root', '--host', '--ledger'].includes(flag) || !value || value.startsWith('--')) throw new Error('Usage: check-consumer-boundary.mjs [--root <directory>] [--host <directory> ...] [--ledger <json>]');
    if (flag === '--root') root = path.resolve(value);
    else if (flag === '--ledger') ledgerFile = path.resolve(value);
    else requestedHosts.push(value);
  }
  const hosts = requestedHosts.length ? requestedHosts.map((host) => path.resolve(root, host)) : discoverConsumerHosts(root);
  if (hosts.length === 0) throw new Error('Consumer boundary scan found no hosts.');
  if (new Set(hosts).size !== hosts.length) throw new Error('Consumer boundary scan received duplicate hosts.');
  const violations = hosts.flatMap((hostRoot) => scanConsumerHost({ root, hostRoot }));
  const result = checkConsumerLedger(violations, JSON.parse(readFileSync(ledgerFile, 'utf8')));
  console.log(`Consumer boundary: ${hosts.length} hosts; ${result.remaining} ledger entries remaining (${violations.reduce((count, entry) => count + entry.count, 0)} occurrences).`);
  if (!result.ok) {
    console.error('Consumer boundary scan failed:');
    for (const entry of result.unexpected) console.error(`- NEW ${entry.host}/${entry.file}: ${entry.rule} (${entry.detail}) [${entry.count} occurrences]`);
    for (const entry of result.stale) console.error(`- STALE ${entry.host}/${entry.file}: ${entry.rule} (${entry.detail}); remove the ledger entry owned by issue ${entry.issue}.`);
    for (const entry of result.counts) console.error(`- COUNT ${entry.host}/${entry.file}: ${entry.rule} (${entry.detail}); ledger ${entry.expected}, found ${entry.count} (issue ${entry.issue}).`);
  } else console.log('Consumer boundary scan passed: the known-violation ledger matches exactly.');
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = runConsumerBoundary(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
