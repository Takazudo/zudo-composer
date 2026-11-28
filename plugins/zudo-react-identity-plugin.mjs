// @ts-check
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { ZUDO_REACT_PACKAGE } from "./module-resolution.mjs";

/**
 * Where one resolved runtime module lives: Vite's optimized-deps directory, or
 * the realpath of the `@takazudo/zfb` package root that owns the file.
 * @param {string} id
 * @param {string} [cacheDir] The resolved Vite `cacheDir`, when it is not the default `.vite`.
 */
export function zudoReactRuntimeOrigin(id, cacheDir) {
  const file = id.replace(/[?#].*$/, "");
  if ((cacheDir && file.startsWith(`${cacheDir}/`)) || /[\\/]\.vite[\\/]deps(?:_temp_[^\\/]+)?[\\/]/.test(file)) return `optimized:${dirname(file)}`;
  let directory = dirname(realpathSync(file));
  for (;;) {
    try {
      if (JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name === ZUDO_REACT_PACKAGE) return `package:${directory}`;
    } catch {
      // Not a package root (or a nested `{"type":"module"}` marker without a name); keep walking.
    }
    const parent = dirname(directory);
    if (parent === directory) return `file:${file}`;
    directory = parent;
  }
}

/**
 * Dev/build guard: every `@takazudo/zfb/zudo-react*` import must resolve to one
 * origin. A second package copy, or a partial prebundle mixing optimized and raw
 * runtime files, gives a pack its own scheduler — signals then bind without a
 * diagnostic and never update — so the first mismatch fails the resolve.
 * @returns {import("vite").Plugin}
 */
export default function zudoReactIdentityPlugin() {
  /** @type {Map<string, {origin: string, id: string}>} */
  let first = new Map();
  /** @type {string | undefined} */
  let cacheDir;
  return {
    name: "zudo-react-runtime-identity",
    enforce: "pre",
    configResolved(config) {
      cacheDir = config.cacheDir;
    },
    buildStart() {
      first = new Map();
    },
    async resolveId(source, importer, options) {
      if (source !== `${ZUDO_REACT_PACKAGE}/zudo-react` && !source.startsWith(`${ZUDO_REACT_PACKAGE}/zudo-react/`)) return null;
      // The dependency scanner resolves through this container with `scan: true`
      // to find raw package files to prebundle; those ids are never served.
      if (/** @type {{scan?: boolean}} */ (options).scan) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const environment = this.environment?.name ?? "default";
      const origin = zudoReactRuntimeOrigin(resolved.id, cacheDir);
      const seen = first.get(environment);
      if (!seen) first.set(environment, { origin, id: resolved.id });
      else if (seen.origin !== origin) {
        throw new Error(`Two zudo-react runtimes in one graph: "${source}" from ${importer ?? "an entry"} resolved to ${resolved.id} (${origin}), but ${seen.id} came from ${seen.origin}. Prebundle every zudo-react entry or none, and install exactly one ${ZUDO_REACT_PACKAGE}.`);
      }
      return resolved;
    },
  };
}
