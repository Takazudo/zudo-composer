// @ts-check
// Keep the standalone sample styleguide on the exact package revisions handed
// off by the root build. A branch name, floating version or accidental local
// link would make its hosted artifact differ from the component contract that
// the rest of this repository validates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PINNED_PACKAGES = [
  { name: "@zudo-composer/ui", handoff: "ui-handoff.json", sourcePath: "packages/ui" },
  { name: "@zudo-composer/component-contract", handoff: "contract-handoff.json", sourcePath: "packages/component-contract" },
];

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
 * Verify the two standalone-host dependency specs against root handoffs.
 *
 * @param {{ root?: string }} [options]
 * @returns {{ pins: string[], fallbacks: string[] }}
 */
export function checkStyleguidePins({ root = resolve(import.meta.dirname, "..") } = {}) {
  const host = readJson(join(root, "styleguide/sample/package.json"));
  const dependencies = object(host.dependencies);
  const fallbacks = [];
  const pins = [];
  for (const entry of PINNED_PACKAGES) {
    const handoff = readJson(join(root, entry.handoff));
    const expected = handoff.rootGitSpec;
    assert.equal(typeof expected, "string", `${entry.handoff} must contain a rootGitSpec`);
    const actual = dependencies[entry.name];
    assert.equal(typeof actual, "string", `styleguide/sample/package.json must declare ${entry.name}`);
    if (actual === expected) {
      pins.push(`${entry.name}=${actual}`);
      continue;
    }
    const fallback = fallbackSpec(entry.sourcePath);
    if (actual === fallback) {
      const readme = readFileSync(join(root, "styleguide/sample/README.md"), "utf8");
      assert.ok(readme.includes(fallback) && /fallback/iu.test(readme), `${entry.name} uses ${fallback}, but the documented fallback is missing from styleguide/sample/README.md`);
      fallbacks.push(`${entry.name}=${actual}`);
      continue;
    }
    throw new Error(`${entry.name} pin mismatch: expected ${expected}, received ${actual}`);
  }
  return { pins, fallbacks };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw new Error("Usage: check-styleguide-pins.mjs");
  const result = checkStyleguidePins();
  const details = [...result.pins.map((pin) => `${pin} (rootGitSpec)`), ...result.fallbacks.map((pin) => `${pin} (documented fallback)`)];
  console.log(`Styleguide pin check passed: ${details.join(", ")}`);
}
