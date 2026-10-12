// @ts-check
// `keyof typeof import(...)` cannot see type-only exports. Compare the compiler's
// module symbols with a reviewed list, for both source and generated declarations.
//
// `zudo-composer/site-project` is record-only: every export must be a type.
// The portable entries carry values too; their pin separates the value and
// type names so a new runtime export is a deliberate review, not drift.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const consumer = resolve(root, "type-tests/site-project.ts");

/** @param {string} configFile */
function compilerOptions(configFile) {
  const configPath = resolve(root, configFile);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined, `Cannot read ${configFile}`);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.deepEqual(parsed.errors, [], `Cannot parse ${configFile}`);
  return parsed.options;
}

/**
 * @param {string} subpath
 * @param {string} source
 * @param {string} declaration
 * @param {ts.CompilerOptions} options
 * @returns {{ entry: string, exported: { name: string, isType: boolean, isValue: boolean }[] }[]}
 */
function exportsOf(subpath, source, declaration, options) {
  const resolved = ts.resolveModuleName(`zudo-composer/${subpath}`, consumer, options, ts.sys).resolvedModule;
  assert.ok(resolved, `Cannot resolve zudo-composer/${subpath} from the consumer type test`);
  // TypeScript normalizes separators to '/', including on Windows.
  assert.equal(resolve(resolved.resolvedFileName), resolve(root, declaration), `zudo-composer/${subpath} must resolve through the package exports map to ${declaration}`);
  const entries = [resolve(root, source), resolve(root, declaration)];
  const program = ts.createProgram(entries, options);
  const checker = program.getTypeChecker();
  return entries.map((entry) => {
    const file = program.getSourceFile(entry);
    assert.ok(file, `Missing public entry: ${entry}`);
    const module = checker.getSymbolAtLocation(file);
    assert.ok(module, `Public entry is not a module: ${entry}`);
    return {
      entry,
      exported: checker.getExportsOfModule(module).map((symbol) => {
        const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        return { name: symbol.name, isType: (target.flags & ts.SymbolFlags.Type) !== 0, isValue: (target.flags & ts.SymbolFlags.Value) !== 0 };
      }),
    };
  });
}

/** @type {string[]} */
const siteProjectExpected = JSON.parse(await readFile(resolve(root, "type-tests/site-project-exports.json"), "utf8"));
assert.deepEqual(siteProjectExpected, [...new Set(siteProjectExpected)].sort(), "Public type expectations must be sorted and unique");
const nodeOptions = compilerOptions("tsconfig.public-entries.json");
for (const { entry, exported } of exportsOf("site-project", "server/public/site-project.mts", "server/site-project.d.mts", nodeOptions)) {
  assert.deepEqual(exported.map(({ name }) => name).sort(), siteProjectExpected,
    `${entry}: public types changed; review server/public/site-project.mts and deliberately update type-tests/site-project-exports.json`);
  for (const symbol of exported) {
    assert.ok(symbol.isType, `${entry}: ${symbol.name} is not a type`);
    assert.ok(!symbol.isValue, `${entry}: ${symbol.name} exposes a value-bearing declaration from a record-only entry`);
  }
}
console.log(`Public SiteProject type surface pinned: ${siteProjectExpected.length} named types; source and generated declarations agree.`);

/** @type {Record<string, { values: string[], types: string[] }>} */
const portableExpected = JSON.parse(await readFile(resolve(root, "type-tests/public-entry-exports.json"), "utf8"));
const portableOptions = compilerOptions("tsconfig.public-portable.json");
let pinned = 0;
for (const [subpath, expected] of Object.entries(portableExpected)) {
  for (const key of /** @type {const} */ (["values", "types"])) {
    assert.deepEqual(expected[key], [...new Set(expected[key])].sort(), `type-tests/public-entry-exports.json ${subpath}.${key} must be sorted and unique`);
  }
  assert.deepEqual(expected.values.filter((name) => expected.types.includes(name)), [], `${subpath}: a name cannot be pinned as both value and type`);
  for (const { entry, exported } of exportsOf(subpath, `server/public/${subpath}.mts`, `server/${subpath}.d.mts`, portableOptions)) {
    const values = exported.filter((symbol) => symbol.isValue).map(({ name }) => name).sort();
    const types = exported.filter((symbol) => !symbol.isValue).map(({ name }) => name).sort();
    assert.deepEqual(values, expected.values, `${entry}: public values changed; review server/public/${subpath}.mts and deliberately update type-tests/public-entry-exports.json`);
    assert.deepEqual(types, expected.types, `${entry}: public types changed; review server/public/${subpath}.mts and deliberately update type-tests/public-entry-exports.json`);
    for (const symbol of exported) assert.ok(symbol.isType || symbol.isValue, `${entry}: ${symbol.name} is neither a type nor a value`);
  }
  pinned += expected.values.length + expected.types.length;
}
console.log(`Portable public surfaces pinned: ${Object.keys(portableExpected).length} entries, ${pinned} names; source and generated declarations agree.`);
