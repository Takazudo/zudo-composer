import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

/** Fail before Playwright or Vite starts unless the canonical runner supplied
 * sibling disposable release and Media roots beneath one OS-temporary parent. */
export function requireDevBrowserRoots(environment: NodeJS.ProcessEnv) {
  const releaseRoot = environment.ZUDO_SITE_PROJECT_ROOT;
  const mediaRoot = environment.ZUDO_MEDIA_STORE_ROOT;
  const fail = () => { throw new Error("Use test:browser:dev: explicit disposable release and Media roots are required."); };
  if (!releaseRoot || !mediaRoot) return fail();
  for (const root of [releaseRoot, mediaRoot]) if (!isAbsolute(root) || resolve(root) !== root || realpathSync(root) !== root) return fail();
  const parent = dirname(releaseRoot);
  if (dirname(mediaRoot) !== parent || basename(releaseRoot) !== "release" || basename(mediaRoot) !== "media"
    || dirname(parent) !== realpathSync(tmpdir()) || !basename(parent).startsWith("zudo-composer-dev-browser-")) return fail();
  return { releaseRoot, mediaRoot };
}
