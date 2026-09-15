// @ts-check
// `optimizeDeps.include` for the tool's own dev/build Vite configs (#703).
//
// Vite's startup scanner only sees what the entry module statically imports.
// Two sets of dependencies are invisible to it and are instead discovered
// while the app actually runs — and each runtime discovery triggers Vite's
// "new dependencies found" re-optimization, which forces a full page reload:
//   - `@preact/preset-vite` injects `preact/debug` and `preact/devtools` into
//     the dev bundle, and compiled JSX imports `preact/jsx-runtime`; none of
//     these is a static import the scanner can follow.
//   - The configured component pack is excluded from the scanner (it is
//     linked workspace source rather than an installed `node_modules`
//     package, for this repo's own owned pack), so a bare-package dependency
//     the pack imports internally — for example `dompurify` — is only
//     discovered once the pack itself runs.
// Declaring both sets here bundles them at startup instead, so a cold dev
// server (as in CI) doesn't pay for a runtime reload.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveComponentPack } from "./component-pack.mjs";
import { APP_ROOT } from "./roots.mjs";

/** Dev-only entries `@preact/preset-vite` and compiled JSX pull in without a static import the scanner can see. */
export const PREACT_DEV_ENTRIES = Object.freeze(["preact/debug", "preact/devtools", "preact/jsx-runtime"]);

/**
 * The tool's own package and everything it declares as a dependency or peer.
 * A pack that is the host itself (a generated host's `<name>/components`)
 * lists the tool, the contract and preact as runtime dependencies; nesting
 * those would pre-bundle the whole tool, server code included, for the
 * browser, and they already reach the dev graph through the tool's own entry.
 * @returns {Set<string>}
 */
function toolProvidedPackages() {
  /** @type {{name: string, dependencies?: Record<string, string>, peerDependencies?: Record<string, string>}} */
  const tool = JSON.parse(readFileSync(resolve(APP_ROOT, "package.json"), "utf8"));
  return new Set([tool.name, ...Object.keys(tool.dependencies ?? {}), ...Object.keys(tool.peerDependencies ?? {})]);
}

/**
 * The nested `optimizeDeps.include` form (`"packageName > dep"`) for every
 * runtime dependency the resolved component pack declares, minus what the tool
 * itself provides and whatever the caller already excludes (for example `@takazudo/zfb-md-wasm`, whose
 * glue/wasm must stay unbundled). Returns an empty list when the pack, or its
 * `package.json`, can't be resolved — for example a consumer host outside
 * this repository whose pack isn't installed yet.
 * @param {{workspaceRoot: string, pack: string, exclude?: readonly string[]}} options
 */
export function componentPackNestedIncludes({ workspaceRoot, pack, exclude = [] }) {
  /** @type {import("./component-pack.d.mts").ResolvedComponentPack} */
  let identity;
  try {
    identity = resolveComponentPack(workspaceRoot, pack);
  } catch {
    return [];
  }
  /** @type {Record<string, string>} */
  let dependencies;
  try {
    dependencies = JSON.parse(readFileSync(resolve(identity.packageRoot, "package.json"), "utf8")).dependencies ?? {};
  } catch {
    return [];
  }
  const excluded = new Set([...toolProvidedPackages(), ...exclude]);
  return Object.keys(dependencies)
    .filter((dependency) => !excluded.has(dependency))
    .map((dependency) => `${identity.packageName} > ${dependency}`);
}

/**
 * The full `optimizeDeps.include` list for one of the tool's own Vite
 * configs: the preact dev-only entries plus the pack's nested runtime
 * dependencies.
 * @param {{workspaceRoot: string, pack: string, exclude?: readonly string[]}} options
 */
export function devPrebundleIncludes(options) {
  return [...PREACT_DEV_ENTRIES, ...componentPackNestedIncludes(options)];
}
