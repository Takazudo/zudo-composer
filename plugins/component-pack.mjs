// @ts-check
// Component-pack resolution.
//
// A pack is always addressed as a PACKAGE, never as a path. Two shapes are
// admitted, and both satisfy the contract's public-import rule
// (`parseSource` in `@zudo-composer/component-contract` rejects anything that
// is not a bare-package import and rejects any `src` path segment):
//
//   themeset package   `pack: "@acme/themeset/composer-pack"`, every
//                      `source.module` a public export of that package.
//   host self-reference `pack: "my-site/components"`, backed by the host
//                      package's own `name` + `exports`. Node resolves package
//                      self-references whenever `exports` is present, and
//                      Vite's resolver has the same branch.
//
// Resolution always happens from `<workspaceRoot>/package.json`, because that
// is the importer every generated composition module will have: generated JSX
// lives under the host's `compositionsDir`, never inside this package.
//
// This module deliberately imports nothing from Vite so the CLI can use it.

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

/**
 * The package name a specifier addresses: `@scope/name` or `name`, without the
 * export subpath.
 * @param {string} specifier
 */
export function packageNameOf(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

/**
 * The directory of the nearest `package.json` at or above `filePath`. For a
 * host self-reference that is the host root itself.
 * @param {string} filePath
 */
export function packageRootAbove(filePath) {
  let directory = dirname(resolve(filePath));
  for (;;) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`No package.json above ${filePath}.`);
    directory = parent;
  }
}

/**
 * @param {string} workspaceRoot
 * @returns {NodeJS.Require}
 */
function hostRequire(workspaceRoot) {
  return createRequire(join(resolve(workspaceRoot), "package.json"));
}

/**
 * @typedef {object} ResolvedComponentPack
 * @property {string} specifier The config `pack` value, verbatim.
 * @property {string} packageName Scope + name, without the export subpath.
 * @property {string} packageRoot Directory of the resolved package.
 * @property {string} entryPath Absolute path of the pack module.
 */

/**
 * Resolve the configured pack from the host root. Never falls back to a
 * bundled provider pack — a host that cannot resolve its pack has no pack.
 * @param {string} workspaceRoot
 * @param {string} specifier
 * @returns {ResolvedComponentPack}
 */
export function resolveComponentPack(workspaceRoot, specifier) {
  const root = resolve(workspaceRoot);
  let entryPath;
  try {
    entryPath = hostRequire(root).resolve(specifier);
  } catch (error) {
    throw new Error(
      `Component pack "${specifier}" could not be resolved from ${join(root, "package.json")}: ${error instanceof Error ? error.message : String(error)}. Install it as a dependency of the host, or expose it through the host package's own "name" + "exports".`,
      { cause: error },
    );
  }
  return { specifier, packageName: packageNameOf(specifier), packageRoot: packageRootAbove(entryPath), entryPath };
}

/**
 * Every `source.module` a pack declares must resolve from the host root: the
 * generated composition modules import exactly those specifiers, and they are
 * written into the host tree. A pack that loads but whose sources do not
 * resolve produces compositions that cannot be built, so it is refused here.
 * @param {string} workspaceRoot
 * @param {{packId?: string, components?: readonly {id: string, source?: {module?: string}}[]}} manifest
 * @param {string} specifier
 */
export function assertPackSourcesResolvable(workspaceRoot, manifest, specifier) {
  const root = resolve(workspaceRoot);
  const require = hostRequire(root);
  const seen = new Set();
  for (const component of manifest.components ?? []) {
    const module = component.source?.module;
    if (module === undefined || seen.has(module)) continue;
    seen.add(module);
    try {
      require.resolve(module);
    } catch {
      throw new Error(
        `Component "${component.id}" in pack "${specifier}" declares source.module "${module}", which does not resolve from ${root}. A pack's source.module must be a public export of an installed package or of the host package's own "exports"; every generated composition module imports it.`,
      );
    }
  }
}

/**
 * Load the pack module and validate its sources. The evaluator is injected
 * because the two callers reach a TypeScript entry differently — the dev
 * server through Vite's SSR graph, the CLI through `tsx`.
 * @param {string} workspaceRoot
 * @param {string} specifier
 * @param {(entryPath: string) => Promise<Record<string, unknown>>} evaluate
 */
export async function loadComponentPack(workspaceRoot, specifier, evaluate) {
  const identity = resolveComponentPack(workspaceRoot, specifier);
  const module = await evaluate(identity.entryPath);
  const pack = /** @type {any} */ (module.componentPack);
  if (!pack || typeof pack !== "object" || !pack.manifest) {
    throw new Error(`Component pack "${specifier}" (${identity.entryPath}) must export \`componentPack\` built with \`defineComponentPack\`.`);
  }
  assertPackSourcesResolvable(workspaceRoot, pack.manifest, specifier);
  return { identity, pack };
}
