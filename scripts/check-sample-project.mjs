// @ts-check

// The test fixture bundles the sample aggregate; demo editors receive the
// selected host's project through a virtual module. Neither ships in the tool.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "..");
export const SAMPLE_PROJECT_PATH = "packages/demo-sample/site-project.json";
export const SAMPLE_PROJECT_MODULES = [
  "src/test/site-project-fixture.ts",
  "src/hosted-demo/bootstrap.ts",
  "vite.demo-editor.config.ts",
];
const retiredCopies = ["src/test/site-project-fixture.json", "src/hosted-demo/sample-project.json"];
const ignoredDirectories = new Set([
  ".git", "node_modules", "worktrees", "dist", "dist-site", "dist-editor",
  ".zudo-site-project", ".vite", ".artifacts", "coverage", "test-results", "playwright-report",
]);

/** Real, in-process release-policy compile sites: they load the fixture and
 * must carry a captured Assets lock through this helper before calling
 * `compileSiteProject`, or release-policy compilation blocks on
 * `asset-impact-incomplete` once Sample Studio references a real image. */
export const SAMPLE_PROJECT_ASSET_LOCK_HELPER = "src/test/sample-asset-lock.ts";
const LOCK_AWARE_VIA_HELPER = [
  "src/features/delivery/__tests__/root-delivery.test.tsx",
  "src/features/delivery/__tests__/runtime.test.tsx",
  "src/features/delivery/__tests__/site-delivery.test.tsx",
  "src/test/sample-asset-lock.test.ts",
];
/** CLI/server tests that copy the committed sample JSON into a temporary host
 * and run it through the real seed/build pipeline: each also copies the
 * committed Assets store into that host, so a future real image reference
 * resolves instead of blocking release-policy compilation. */
const LOCK_AWARE_VIA_ASSET_COPY = [
  "scripts/__tests__/host-site-routes.test.ts",
  "server/cli/__tests__/ready-workspace-installed.test.ts",
  "server/cli/__tests__/seed.test.ts",
  "server/site-project-local/__tests__/cli.test.ts",
];
/** Audited: each reads or imports the sample project/fixture but never
 * compiles it under release policy (see issue #692), so no Assets lock is
 * required. */
const NON_COMPILING_CONSUMERS = [
  "plugins/__tests__/site-project-source-plugin.test.ts",
  // Seeds a disposable host for the dev-server browser lane (B4 topic), not a
  // release-policy compile call in this script.
  "scripts/run-host-browser.mjs",
  // Rejected by pack-mismatch validation before `resolveDemoEditorConfig` ever compiles.
  "server/__tests__/demo-editor-config.test.ts",
  "src/app/__tests__/mapping-attachment-service.test.ts",
  "src/app/__tests__/provider-integration-source.test.ts",
  "src/app/__tests__/provider-integration.test.ts",
  "src/app/__tests__/workspace-state.test.ts",
  "src/app/workspace-filesystem/__tests__/capture.test.ts",
  "src/app/workspace-filesystem/__tests__/registry.test.ts",
  "src/hosted-demo/__tests__/runtime.test.ts",
  "src/test/site-project-source.ts",
];
/** Every file allowed to import or read the sample project/fixture: the
 * bundled base loader, the Assets-lock helper, every known lock-aware
 * consumer, and every audited non-compiling loader. A file discovered by
 * `sampleProjectConsumers` outside this set is a new, unguarded consumer. */
const SAMPLE_PROJECT_CONSUMERS = [
  "src/test/site-project-fixture.ts",
  SAMPLE_PROJECT_ASSET_LOCK_HELPER,
  ...LOCK_AWARE_VIA_HELPER,
  ...LOCK_AWARE_VIA_ASSET_COPY,
  ...NON_COMPILING_CONSUMERS,
].sort();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);
const FS_READ_FUNCTIONS = new Set(["readFile", "readFileSync", "cp", "cpSync", "copyFile", "copyFileSync"]);
/** @param {string} path */
const stripModuleExtension = (path) => path.replace(/\.(ts|tsx|js|jsx|mjs|cjs|json)$/, "");

