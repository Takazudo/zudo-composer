// @ts-check
// Two roots that `config.root` used to conflate. Once zudo-composer runs from a
// host project's node_modules the package directory and the host project
// directory are different places, and no single Vite root satisfies both.

import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve, sep } from "node:path";

/** The installed package directory. Never derived from `config.root`. */
export const APP_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

/**
 * Vite dev-server id for any absolute path outside the host root. A
 * root-absolute specifier (`/src/…`) resolves against the host project, so
 * package-owned modules — and an installed component pack, which lives
 * wherever the host's package manager put it — must be addressed through
 * Vite's `/@fs` prefix instead.
 * @param {string} absolutePath
 */
export function fsModuleId(absolutePath) {
  const absolute = resolve(absolutePath).split(sep).join("/");
  return `/@fs${absolute.startsWith("/") ? "" : "/"}${absolute}`;
}

/**
 * Vite dev-server id for a file inside the package.
 * @param {string} relativePath
 */
export function appModuleId(relativePath) {
  return fsModuleId(resolve(APP_ROOT, relativePath));
}

/**
 * @param {string | undefined} root
 * @param {string} label
 */
export function validateRootOverride(root, label) {
  if (root !== undefined && (!isAbsolute(root) || resolve(root) !== root)) throw new Error(`${label} must be an absolute resolved path.`);
  return root;
}

/**
 * The host project directory. Authored data — compositions, media,
 * `.zudo-site-project` — resolves beneath it.
 * @param {string | undefined} configured
 */
export function resolveWorkspaceRoot(configured) {
  return validateRootOverride(configured, "Workspace root") ?? resolve(process.cwd());
}

/**
 * Read a root override from the environment. Blank is absent; anything else
 * must already be absolute and resolved, so a stray relative value can never
 * silently reattach authored data to the current working directory.
 * @param {string | undefined} value
 * @param {string} label
 */
export function readRootEnvironment(value, label) {
  const trimmed = value?.trim();
  return trimmed ? validateRootOverride(trimmed, label) : undefined;
}

/** The disposable SiteProject release root's directory name. */
export const SITE_PROJECT_LOCAL_ROOT_NAME = ".zudo-site-project";
/** Test-only absolute override for that root. It is not a config setting. */
export const SITE_PROJECT_LOCAL_ROOT_ENV = "ZUDO_SITE_PROJECT_ROOT";

/**
 * The SiteProject release root: explicit option, then the test override, then
 * the host project root. Release state is disposable derived data rather than
 * CMS data, so it has no `zudo-composer.config.ts` setting — hosts gitignore
 * it. One resolver, shared by the store and the source plugin, so the watcher
 * and the reader can never disagree about which tree is being served.
 * @param {string} workspaceRoot
 * @param {string | undefined} [configured]
 */
export function resolveSiteProjectLocalRoot(workspaceRoot, configured) {
  const explicit = configured?.trim();
  if (explicit) return resolve(explicit);
  const fromEnvironment = process.env[SITE_PROJECT_LOCAL_ROOT_ENV]?.trim();
  if (fromEnvironment) return resolve(fromEnvironment);
  return resolve(workspaceRoot, SITE_PROJECT_LOCAL_ROOT_NAME);
}

/**
 * Vite's static directory for a host.
 *
 * Committed media is served at `/<last segment of publicMediaDir>/`, so the
 * static root is that directory's parent. A single-segment `publicMediaDir`
 * would make the parent the host project root and expose the whole tree, so it
 * is refused rather than silently served.
 * @param {string} workspaceRoot
 * @param {string} publicMedia
 */
export function resolvePublicDir(workspaceRoot, publicMedia) {
  const publicDir = dirname(publicMedia);
  if (publicDir === resolve(workspaceRoot)) {
    throw new Error(
      `zudo-composer config: \`publicMediaDir\` must sit inside a static directory, not directly at the host project root — received "${publicMedia}". Use a nested path such as "public/uploaded-media".`,
    );
  }
  return publicDir;
}
