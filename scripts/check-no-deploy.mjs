// @ts-check
// Audit validation entry points without running them. Follow package aliases,
// local workflow/actions, shell wrappers and JS/TS imports/command arguments.
// Cloudflare commands must have statically provable dry-run arguments; opaque
// Cloudflare wrappers and SDK/API calls are deliberately rejected.
import { existsSync, globSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { parse } from "yaml";
import { discoverConsumerHosts } from "./check-consumer-boundary.mjs";

const self = fileURLToPath(import.meta.url);
const localEntries = ["check", "smoke:host-install", "packed-host:matrix", "consumer:boundary", "creator:check", "cms:check", "cms:regenerate", "public:check", "public:installed", "studio:check", "demo:build-sites", "demo:build-site", "site-static:verify", "doc:build-site", "doc:build", "doc:check"];
const packageOperations = new Set(["install", "pack", "add", "remove", "rebuild"]);
// zfb is a static site generator; it never talks to Cloudflare.
const localBinaries = new Set(["vite", "vitest", "tsc", "eslint", "playwright", "rollup", "zudo-composer", "zfb"]);
const shellBinaries = new Set(["sh", "bash", "zsh"]);
const ordinaryBinaries = new Set(["git", "tar", "find", "echo", "printf", "test", "true", "false", "mkdir", "rm", "cp", "mv", "cat", "pwd", "chmod"]);
const processNames = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "run", "runCommand", "runInitCommand"]);
const nativeProcessNames = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]);
const unknown = "<dynamic>";

/**
 * Read pnpm's workspace package globs and return every matching package
 * manifest, including brace patterns and exclusions. Only inspect matching
 * directories; dependencies and unrelated nested checkouts are not members.
 *
 * @param {string} root
 * @returns {string[]}
 */
function discoverWorkspaceManifests(root) {
  const workspaceFile = join(root, "pnpm-workspace.yaml");
  if (!existsSync(workspaceFile)) return [];
  const workspace = object(parse(readFileSync(workspaceFile, "utf8")));
  const patterns = workspace.packages === undefined ? [] : workspace.packages;
  if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === "string" && pattern.length > 0)) {
    throw new Error("No-deploy assertion: pnpm workspace packages must be an array of nonempty glob strings");
  }
  /** @param {string[]} entries */
  const expand = (entries) => globSync(entries.map((pattern) => `${pattern.replace(/\/+$/u, "")}/package.json`), {
    cwd: root, exclude: (path) => path.split(/[/\\]/u).some((part) => ["node_modules", ".git", "bower_components"].includes(part)),
  }).map((manifest) => resolve(root, manifest));
  const included = expand(patterns.filter((pattern) => !pattern.startsWith("!")));
  const excluded = new Set(expand(patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1))));
  return [...new Set(included)].filter((manifest) => !excluded.has(manifest)).sort();
}

/** @param {unknown} value @returns {Record<string, any>} */
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};

/** Split shell words without dropping executable segments after ;, && or pipes.
 * Substitutions cannot supply commands unseen by the audit.
 * @param {string} source */
export function shellCommands(source) {
  /** @type {string[][]} */
  const commands = [];
  /** @type {string[]} */
  let words = [];
  let word = "", quote = "", active = false;
  const flush = () => { if (active) words.push(word); word = ""; active = false; };
  const finish = () => { flush(); if (words.length) commands.push(words); words = []; };
  source = source.replace(/\\\r?\n/gu, " ").replace(/\$\{\{[\s\S]*?\}\}/gu, unknown);
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = "";
      else if (char === "\\" && quote === '"') word += source[++index] ?? "";
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; active = true; }
    else if (char === "\\") { word += source[++index] ?? ""; active = true; }
    else if (char === "#" && !active) { while (index < source.length && source[index] !== "\n") index++; finish(); }
    else if (";&|\n".includes(char)) finish();
    else if (/\s/u.test(char)) flush();
    else { word += char; active = true; }
  }
  if (quote) throw new Error("Unclosed shell quote");
  finish();
  return commands;
}