/**
 * Discover every source file that statically imports the sample project JSON
 * or the bundled fixture module (including a dynamic `import()`/`require()`
 * with a literal specifier), or that reads/copies the committed
 * `packages/demo-sample/site-project.json` by its exact relative path through
 * `readFile`/`readFileSync`/`cp`/`cpSync`/`copyFile`/`copyFileSync`. A bare
 * mention of the path in an unrelated string (an assertion, a fixture that
 * builds the path from a variable) does not count.
 * @param {string} root
 */
export async function sampleProjectConsumers(root) {
  const fixtureTargets = [stripModuleExtension(join(root, SAMPLE_PROJECT_PATH)), stripModuleExtension(join(root, "src/test/site-project-fixture.ts"))];
  /** @type {string[]} */
  const consumers = [];
  /** @param {string} directory */
  async function walk(directory = "") {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) { await walk(relativePath); continue; }
      if (entry.isDirectory() || !SOURCE_EXTENSIONS.has(/\.[^/.]+$/.exec(entry.name)?.[0] ?? "")) continue;
      const absolutePath = join(root, relativePath);
      const source = await readFile(absolutePath, "utf8");
      if (!source.includes("site-project-fixture") && !source.includes("demo-sample/site-project.json")) continue;
      const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
      let matched = false;
      /** @param {import("typescript").Node} node */
      function visit(node) {
        if (matched) return;
        const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
          : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") ? node.arguments[0] : undefined;
        if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) {
          const resolved = stripModuleExtension(resolve(dirname(absolutePath), specifier.text));
          if (fixtureTargets.includes(resolved)) matched = true;
        }
        if (!matched && ts.isCallExpression(node)) {
          const callee = ts.isIdentifier(node.expression) ? node.expression.text
            : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
          if (callee && FS_READ_FUNCTIONS.has(callee) && node.arguments.some((argument) => containsExactLiteral(argument, SAMPLE_PROJECT_PATH))) matched = true;
        }
        if (!matched) ts.forEachChild(node, visit);
      }
      visit(tree);
      if (matched) consumers.push(relativePath);
    }
  }
  await walk();
  return consumers.sort();
}

/** @param {import("typescript").Node} node
 * @param {string} text */
function containsExactLiteral(node, text) {
  if (ts.isStringLiteralLike(node) && node.text === text) return true;
  let found = false;
  ts.forEachChild(node, (child) => { found ||= containsExactLiteral(child, text); });
  return found;
}

/** @param {string} root */
async function sampleCopies(root) {
  /** @type {string[]} */
  const copies = [];
  /** @param {string} directory */
  async function walk(directory = "") {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) await walk(relativePath);
      else if (entry.name.endsWith(".json") && !entry.isDirectory()) {
        const text = await readFile(join(root, relativePath), "utf8");
        if (/"id"\s*:\s*"sample-studio-site"/.test(text) && JSON.parse(text)?.id === "sample-studio-site") copies.push(relativePath);
      }
    }
  }
  await walk();
  return copies.sort();
}

/** Check the source boundary and generated bytes without rewriting any file.
 * @param {string} [root] Alternate repository tree for isolated regression tests.
 */
