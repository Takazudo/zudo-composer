import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DEMOS_LANE_DIRECTORY } from "../../scripts/demos-lane-paths.mjs";

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
 * route list and a disposable host-local CMS copy paired with its temporary
 * release. The runner validates every configured domain before seeding; this
 * guard independently rejects a direct launch against committed host state or
 * a copy belonging to another host or run.
 */
export function requireDemosLaneContext(environment: NodeJS.ProcessEnv): DemosLaneContext {
  const fail = (): never => {
    throw new Error("Use test:browser:demos: an explicit demo name, route list and disposable Assets store root are required.");
  };
  const name = environment.DEMOS_LANE_NAME;
  if (!name || !(DEMOS_LANE_NAMES as readonly string[]).includes(name)) return fail();
  const assetsStoreRoot = environment.ZUDO_ASSETS_STORE_ROOT;
  if (!assetsStoreRoot || !isAbsolute(assetsStoreRoot) || resolve(assetsStoreRoot) !== assetsStoreRoot || realpathSync(assetsStoreRoot) !== assetsStoreRoot) return fail();
  const cmsRoot = dirname(assetsStoreRoot);
  const runRoot = dirname(cmsRoot);
  const hostRoot = realpathSync(resolve(import.meta.dirname, "../../packages", `demo-${name}`));
  if (basename(assetsStoreRoot) !== "assets" || basename(cmsRoot) !== "cms"
    || dirname(runRoot) !== join(hostRoot, DEMOS_LANE_DIRECTORY)
    || !basename(runRoot).startsWith("zudo-composer-demos-browser-")) return fail();
  const releaseRoot = environment.ZUDO_SITE_PROJECT_ROOT;
  if (!releaseRoot || !isAbsolute(releaseRoot) || resolve(releaseRoot) !== releaseRoot
    || realpathSync(releaseRoot) !== releaseRoot || basename(releaseRoot) !== "release"
    || dirname(dirname(releaseRoot)) !== realpathSync(tmpdir())
    || basename(dirname(releaseRoot)) !== basename(runRoot)) return fail();
  if (environment.ZUDO_DATA_ROOT !== cmsRoot
    || environment.ZUDO_COMPOSITIONS_ROOT !== join(cmsRoot, "compositions")
    || realpathSync(environment.ZUDO_COMPOSITIONS_ROOT) !== environment.ZUDO_COMPOSITIONS_ROOT) return fail();
  const composerRoots = {
    ZUDO_COMPOSER_DATA_DIR: cmsRoot,
    ZUDO_COMPOSER_COMPOSITIONS_DIR: join(cmsRoot, "compositions"),
    ZUDO_COMPOSER_CONTENT_DIR: join(cmsRoot, "content"),
    ZUDO_COMPOSER_MAPPINGS_DIR: join(cmsRoot, "mappings"),
    ZUDO_COMPOSER_SITEMAPS_DIR: join(cmsRoot, "sitemaps"),
    ZUDO_COMPOSER_ASSETS_DIR: join(cmsRoot, "assets"),
    ZUDO_COMPOSER_PUBLIC_ASSETS_DIR: join(hostRoot, "public/uploaded-assets"),
    ZUDO_COMPOSER_STYLES: join(hostRoot, "styles/base.css"),
  } as const;
  for (const [key, expected] of Object.entries(composerRoots)) {
    const value = environment[key];
    if (!value || isAbsolute(value) || value.includes("\\")) return fail();
    const resolved = resolve(hostRoot, value);
    if (resolved !== expected || realpathSync(resolved) !== resolved) return fail();
  }
  let routes: unknown;
  try { routes = JSON.parse(environment.DEMOS_LANE_ROUTES ?? ""); }
  catch { return fail(); }
  if (!Array.isArray(routes) || routes.length === 0 || routes.some((route) => typeof route !== "string")) return fail();
  return { name: name as DemosLaneName, assetsStoreRoot, routes: routes as string[] };
}