/** @param {{root?: string, entries?: string[], hostRoots?: string[]}} [options] */
export function checkNoDeploy({ root = resolve(import.meta.dirname, ".."), entries = localEntries, hostRoots = [] } = {}) {
  root = realpathSync(root);
  const manifests = new Map([[root, object(JSON.parse(readFileSync(join(root, "package.json"), "utf8")))],
    ...discoverConsumerHosts(root).map((host) => /** @type {[string, Record<string, any>]} */ ([host, object(JSON.parse(readFileSync(join(host, "package.json"), "utf8")))]))]);
  // pnpm install/pack also reaches lifecycle hooks of non-host workspace
  // packages, including the component-contract prepare/build chain.
  for (const directory of ["packages", "fixtures"]) if (existsSync(join(root, directory))) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) if (entry.isDirectory()) {
      const path = join(root, directory, entry.name);
      if (existsSync(join(path, "package.json"))) manifests.set(path, JSON.parse(readFileSync(join(path, "package.json"), "utf8")));
    }
  }
  for (const host of hostRoots) manifests.set(resolve(host), JSON.parse(readFileSync(join(host, "package.json"), "utf8")));
  // Keep the existing package/fixture command discovery above, but include
  // every pnpm workspace member when following lifecycle hooks. Documentation
  // is a workspace package without a consumer-host role, so its ordinary
  // development scripts are not treated as repository validation entries.
  const lifecycleOnlyManifests = new Set();
  for (const manifest of discoverWorkspaceManifests(root)) {
    const directory = dirname(manifest);
    if (!manifests.has(directory)) lifecycleOnlyManifests.add(directory);
    manifests.set(directory, object(JSON.parse(readFileSync(manifest, "utf8"))));
  }
  const visitedScripts = new Set(), visitedSources = new Set(), visitedWorkflows = new Set();
  const commands = new Set();
  let inlineSequence = 0;
  /** @type {Map<string, {tree: import('typescript').SourceFile, bindings: Map<string, import('typescript').Expression>, imports: Map<string, {file: string, name: string}>}>} */
  const modules = new Map();
  /** @param {string} message @param {string} origin */
  /** @type {(message: string, origin: string) => never} */
  const fail = (message, origin) => { throw new Error(`No-deploy assertion: ${message}\nReachable from ${origin}`); };
  /** @param {string} path @param {string} origin */
  function assertAllowedPath(path, origin) {
    if (/(?:^|\/)scripts\/hosted-demo\/(?:deploy|live-check|workflow-guard)\.mjs$/u.test(path.replaceAll("\\", "/"))
      || path.endsWith("/.github/workflows/hosted-demo-deploy.yml")) fail(`production entry point ${path}`, origin);
  }
  /** @param {string} path */
  function sourcePath(path) {
    for (const candidate of [path, ...[".mjs", ".js", ".ts", ".tsx"].map((suffix) => path + suffix), path.replace(/\.js$/u, ".ts")]) {
      if (existsSync(candidate) && /\.(?:[cm]?[jt]sx?|sh|bash|zsh)$/u.test(candidate)) return resolve(candidate);
    }
    return undefined;
  }
  /** @param {string} directory @param {string} name @param {string} origin */
  function script(directory, name, origin) {
    if (name === "hosted-demo:deploy" || name === "hosted-demo:live-check" || name === "hosted-demo:workflow-guard") fail(`forbidden script ${name}`, origin);
    if (!manifests.has(directory) && existsSync(join(directory, "package.json"))) manifests.set(directory, JSON.parse(readFileSync(join(directory, "package.json"), "utf8")));
    const scripts = object(manifests.get(directory)?.scripts);
    if (typeof scripts[name] !== "string") fail(`unresolved package script ${name} in ${relative(root, directory) || "."}`, origin);
    const key = `${directory}:${name}`;
    if (visitedScripts.has(key)) return;
    visitedScripts.add(key);
    for (const hook of [`pre${name}`, name, `post${name}`]) if (typeof scripts[hook] === "string") shell(scripts[hook], directory, `${origin} -> ${relative(root, directory) || "."}/package.json#${hook}`);
  }
  /** @param {string[]} words @param {string} cwd @param {string} origin @param {boolean} [fromSource] */
  function invocation(words, cwd, origin, fromSource = false) {
    words = [...words];
    while (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[0] ?? "")) words.shift();
    if (!words.length) return;
    const executable = words.shift() ?? "";
    const binary = basename(executable).replace(/\.cmd$/u, "");
    commands.add([binary, ...words].join(" "));
    if (binary.includes(unknown) || /[$`]/u.test(binary)) fail("dynamic shell executable needs explicit review", origin);
    if (binary === "env" || binary === "corepack") return invocation(words, cwd, origin, fromSource);
    if (binary === "wrangler" || /^wrangler@/u.test(binary)) {
      // Only this explicit shape may touch Cloudflare tooling. Flags that look
      // like --dry-run=false, --dry-run true or dry-run on `versions upload`
      // cannot turn another Wrangler command into a permitted operation.
      if (words[0] !== "deploy" || !words.includes("--dry-run") || words.some((word) => word.includes(unknown) || /^(?:--dry-run=|--no-dry-run)/u.test(word))
        || words.filter((word) => word === "--dry-run").length !== 1) fail(`Cloudflare command is not an explicit Wrangler deploy --dry-run: ${[binary, ...words].join(" ")}`, origin);
      const dry = words.indexOf("--dry-run");
      if (words[dry + 1] && !words[dry + 1].startsWith("--")) fail("--dry-run must be a standalone boolean flag", origin);
      return;
    }
    if ([binary, ...words].some((word) => /api\.cloudflare\.com|(?:^|\/)cloudflare(?:$|@)/iu.test(word))) fail("direct Cloudflare API/SDK invocation is outside build/verify/dry-run", origin);
    if (binary === "pnpm" || binary === "npm" || binary === "npx") {
      while (words[0]?.startsWith("-")) {
        const option = words.shift();
        if (["--dir", "-C", "--prefix"].includes(option ?? "")) cwd = resolve(cwd, words.shift() ?? unknown);
        else if (option === "-w" || option === "--workspace-root") cwd = root;
        else fail(`unsupported package-manager selector ${option}`, origin);
      }
      const verb = words.shift();
      if (!verb || verb.includes(unknown)) fail("unresolved package-manager command", origin);
      if (verb === "exec" || binary === "npx") return invocation(binary === "npx" ? [verb, ...words] : words, cwd, origin, fromSource);
      if (verb === "dlx") return invocation(words, cwd, origin, fromSource);
      if (packageOperations.has(verb)) {
        // Local lifecycle hooks are also reachable through installs and packs.
        for (const [directory, manifest] of manifests) for (const hook of ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"]) {
          if (typeof manifest.scripts?.[hook] === "string") script(directory, hook, origin);
        }
        return;
      }
      const name = verb === "run" || verb === "run-script" ? words.shift() : verb;
      if (!name) fail("missing script name", origin);
      const candidates = fromSource ? [...manifests.keys()].filter((directory) => typeof manifests.get(directory)?.scripts?.[name ?? ""] === "string") : [cwd];
      if (!candidates.length) fail(`unresolved package script ${name}`, origin);
      for (const directory of candidates) script(directory, /** @type {string} */ (name), origin);
      return;
    }
    if (shellBinaries.has(binary)) {
      if (words[0] === "-c" || words[0] === "-lc") return shell(words[1] ?? "", cwd, origin);
      const file = sourcePath(resolve(cwd, words[0] ?? ""));
      if (!file) fail(`unresolved shell wrapper ${words[0]}`, origin);
      return source(/** @type {string} */ (file), cwd, origin);
    }
    if (["node", "tsx"].includes(binary)) {
      const inline = words.findIndex((word) => ["-e", "--eval", "-p", "--print"].includes(word));
      if (inline >= 0) return javascript(words[inline + 1] ?? "", join(cwd, `.no-deploy-inline-${++inlineSequence}.mjs`), cwd, origin);
      const candidate = words.find((word, index) => !word.startsWith("-") && !["--import", "--loader"].includes(words[index - 1]));
      if (!candidate) fail("unresolved Node entry", origin);
      if (/(?:^|\/)wrangler\/(?:bin|wrangler-dist)\//u.test(candidate)) return invocation(["wrangler", ...words.slice(words.indexOf(candidate) + 1)], cwd, origin, fromSource);
      assertAllowedPath(/** @type {string} */ (candidate), origin);
      const file = sourcePath(resolve(cwd, candidate ?? ""));
      if (file) source(file, cwd, origin);
      else if (!fromSource) fail(`unresolved Node wrapper ${candidate}`, origin);
      return;
    }
    if (localBinaries.has(binary)) {
      // CLI/build configurations may import local wrappers too.
      for (const name of binary === "vite" ? ["vite.config"] : binary === "vitest" ? ["vitest.config", "vite.config"] : []) {
        const config = sourcePath(resolve(cwd, name));
        if (config) source(config, cwd, origin);
      }
      for (let index = 0; index < words.length; index++) if (words[index] === "--config") {
        const file = sourcePath(resolve(cwd, words[index + 1]));
        if (file) source(file, cwd, origin);
      }
      if (binary === "zudo-composer") source(join(root, "bin/zudo-composer.mjs"), root, origin);
      return;
    }
    if (ordinaryBinaries.has(binary)) return;
    const file = sourcePath(resolve(cwd, executable));
    if (file) return source(file, cwd, origin);
    fail(`unreviewed command ${binary}`, origin);
  }
  /** @param {string} text @param {string} cwd @param {string} origin */
  function shell(text, cwd, origin) {
    if (/`|\$\(/u.test(text)) fail("shell command substitution needs explicit review", origin);
    for (const words of shellCommands(text)) invocation(words, cwd, origin);
  }
  /** @param {string} text @param {string} file */
  function module(text, file) {
    const existing = modules.get(file);
    if (existing) return existing;
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    /** @type {Map<string, import('typescript').Expression>} */
    const bindings = new Map();
    /** @type {Map<string, {file: string, name: string}>} */
    const imports = new Map();
    /** @param {import('typescript').Node} node */
    function collect(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith(".")) {
        const imported = sourcePath(resolve(dirname(file), node.moduleSpecifier.text));
        const named = node.importClause?.namedBindings;
        if (imported && named && ts.isNamedImports(named)) for (const item of named.elements) imports.set(item.name.text, { file: imported, name: (item.propertyName ?? item.name).text });
      }
      ts.forEachChild(node, collect);
    }
    collect(tree);
    const result = { tree, bindings, imports };
    modules.set(file, result);
    return result;
  }
  /** Evaluate literal command data, including aliases and concatenations.
   * Unknown arguments stay visible rather than disappearing from dry-run checks.
   * @param {import('typescript').Node | undefined} node @param {string} file @param {Set<string>} [seen] @param {Map<string, string[]>} [parameters] @returns {string[]} */
  function values(node, file, seen = new Set(), parameters = new Map()) {
    if (!node) return [unknown];
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isSpreadElement(node)) return values(node.expression, file, seen, parameters);
    if (ts.isPropertyAccessExpression(node) && ["process.execPath", "proc.execPath"].includes(node.getText())) return ["node"];
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = modules.get(file)?.bindings.get(node.expression.text);
      if (binding && ts.isObjectLiteralExpression(binding)) {
        const property = binding.properties.filter(ts.isPropertyAssignment).find((item) => item.name.getText().replaceAll(/["']/gu, "") === node.name.text);
        if (property) return values(property.initializer, file, seen, parameters);
      }
    }
    if (ts.isIdentifier(node)) {
      if (parameters.has(node.text)) return parameters.get(node.text) ?? [unknown];
      const key = `${file}:${node.text}`;
      if (seen.has(key)) return [unknown];
      seen = new Set([...seen, key]);
      const data = modules.get(file);
      const binding = data?.bindings.get(node.text);
      if (binding) return values(binding, file, seen, parameters);
      const imported = data?.imports.get(node.text);
      if (imported) {
        const target = module(readFileSync(imported.file, "utf8"), imported.file);
        return values(target.bindings.get(imported.name), imported.file, seen);
      }
      return [unknown];
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((item) => values(item, file, seen, parameters));
    if (ts.isConditionalExpression(node)) return [...values(node.whenTrue, file, seen, parameters), ...values(node.whenFalse, file, seen, parameters)];
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return [values(node.left, file, seen, parameters).join("") + values(node.right, file, seen, parameters).join("")];
    if (ts.isTemplateExpression(node)) return [node.head.text + node.templateSpans.map((span) => values(span.expression, file, seen, parameters).join("") + span.literal.text).join("")];
    if (ts.isCallExpression(node) && /(?:^|\.)(?:join|resolve)$/u.test(node.expression.getText())) return [node.arguments.map((item) => values(item, file, seen, parameters).join("")).join("/")];
    return [unknown];
  }
  /** @param {string} text @param {string} file @param {string} cwd @param {string} origin */
  function javascript(text, file, cwd, origin) {
    const data = module(text, file);
    const callableNames = new Set(processNames);
    const nativeNames = new Set(nativeProcessNames);
    const processNamespaces = new Set();
    const requireNames = new Set(["require"]);
    const createRequireNames = new Set(["createRequire"]);
    /** @param {import('typescript').Node} node */
    function aliases(node) {
      if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === "createRequire") createRequireNames.add(node.name.text);
      if (ts.isImportSpecifier(node) && processNames.has((node.propertyName ?? node.name).text)) {
        callableNames.add(node.name.text);
        if (nativeProcessNames.has((node.propertyName ?? node.name).text)) nativeNames.add(node.name.text);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /^(?:node:)?child_process$/u.test(node.moduleSpecifier.text)) {
        const binding = node.importClause?.namedBindings;
        if (binding && ts.isNamespaceImport(binding)) processNamespaces.add(binding.name.text);
        if (node.importClause?.name) processNamespaces.add(node.importClause.name.text);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isIdentifier(node.initializer) && callableNames.has(node.initializer.text)) {
          callableNames.add(node.name.text);
          if (nativeNames.has(node.initializer.text)) nativeNames.add(node.name.text);
        }
        if (ts.isCallExpression(node.initializer) && createRequireNames.has(node.initializer.expression.getText())) requireNames.add(node.name.text);
      }
      ts.forEachChild(node, aliases);
    }
    let count;
    do { count = callableNames.size + requireNames.size + createRequireNames.size; aliases(data.tree); }
    while (count !== callableNames.size + requireNames.size + createRequireNames.size);
    /** Keep conditional command/argument alternatives separate; checking only
     * the CI platform's branch could hide a mutation behind another condition.
     * @param {import('typescript').Node | undefined} node @param {string} owner
     * @param {Map<string, string[]>} parameters @param {Set<string>} [seen]
     * @returns {string[][]} */
    function alternatives(node, owner, parameters, seen = new Set()) {
      if (!node) return [[unknown]];
      if (ts.isIdentifier(node) && !parameters.has(node.text)) {
        const key = `${owner}:${node.text}`;
        if (seen.has(key)) return [[unknown]];
        const next = new Set([...seen, key]);
        const local = modules.get(owner)?.bindings.get(node.text);
        if (local) return alternatives(local, owner, parameters, next);
        const imported = modules.get(owner)?.imports.get(node.text);
        if (imported) return alternatives(module(readFileSync(imported.file, "utf8"), imported.file).bindings.get(imported.name), imported.file, parameters, next);
      }
      if (ts.isConditionalExpression(node)) return [...alternatives(node.whenTrue, owner, parameters, seen), ...alternatives(node.whenFalse, owner, parameters, seen)];
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isSpreadElement(node)) return alternatives(node.expression, owner, parameters, seen);
      if (ts.isArrayLiteralExpression(node)) {
        /** @type {string[][]} */
        let variants = [[]];
        for (const item of node.elements) variants = variants.flatMap((prefix) => alternatives(item, owner, parameters, seen).map((suffix) => [...prefix, ...suffix]));
        return variants;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return alternatives(node.left, owner, parameters, seen)
        .flatMap((left) => alternatives(node.right, owner, parameters, seen).map((right) => [left.join("") + right.join("")]));
      return [values(node, owner, seen, parameters)];
    }
    /** Bind ordinary local wrapper parameters from their actual call sites.
     * @param {import('typescript').CallExpression} command */
    function commandVariants(command) {
      /** @type {Map<string, string[]>[]} */
      const contexts = [new Map()];
      let parent = command.parent;
      while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
      if (parent && ts.isFunctionDeclaration(parent) && parent.name) {
        const wrapper = parent;
        /** @param {import('typescript').Node} node */
        function calls(node) {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === wrapper.name?.text) {
            let variants = [new Map()];
            for (const [index, parameter] of wrapper.parameters.entries()) if (ts.isIdentifier(parameter.name)) {
              const name = parameter.name.text;
              variants = variants.flatMap((parameters) => alternatives(node.arguments[index], file, new Map()).map((value) => new Map([...parameters, [name, value]])));
            }
            contexts.push(...variants);
          }
          ts.forEachChild(node, calls);
        }
        calls(data.tree);
      }
      return contexts.flatMap((parameters) => alternatives(command.arguments[0], file, parameters)
        .flatMap((prefix) => command.arguments[1] ? alternatives(command.arguments[1], file, parameters).map((suffix) => [...prefix, ...suffix]) : [prefix]));
    }
    /** @param {import('typescript').Node} node */
    function visit(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText().replaceAll(/["']/gu, "") === "scripts" && ts.isObjectLiteralExpression(node.initializer)) {
        const directory = join(dirname(file), `.generated-command-manifest-${node.pos}`);
        /** @type {Record<string, string>} */
        const scripts = {};
        for (const property of node.initializer.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) fail("generated scripts require literal reviewable commands", origin);
          const field = /** @type {import('typescript').PropertyAssignment & {initializer: import('typescript').StringLiteral}} */ (property);
          scripts[field.name.getText().replaceAll(/["']/gu, "")] = field.initializer.text;
        }
        manifests.set(directory, { scripts });
        for (const name of Object.keys(scripts)) script(directory, name, `${origin} -> ${relative(root, file)} generated scripts`);
        return;
      }
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const specifier = node.moduleSpecifier.text;
          if (/^(?:cloudflare|wrangler)(?:\/|$)/u.test(specifier)) fail(`Cloudflare SDK import ${specifier}`, origin);
          if (specifier.startsWith(".")) {
            const imported = sourcePath(resolve(dirname(file), specifier));
            if (imported) source(imported, cwd, origin);
          }
        }
      }
      if (ts.isStringLiteralLike(node)) {
        assertAllowedPath(node.text, origin);
        if (/api\.cloudflare\.com/iu.test(node.text)) fail("direct Cloudflare API access", origin);
        // CLI dispatch tables and child-process paths are often URL/join data,
        // not ESM imports. Follow those literal local entries as well.
        if (/^(?:\.{1,2}\/|scripts\/|server\/|bin\/|plugins\/)[^\n"']+\.[cm]?[jt]sx?$/u.test(node.text)) {
          const target = sourcePath(resolve(node.text.startsWith(".") ? dirname(file) : root, node.text));
          if (target) source(target, cwd, origin);
        }
      }
      if (ts.isCallExpression(node)) {
        if (requireNames.has(node.expression.getText()) || ts.isCallExpression(node.expression) && createRequireNames.has(node.expression.expression.getText())) {
          for (const specifier of values(node.arguments[0], file)) {
            if (/^(?:cloudflare|wrangler)(?:\/|$)/u.test(specifier)) fail(`Cloudflare SDK require ${specifier}`, origin);
            if (specifier.startsWith(".")) {
              const imported = sourcePath(resolve(dirname(file), specifier));
              if (imported) source(imported, cwd, origin);
            }
          }
        }
        for (const argument of node.arguments) if (ts.isObjectLiteralExpression(argument)) {
          const properties = new Map(argument.properties.filter(ts.isPropertyAssignment).map((property) => [property.name.getText(), property.initializer]));
          if (properties.has("command") && properties.has("args")) {
            const command = values(properties.get("command"), file);
            if (command.length === 1 && command[0] !== unknown) invocation([...command, ...values(properties.get("args"), file)], cwd, origin, true);
          }
        }
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(node.arguments[0])) {
          if (/^(?:cloudflare|wrangler)(?:\/|$)/u.test(node.arguments[0].text)) fail(`Cloudflare SDK import ${node.arguments[0].text}`, origin);
          const imported = sourcePath(resolve(dirname(file), node.arguments[0].text));
          if (imported) source(imported, cwd, origin);
        }
        const name = node.expression.getText().split(".").at(-1) ?? "";
        const processCall = callableNames.has(name) && (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression) && processNamespaces.has(node.expression.expression.getText()));
        const commandLike = processCall || ts.isArrayLiteralExpression(node.arguments[1] ?? data.tree);
        if (processCall && nativeNames.has(name) && values(node.arguments[0], file).every((value) => value === unknown)) {
          // Generic process forwarding is checked at its call sites. Reading
          // the executable from env/computed expressions is not a forwarding
          // declaration and cannot bypass review by resolving to "unknown".
          let parent = node.parent;
          while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
          const argument = node.arguments[0];
          const parameters = parent && ts.isFunctionDeclaration(parent) ? parent.parameters.map((parameter) => parameter.name.getText()).join(" ") : "";
          if (!argument || !ts.isIdentifier(argument) || !parameters.split(/[^A-Za-z0-9_$]+/u).includes(argument.text)) fail("opaque subprocess executable needs explicit review", `${origin} -> ${relative(root, file)}`);
        }
        if (commandLike) for (const words of commandVariants(node)) {
          const command = words[0];
          if (!command || command === unknown) continue;
          if (/^(?:corepack|pnpm|npm|npx|wrangler|node|bash|sh|zsh|tar|git)$/u.test(basename(command).replace(/\.cmd$/u, ""))) {
            // Pure forwarding sites are evaluated with their caller's literal
            // arguments. A Cloudflare executable never gets this exemption.
            if (["corepack", "pnpm", "npm"].includes(command) && words.includes(unknown) && words.findIndex((word) => word === unknown) <= (command === "corepack" ? 2 : 1)) continue;
            invocation(words, cwd, `${origin} -> ${relative(root, file)}:${data.tree.getLineAndCharacterOfPosition(node.pos).line + 1}`, true);
          } else if (processCall) {
            if (/\s/u.test(command)) shell(command, cwd, origin);
            else invocation(words, cwd, origin, true);
          }
        }
        // Any Wrangler expression outside a statically readable command array
        // fails closed, including calls through renamed wrapper functions.
        const all = node.arguments.flatMap((item) => values(item, file));
        if (all.some((value) => /api\.cloudflare\.com/iu.test(value))) fail("direct Cloudflare API access", origin);
        if (all.some((value) => /(?:^|\/)wrangler(?:\.cmd)?$/u.test(value)) && !commandLike) invocation(all, cwd, origin, true);
      }
      ts.forEachChild(node, visit);
    }
    visit(data.tree);
  }
  /** @param {string} file @param {string} cwd @param {string} origin */
  function source(file, cwd, origin) {
    assertAllowedPath(file, origin);
    const key = `${file}:${cwd}`;
    if (file === self || visitedSources.has(key)) return;
    visitedSources.add(key);
    const text = readFileSync(file, "utf8");
    if (/\.(?:sh|bash|zsh)$/u.test(file)) shell(text, cwd, `${origin} -> ${file}`);
    else javascript(text, file, cwd, origin);
  }
  /** @param {string} file */
  function workflow(file) {
    assertAllowedPath(file, file);
    if (visitedWorkflows.has(file)) return;
    visitedWorkflows.add(file);
    const document = object(parse(readFileSync(file, "utf8"), { uniqueKeys: true }));
    const runtime = object(document.runs).using;
    if (runtime !== undefined && runtime !== "composite" && !/^node\d+$/u.test(runtime)) fail(`unreviewed local action runtime ${runtime}`, file);
    /** @param {unknown} value @param {string} cwd */
    function walk(value, cwd) {
      if (Array.isArray(value)) { for (const item of value) walk(item, cwd); return; }
      if (!value || typeof value !== "object") return;
      const mapping = object(value);
      if (typeof mapping.shell === "string" && !["bash", "sh"].includes(mapping.shell)) fail(`unreviewed workflow shell ${mapping.shell}`, file);
      const defaultDirectory = object(object(mapping.defaults).run)["working-directory"];
      if (typeof defaultDirectory === "string") cwd = resolve(root, defaultDirectory);
      if (typeof mapping["working-directory"] === "string") cwd = resolve(root, mapping["working-directory"]);
      if (typeof mapping.run === "string") shell(mapping.run, cwd, relative(root, file));
      if (typeof mapping.uses === "string") {
        if (/cloudflare|wrangler/iu.test(mapping.uses)) fail(`Cloudflare action ${mapping.uses}`, file);
        if (mapping.uses.startsWith("./")) {
          const target = resolve(root, mapping.uses);
          if (/\.ya?ml$/u.test(target)) workflow(target);
          else {
            const action = ["action.yml", "action.yaml"].map((name) => join(target, name)).find(existsSync);
            if (!action) fail(`unresolved local action ${mapping.uses}`, file);
            workflow(/** @type {string} */ (action));
          }
        } else if (!/^(?:actions\/(?:checkout|setup-node|upload-artifact)|pnpm\/action-setup)@[a-f0-9]{40}$/u.test(mapping.uses)) fail(`unreviewed external action ${mapping.uses}`, file);
      }
      // All three Node-action lifecycle entries execute on the runner.
      for (const stage of ["pre", "main", "post"]) if (typeof mapping[stage] === "string") source(resolve(dirname(file), mapping[stage]), cwd, file);
      for (const [key, item] of Object.entries(mapping)) if (!["run", "uses", "pre", "main", "post"].includes(key)) walk(item, cwd);
    }
    walk(document, root);
  }

  for (const name of entries) script(root, name, "local installed-host validation");
  for (const [directory, manifest] of manifests) if (directory !== root && !lifecycleOnlyManifests.has(directory)) {
    for (const name of Object.keys(object(manifest.scripts))) script(directory, name, "discovered host commands");
  }
  const workflows = join(root, ".github/workflows");
  if (existsSync(workflows)) for (const file of readdirSync(workflows)) {
    if (/\.ya?ml$/u.test(file) && file !== "hosted-demo-deploy.yml") workflow(join(workflows, file));
  }
  return { scripts: visitedScripts.size, sources: visitedSources.size, workflows: visitedWorkflows.size, commands: commands.size };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw new Error("Usage: check-no-deploy.mjs");
  console.log(`No-deploy assertion passed: ${JSON.stringify(checkNoDeploy())}`);
}
