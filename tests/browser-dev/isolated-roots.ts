import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

/** Fail before Playwright or Vite starts unless the canonical runner supplied
 * sibling disposable release, Media and composition roots beneath one
 * OS-temporary parent. The composition root proves the dev server writes
 * authored data into a foreign workspace rather than into this repository. */
export function requireDevBrowserRoots(environment: NodeJS.ProcessEnv) {
  const releaseRoot = environment.ZUDO_SITE_PROJECT_ROOT;
  const mediaRoot = environment.ZUDO_MEDIA_STORE_ROOT;
  const compositionsRoot = environment.ZUDO_COMPOSITIONS_ROOT;
  const fail = () => { throw new Error("Use test:browser:dev: explicit disposable release, Media and composition roots are required."); };
  if (!releaseRoot || !mediaRoot || !compositionsRoot) return fail();
  const roots = [releaseRoot, mediaRoot, compositionsRoot];
  for (const root of roots) if (!isAbsolute(root) || resolve(root) !== root || realpathSync(root) !== root) return fail();
  if (new Set(roots).size !== roots.length) return fail();
  const parent = dirname(releaseRoot);
  if (dirname(mediaRoot) !== parent || dirname(compositionsRoot) !== parent
    || basename(releaseRoot) !== "release" || basename(mediaRoot) !== "media" || basename(compositionsRoot) !== "compositions"
    || dirname(parent) !== realpathSync(tmpdir()) || !basename(parent).startsWith("zudo-composer-dev-browser-")) return fail();
  return { releaseRoot, mediaRoot, compositionsRoot };
}
