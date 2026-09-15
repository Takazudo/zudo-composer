// @ts-check

// The UI pack IDENTITY boundary: the owned package's manifest, its in-repo
// `workspace:*` resolution, the absence of any retired provider pin, and the
// parity between the pack's generated component list and its sidecars. None of
// it needs a build, so it runs on a bare checkout — the built-artifact
// assertions live in `check-dist-artifact.mjs`.

import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { UI_PACK } from "./ui-pack-identity.mjs";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sourcePackage = JSON.parse(readFileSync(join(root, UI_PACK.sourcePath, "package.json"), "utf8"));
const installedRoot = join(root, "node_modules", UI_PACK.packageName);
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const packSource = readFileSync(join(installedRoot, "src/composer-pack.ts"), "utf8");

/** @param {string} source @param {string} heading @param {string} [nextHeading] @returns {string} */
function section(source, heading, nextHeading) {
  const start = source.indexOf(`${heading}:\n`);
  assert.notEqual(start, -1, `missing lockfile section: ${heading}`);
  const end = nextHeading ? source.indexOf(`\n${nextHeading}:\n`, start) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
}

/** @param {string} source @param {string} key @param {number} indent @returns {string} */
function indentedBlock(source, key, indent) {
  const prefix = `${" ".repeat(indent)}${key}:\n`;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `missing lockfile block: ${key}`);
  const tail = source.slice(start + prefix.length);
  const next = tail.search(new RegExp(`^ {${indent}}\\S.*:\\n`, "m"));
  return source.slice(start, next < 0 ? source.length : start + prefix.length + next);
}

assert.equal(packageJson.devDependencies[UI_PACK.packageName], UI_PACK.workspaceSpec, "the owned pack must be a workspace:* development dependency");
assert.equal(packageJson.dependencies[UI_PACK.packageName], undefined, "the owned pack must not be a runtime dependency");
assert.equal(packageJson.peerDependencies[UI_PACK.packageName], undefined, "the owned pack must not be a peer dependency");
assert.equal(sourcePackage.name, UI_PACK.packageName, "packages/ui must publish the owned pack name");
assert.equal(sourcePackage.version, UI_PACK.installedVersion, "owned pack metadata version drifted");
assert.equal(realpathSync(installedRoot), realpathSync(join(root, UI_PACK.sourcePath)), "the installed pack must be the workspace package itself");

const importers = section(lock, "importers", "packages");
const rootImporter = indentedBlock(importers, ".", 2);
const importer = indentedBlock(rootImporter, `'${UI_PACK.packageName}'`, 6);
assert.ok(importer.includes(`specifier: ${UI_PACK.workspaceSpec}`), "root importer must declare the workspace spec");
assert.ok(importer.includes(`version: link:${UI_PACK.sourcePath}`), "root importer must link the workspace package");
assert.doesNotMatch(lock, /zudo-sg/, "the lockfile must not retain the retired zudo-sg provider");
assert.doesNotMatch(section(lock, "packages", "snapshots"), new RegExp(`^  '${UI_PACK.packageName}@`, "m"), "the owned pack must never resolve from a registry or Git tarball in this repository");

assert.match(packSource, new RegExp(`packId:\\s*["']${UI_PACK.packId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
const packVersion = packSource.match(/\bpackVersion:\s*["']([^"']+)["']/)?.[1];
assert.equal(packVersion, UI_PACK.packVersion, "pack protocol version drifted");

const sidecarImports = [...packSource.matchAll(
  /import\s+\{\s*\w+\s+as\s+(\w+)\s*\}\s+from\s+["'](\.\/[^"']+\.composer)["']/g,
)].map((match) => ({
  localName: match[1],
  path: join(installedRoot, "src", `${match[2]}.tsx`),
}));
assert.ok(sidecarImports.length > 0, "the pack must import at least one component sidecar");
const componentList = packSource.match(/\bcomponents:\s*\[([\s\S]*?)\]\s*,\s*\}\);/)?.[1];
assert.ok(componentList, "the pack must declare its generated component list");
const componentNames = componentList.split(",").map((name) => name.trim()).filter(Boolean);
assert.deepEqual(
  componentNames,
  sidecarImports.map(({ localName }) => localName),
  "every generated sidecar import must have one matching runtime entry in stable order",
);
assert.equal(new Set(componentNames).size, componentNames.length, "pack runtime entries must be unique");

const identities = sidecarImports.map(({ path }) => {
  const source = readFileSync(path, "utf8");
  const id = source.match(/\bid:\s*["']([^"']+)["']/)?.[1];
  const schemaVersion = Number(source.match(/\bschemaVersion:\s*(\d+)/)?.[1]);
  const sourceModule = source.match(/\bsource:\s*\{[\s\S]*?\bmodule:\s*["']([^"']+)["']/)?.[1];
  assert.ok(id, `${path} must declare a component id`);
  assert.ok(Number.isInteger(schemaVersion) && schemaVersion > 0, `${id} must declare a positive schema version`);
  assert.ok(sourceModule, `${id} must declare a public source module`);
  assert.equal(sourceModule, UI_PACK.sourceModule, `${id} source.module must identify the owned pack package`);
  assert.doesNotMatch(sourceModule, /(?:^|\/)src(?:\/|$)/, `${id} source.module must not expose a private /src/ import`);
  return { id, schemaVersion };
});
const componentIds = identities.map(({ id }) => id);
assert.equal(new Set(componentIds).size, componentIds.length, "pack component ids must be unique");
console.log(`Provider boundary passed: ${componentIds.length} components from ${UI_PACK.packageName} pack ${packVersion}.`);
