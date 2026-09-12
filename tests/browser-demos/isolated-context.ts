import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export const DEMOS_LANE_NAMES = ["webshop", "landing", "blog"] as const;
export type DemosLaneName = (typeof DEMOS_LANE_NAMES)[number];

export interface DemosLaneContext {
  name: DemosLaneName;
  assetsStoreRoot: string;
  routes: readonly string[];
}

/**
 * Fail before Playwright or the dev server starts unless the canonical runner
 * (`scripts/run-demos-browser.mjs`) supplied one demo name, its computed
 * route list and a disposable Assets store copy. The runner also confines the
 * committed CMS domains and workspace registry before this guard is reached;
 * keeping the Assets root explicit here lets the Playwright config reject a
 * direct launch without reproducing the runner's host-relative settings.
 */
export function requireDemosLaneContext(environment: NodeJS.ProcessEnv): DemosLaneContext {
  const fail = (): never => {
    throw new Error("Use test:browser:demos: an explicit demo name, route list and disposable Assets store root are required.");
  };
  const name = environment.DEMOS_LANE_NAME;
  if (!name || !(DEMOS_LANE_NAMES as readonly string[]).includes(name)) return fail();
  const assetsStoreRoot = environment.ZUDO_ASSETS_STORE_ROOT;
  if (!assetsStoreRoot || !isAbsolute(assetsStoreRoot) || resolve(assetsStoreRoot) !== assetsStoreRoot || realpathSync(assetsStoreRoot) !== assetsStoreRoot) return fail();
  const parent = dirname(assetsStoreRoot);
  if (basename(assetsStoreRoot) !== "assets" || dirname(parent) !== realpathSync(tmpdir())
    || !basename(parent).startsWith("zudo-composer-demos-browser-")) return fail();
  let routes: unknown;
  try { routes = JSON.parse(environment.DEMOS_LANE_ROUTES ?? ""); }
  catch { return fail(); }
  if (!Array.isArray(routes) || routes.length === 0 || routes.some((route) => typeof route !== "string")) return fail();
  return { name: name as DemosLaneName, assetsStoreRoot, routes: routes as string[] };
}