export async function checkSampleProject(root = repositoryRoot) {
  root = resolve(root);
  for (const file of retiredCopies) assert.ok(!existsSync(join(root, file)), `Retired sample project copy must not exist: ${file}`);
  assert.deepEqual(await sampleCopies(root), [SAMPLE_PROJECT_PATH], `Sample Studio must have exactly one generated JSON source: ${SAMPLE_PROJECT_PATH}`);

  const projectPath = join(root, SAMPLE_PROJECT_PATH);
  for (const file of SAMPLE_PROJECT_MODULES) {
    const absolutePath = join(root, file);
    const tree = ts.createSourceFile(file, await readFile(absolutePath, "utf8"), ts.ScriptTarget.Latest, true);
    const imports = tree.statements.filter(ts.isImportDeclaration)
      .filter((statement) => statement.importClause && !statement.importClause.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier));
    if (file === "src/test/site-project-fixture.ts") {
      const bundled = imports.filter((statement) => statement.importClause?.name
        && resolve(dirname(absolutePath), /** @type {import("typescript").StringLiteral} */ (statement.moduleSpecifier).text) === projectPath);
      assert.equal(bundled.length, 1, `${file} must statically import the generated sample JSON as a bundled module`);
    } else {
      // An editor must never acquire a fixed host project via an ordinary
      // import (including a dynamic import or re-export added alongside the
      // correct virtual import). File reads in the build config are host-bound.
      /** @param {import("typescript").Node} node */
      function checkEditorImport(node) {
        const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
          : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") ? node.arguments[0] : undefined;
        if (specifier && ts.isStringLiteralLike(specifier)) assert.ok(!/(?:^|\/)site-project\.json(?:[?#].*)?$/.test(specifier.text), `${file} must receive the selected host project through virtual:demo-editor-project, not import a fixed project JSON`);
        ts.forEachChild(node, checkEditorImport);
      }
      checkEditorImport(tree);
      if (file === "src/hosted-demo/bootstrap.ts") {
        const bundled = imports.filter((statement) => /** @type {import("typescript").StringLiteral} */ (statement.moduleSpecifier).text === "virtual:demo-editor-project"
          && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
          && statement.importClause.namedBindings.elements.some((element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === "project"));
        assert.equal(bundled.length, 1, `${file} must statically import the selected host project as a bundled module from virtual:demo-editor-project`);
      }
    }
  }

  // Any consumer of the sample project/fixture must be the bundled base
  // loader, the Assets-lock helper, a known lock-aware consumer, or an
  // audited non-compiling loader — derived mechanically, so a new unguarded
  // consumer fails here instead of relying on someone to remember this list.
  const consumers = await sampleProjectConsumers(root);
  const unguarded = consumers.filter((file) => !SAMPLE_PROJECT_CONSUMERS.includes(file));
  assert.deepEqual(unguarded, [], `Unguarded consumer(s) of the sample project/fixture must supply an Assets lock (through ${SAMPLE_PROJECT_ASSET_LOCK_HELPER}) or be added to the audited allowlist in scripts/check-sample-project.mjs: ${unguarded.join(", ")}`);

  // Every in-process release-policy compile site must actually carry the
  // captured lock through the helper, not just be named in the allowlist.
  // Isolated regression fixtures only copy a reduced tree (SAMPLE_PROJECT_MODULES
  // plus packages/demo-sample); skip files this `root` does not contain.
  const helperTarget = stripModuleExtension(join(root, SAMPLE_PROJECT_ASSET_LOCK_HELPER));
  for (const file of LOCK_AWARE_VIA_HELPER) {
    const absolutePath = join(root, file);
    if (!existsSync(absolutePath)) continue;
    const tree = ts.createSourceFile(file, await readFile(absolutePath, "utf8"), ts.ScriptTarget.Latest, true);
    let bundled = false;
    /** @param {import("typescript").Node} node */
    function checkHelperImport(node) {
      if (bundled) return;
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier : undefined;
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".") && stripModuleExtension(resolve(dirname(absolutePath), specifier.text)) === helperTarget) bundled = true;
      else ts.forEachChild(node, checkHelperImport);
    }
    checkHelperImport(tree);
    assert.ok(bundled, `${file} must statically import the Assets-lock helper ${SAMPLE_PROJECT_ASSET_LOCK_HELPER}`);
  }

  // Use the installed producer's read-only mode, so validation, evaluation and
  // canonical serialization have one owner. No hand-maintained digest or copy.
  await execFile(process.execPath, [join(repositoryRoot, "bin/zudo-composer.mjs"), "generate", "--check"], {
    cwd: dirname(projectPath), encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await checkSampleProject();
    console.log("Sample project check passed: one generated source, bundled fixture, host-selected editor project, and current generated bytes.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
