// The provider IDENTITY boundary: the manifest spec, the lockfile resolution,
// and the parity between the installed pack's generated component list and its
// sidecars. None of it needs a build, so it runs on a bare checkout — the
// built-artifact assertions live in `check-dist-artifact.mjs`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const providerPackage = JSON.parse(readFileSync(join(root, "node_modules/@zudo-sg/ui/package.json"), "utf8"));
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const packSource = readFileSync(join(root, "node_modules/@zudo-sg/ui/src/composer-pack.ts"), "utf8");

const providerSha = "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf";
const providerSpec = `git+https://github.com/Takazudo/zudo-sg.git#${providerSha}`;

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function section(source, heading, nextHeading) {
  const start = source.indexOf(`${heading}:\n`);
  assert.notEqual(start, -1, `missing lockfile section: ${heading}`);
  const end = nextHeading ? source.indexOf(`\n${nextHeading}:\n`, start) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
}

function indentedBlock(source, key, indent) {
  const prefix = `${" ".repeat(indent)}${key}:\n`;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `missing lockfile block: ${key}`);
  const tail = source.slice(start + prefix.length);
  const next = tail.search(new RegExp(`^ {${indent}}\\S.*:\\n`, "m"));
  return source.slice(start, next < 0 ? source.length : start + prefix.length + next);
}

assert.equal(packageJson.dependencies["@zudo-sg/ui"], providerSpec, "provider dependency must use the exact Git SHA");
const tarball = `https://codeload.github.com/Takazudo/zudo-sg/tar.gz/${providerSha}`;
const rootImporter = indentedBlock(section(lock, "importers", "packages"), ".", 2);
const importer = indentedBlock(rootImporter, "'@zudo-sg/ui'", 6);
const packageBlock = indentedBlock(section(lock, "packages", "snapshots"), `'@zudo-sg/ui@${tarball}'`, 2);
const snapshotSection = section(lock, "snapshots");
const escapedTarball = tarball.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const snapshotKey = snapshotSection.match(new RegExp(`^  ('@zudo-sg/ui@${escapedTarball}[^']*'):\\n`, "m"))?.[1];
assert.ok(snapshotKey, "missing exact provider snapshot");
const snapshot = indentedBlock(snapshotSection, snapshotKey, 2);
assert.ok(importer.includes(`specifier: ${providerSpec}`), "importer spec must retain exact provider Git SHA");
assert.ok(importer.includes(`version: ${tarball}(@zudo-composer/component-contract@packages+component-contract)(preact@10.29.8)(tailwindcss@4.3.3)`), "importer resolution drifted");
// pnpm records an `integrity:` field between `gitHosted:` and `tarball:` when it
// re-resolves a Git dependency, so assert the two load-bearing parts separately.
assert.match(packageBlock, /resolution: \{gitHosted: true,/, "provider must resolve as a git-hosted tarball");
assert.ok(packageBlock.includes(`tarball: ${tarball}}`), "provider codeload package resolution drifted");
assert.ok(packageBlock.includes("version: 0.1.0"), "provider lock metadata version drifted");
assert.ok(snapshot.includes("'@zudo-composer/component-contract': link:packages/component-contract"), "provider must use the intentional local contract peer");
assert.equal(count(snapshot, "link:packages/component-contract"), 1, "only the intentional component-contract peer may link locally");
for (const block of [importer, packageBlock, snapshot]) {
  assert.doesNotMatch(block, /(?:workspace|file|path|sibling):|\.\.\/|packages\/ui|\/Users\/|[A-Za-z]:\\\\/, "provider provenance must not use a local/sibling resolution");
}
assert.equal(providerPackage.version, "0.1.0", "installed package metadata version drifted");
assert.match(packSource, /packId:\s*["']@zudo-sg\/ui["']/);
const packVersion = packSource.match(/\bpackVersion:\s*["']([^"']+)["']/)?.[1];
assert.ok(packVersion, "provider pack must declare a non-empty pack version");

const sidecarImports = [...packSource.matchAll(
  /import\s+\{\s*\w+\s+as\s+(\w+)\s*\}\s+from\s+["'](\.\/[^"']+\.composer)["']/g,
)].map((match) => ({
  localName: match[1],
  path: join(root, "node_modules/@zudo-sg/ui/src", `${match[2]}.tsx`),
}));
assert.ok(sidecarImports.length > 0, "provider pack must import at least one component sidecar");
const componentList = packSource.match(/\bcomponents:\s*\[([\s\S]*?)\]\s*,\s*\}\);/)?.[1];
assert.ok(componentList, "provider pack must declare its generated component list");
const componentNames = componentList.split(",").map((name) => name.trim()).filter(Boolean);
assert.deepEqual(
  componentNames,
  sidecarImports.map(({ localName }) => localName),
  "every generated sidecar import must have one matching runtime entry in stable order",
);
assert.equal(new Set(componentNames).size, componentNames.length, "provider runtime entries must be unique");

const identities = sidecarImports.map(({ path }) => {
  const source = readFileSync(path, "utf8");
  const id = source.match(/\bid:\s*["']([^"']+)["']/)?.[1];
  const schemaVersion = Number(source.match(/\bschemaVersion:\s*(\d+)/)?.[1]);
  const sourceModule = source.match(/\bsource:\s*\{[\s\S]*?\bmodule:\s*["']([^"']+)["']/)?.[1];
  assert.ok(id, `${path} must declare a component id`);
  assert.ok(Number.isInteger(schemaVersion) && schemaVersion > 0, `${id} must declare a positive schema version`);
  assert.ok(sourceModule, `${id} must declare a public source module`);
  assert.equal(sourceModule, "@zudo-sg/ui", `${id} source.module must identify the installed provider package`);
  assert.doesNotMatch(sourceModule, /(?:^|\/)src(?:\/|$)/, `${id} source.module must not expose a private /src/ import`);
  return { id, schemaVersion };
});
const componentIds = identities.map(({ id }) => id);
assert.equal(new Set(componentIds).size, componentIds.length, "provider component ids must be unique");
console.log(`Provider boundary passed: ${componentIds.length} components from pack ${packVersion}.`);
