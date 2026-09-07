import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

/**
 * Fail before Playwright or the dev server starts unless the canonical runner
 * supplied a disposable host project root. The installed-host lane authors real
 * files beneath this directory, so a lane that reached a real project — this
 * repository included — would write into it.
 */
export function requireHostRoot(environment: NodeJS.ProcessEnv): string {
  const root = environment.ZUDO_COMPOSER_HOST_ROOT;
  const fail = (): never => {
    throw new Error("Use test:browser:host: an explicit disposable host project root is required.");
  };
  if (!root || !isAbsolute(root) || resolve(root) !== root || realpathSync(root) !== root) return fail();
  const parent = dirname(root);
  if (basename(root) !== "host" || dirname(parent) !== realpathSync(tmpdir())
    || !basename(parent).startsWith("zudo-composer-host-browser-")) return fail();
  return root;
}
