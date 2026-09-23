// @ts-check
// Keep every standalone styleguide on the exact component-contract revision
// handed off by the root build. Sample also catalogs the repository-owned UI
// pack; the three demo styleguides own their component packs and must not take
// a dependency on that Sample-only package.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PINNED_PACKAGES = [
  { name: "@zudo-composer/ui", handoff: "ui-handoff.json", sourcePath: "packages/ui" },
  { name: "@zudo-composer/component-contract", handoff: "contract-handoff.json", sourcePath: "packages/component-contract" },
];
const STYLEGUIDE_HOSTS = [
  { name: "sample", directory: "styleguide/sample", includesUi: true },
  { name: "shop", directory: "styleguide/shop", includesUi: false },
  { name: "landing", directory: "styleguide/landing", includesUi: false },
  { name: "blog", directory: "styleguide/blog", includesUi: false },
];
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {string} path @returns {Record<string, unknown>} */
function readJson(path) {
  return object(JSON.parse(readFileSync(path, "utf8")));
}

/** @param {string} value @returns {string} */
function fallbackSpec(value) {
  return `link:../../${value}`;
}

/**
 * Verify each standalone styleguide's applicable dependency specs against the root handoffs.
 *
 * @param {{ root?: string }} [options]
 * @returns {{ pins: string[], fallbacks: string[] }}
 */
export function checkStyleguidePins({ root = resolve(import.meta.dirname, "..") } = {}) {
  const fallbacks = [];
  const pins = [];
  for (const host of STYLEGUIDE_HOSTS) {
    const manifest = readJson(join(root, host.directory, "package.json"));
    const dependencies = object(manifest.dependencies);
    const uiSections = DEPENDENCY_FIELDS.filter((section) => Object.hasOwn(object(manifest[section]), "@zudo-composer/ui"));
    assert.equal(
      uiSections.length,
      host.includesUi ? 1 : 0,
      `${host.directory}/package.json ${host.includesUi ? "must declare @zudo-composer/ui once" : "must not declare @zudo-composer/ui"}`,
    );
    if (host.includesUi) assert.deepEqual(uiSections, ["dependencies"], `${host.directory}/package.json must declare @zudo-composer/ui as a dependency`);
    for (const section of DEPENDENCY_FIELDS.filter((field) => field !== "dependencies")) {
      assert.ok(
        !Object.hasOwn(object(manifest[section]), "@zudo-composer/component-contract"),
        `${host.directory}/package.json must declare @zudo-composer/component-contract only under dependencies`,
      );
    }
    for (const entry of PINNED_PACKAGES) {
      if (entry.name === "@zudo-composer/ui" && !host.includesUi) continue;
      const handoff = readJson(join(root, entry.handoff));
      const expected = handoff.rootGitSpec;
      assert.equal(typeof expected, "string", `${entry.handoff} must contain a rootGitSpec`);
      const actual = dependencies[entry.name];
      assert.equal(typeof actual, "string", `${host.directory}/package.json must declare ${entry.name}`);
      if (actual === expected) {
        pins.push(`${host.name === "sample" ? "" : `${host.name}:`}${entry.name}=${actual}`);
        continue;
      }
      const fallback = fallbackSpec(entry.sourcePath);
      if (host.includesUi && actual === fallback) {
        const readme = readFileSync(join(root, host.directory, "README.md"), "utf8");
        assert.ok(readme.includes(fallback) && /fallback/iu.test(readme), `${entry.name} uses ${fallback}, but the documented fallback is missing from ${host.directory}/README.md`);
        fallbacks.push(`${entry.name}=${actual}`);
        continue;
      }
      throw new Error(`${host.directory} ${entry.name} pin mismatch: expected ${expected}, received ${actual}`);
    }
  }
  return { pins, fallbacks };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw new Error("Usage: check-styleguide-pins.mjs");
  const result = checkStyleguidePins();
  const details = [...result.pins.map((pin) => `${pin} (rootGitSpec)`), ...result.fallbacks.map((pin) => `${pin} (documented fallback)`)];
  console.log(`Styleguide dependency check passed: ${details.join(", ")}`);
}
