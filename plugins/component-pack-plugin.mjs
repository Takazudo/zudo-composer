// @ts-check
// `virtual:zudo-composer-pack` — the single seam between the tool and whatever
// component pack the host configured.
//
// Both the browser graph (`src/features/composer/active-pack.ts`) and the SSR
// graph (`plugins/release-api-plugin.ts`, which validates server-side) load
// this id, so a host swaps its whole component set by editing one config value.
// The module re-exports the resolved entry through `/@fs`, because the pack is
// a package outside the host root and a root-absolute id would not find it.

import { fsModuleId } from "./roots.mjs";
import { assertPackSourcesResolvable, resolveComponentPack } from "./component-pack.mjs";

export const COMPONENT_PACK_ID = "virtual:zudo-composer-pack";
export const RESOLVED_COMPONENT_PACK_ID = `\0${COMPONENT_PACK_ID}`;

/**
 * @param {{workspaceRoot: string, pack: string}} options
 */
export function componentPackPlugin(options) {
  const identity = resolveComponentPack(options.workspaceRoot, options.pack);
  return {
    name: "zudo-component-pack",
    identity,
    config() {
      // The pack lives outside the host root, so Vite must be allowed to read
      // it. `optimizeDeps` leaves it in the normal module graph: a pack's
      // stylesheet and `?url` resource imports are asset-pipeline work, which
      // the dependency scanner cannot do.
      return {
        server: { fs: { allow: [identity.packageRoot] } },
        optimizeDeps: { exclude: [identity.packageName] },
      };
    },
    async configureServer(server) {
      const module = await server.ssrLoadModule(COMPONENT_PACK_ID);
      assertPackSourcesResolvable(options.workspaceRoot, module.componentPack.manifest, identity.specifier);
    },
    resolveId(id) {
      if (id === COMPONENT_PACK_ID) return RESOLVED_COMPONENT_PACK_ID;
    },
    load(id) {
      if (id === RESOLVED_COMPONENT_PACK_ID) return `export { componentPack } from ${JSON.stringify(fsModuleId(identity.entryPath))};`;
    },
  };
}

export default componentPackPlugin;
