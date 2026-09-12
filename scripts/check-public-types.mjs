// @ts-check
// `keyof typeof import(...)` cannot see type-only exports. Compare the compiler's
// module symbols with a reviewed list, for both source and generated declarations.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
/** @type {string[]} */
const expected = JSON.parse(await readFile(resolve(root, "type-tests/site-project-exports.json"), "utf8"));
assert.deepEqual(expected, [...new Set(expected)].sort(), "Public type expectations must be sorted and unique");
const configPath = resolve(root, "tsconfig.public-entries.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined, "Cannot read public entry TypeScript configuration");
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
assert.deepEqual(parsed.errors, [], "Cannot parse public entry TypeScript configuration");
const consumer = resolve(root, "type-tests/site-project.ts");
const resolved = ts.resolveModuleName("zudo-composer/site-project", consumer, parsed.options, ts.sys).resolvedModule;
assert.ok(resolved, "Cannot resolve zudo-composer/site-project from the consumer type test");
// TypeScript normalizes separators to '/', including on Windows.
const declaration = resolve(resolved.resolvedFileName);
assert.equal(declaration, resolve(root, "server/site-project.d.mts"), "Bare public types must resolve through the package exports map");
const entries = [resolve(root, "server/public/site-project.mts"), declaration];
const program = ts.createProgram(entries, parsed.options);
const checker = program.getTypeChecker();
for (const entry of entries) {
  const source = program.getSourceFile(entry);
  assert.ok(source, `Missing public entry: ${entry}`);
  const module = checker.getSymbolAtLocation(source);
  assert.ok(module, `Public entry is not a module: ${entry}`);
  const exported = checker.getExportsOfModule(module);
  assert.deepEqual(exported.map((symbol) => symbol.name).sort(), expected,
    `${entry}: public types changed; review server/public/site-project.mts and deliberately update type-tests/site-project-exports.json`);
  for (const symbol of exported) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    assert.ok(target.flags & ts.SymbolFlags.Type, `${entry}: ${symbol.name} is not a type`);
    assert.equal(target.flags & ts.SymbolFlags.Value, 0, `${entry}: ${symbol.name} exposes a value-bearing declaration from a record-only entry`);
  }
}
console.log(`Public SiteProject type surface pinned: ${expected.length} named types; source and generated declarations agree.`);
