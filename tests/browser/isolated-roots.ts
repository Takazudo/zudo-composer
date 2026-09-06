import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

/** Fail before server startup when a lane was not given the runner's disposable roots. */
export function requireIsolatedRoots(environment: NodeJS.ProcessEnv) {
  const releaseRoot = environment.ZUDO_SITE_PROJECT_ROOT;
  const mediaRoot = environment.ZUDO_MEDIA_STORE_ROOT;
  const fail = () => { throw new Error("Use run-site-project-browser: explicit disposable release and Media roots are required."); };
  if (!releaseRoot || !mediaRoot) return fail();
  for (const root of [releaseRoot, mediaRoot]) {
    if (!isAbsolute(root) || resolve(root) !== root || realpathSync(root) !== root) return fail();
  }
  const parent = dirname(releaseRoot);
  if (dirname(mediaRoot) !== parent || basename(releaseRoot) !== "release" || basename(mediaRoot) !== "media"
    || dirname(parent) !== realpathSync(tmpdir()) || !basename(parent).startsWith("zudo-composer-site-project-browser-")) return fail();
  return { releaseRoot, mediaRoot };
}
