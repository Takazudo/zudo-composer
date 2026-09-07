// @ts-check
// Two roots that `config.root` used to conflate. Once zudo-composer runs from a
// host project's node_modules the package directory and the host project
// directory are different places, and no single Vite root satisfies both.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve, sep } from "node:path";

/** The application entry every host boots, package-relative. */
export const APP_ENTRY = "src/main.tsx";

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
  // Realpath is load-bearing, not cosmetic. The transactional record store
  // refuses a generations directory whose `realpath` differs from the path it
  // was given, so any symlinked segment in the host root makes every authoring
  // write fail closed as `blocked`. macOS hits this by default — `/var` is a
  // symlink to `/private/var` — so a host under a temp dir, or any project
  // reached through a symlink, is otherwise unusable.
  return realpathOrSelf(validateRootOverride(configured, "Workspace root") ?? resolve(process.cwd()));
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
 * What a dev server compiles before anyone asks for it.
 *
 * The application entry and its graph are transformed on demand, so the first
 * route pays for the whole tree while the author waits at a blank workspace:
 * measured here at ~16s cold against ~1s warm for an installed host, and ~2.3s
 * against ~0.25s for this repository's own server. Warming the app sources
 * removes that penalty for the first page anyone opens — including the first
 * spec of a browser lane, which no longer inherits a server another spec file
 * warmed up. Test sources are excluded because no route imports them.
 */
export function resolveAppWarmupFiles() {
  return [
    resolve(APP_ROOT, APP_ENTRY),
    resolve(APP_ROOT, "src/**/*.{ts,tsx,css}"),
    `!${resolve(APP_ROOT, "src/**/__tests__/**")}`,
  ];
}

/**
 * Directories Vite's watcher must leave alone.
 *
 * Authored data lives UNDER the Vite root, and the Composer writes on every
 * edit: canonical JSON plus derived `.tsx` output. Watched, each of those saves
 * starts an HMR round that re-executes the app entry and remounts the whole
 * application mid-edit — undo/redo history, the open editor and its in-flight
 * save are all discarded. The application refreshes itself from its own
 * `zudo-workspace-persistence-v1` hints, so it needs nothing from the watcher.
 * @param {readonly (string | undefined)[]} roots
 */
export function resolveWatchIgnored(roots) {
  return [...new Set(roots.filter((root) => typeof root === "string" && root !== ""))]
    .map((root) => `${resolve(root).split(sep).join("/")}/**`);
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

/** @param {string} path */
function realpathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Directories Vite is allowed to read files from.
 *
 * Vite derives its default allow-list from the *host* root, but the component
 * pack plugin declares an allow entry of its own, and any declared entry
 * replaces that default — so both roots have to be named here or the host's own
 * sources become 403s. Both are listed with their realpaths as well: under pnpm
 * the package is reached through a symlink into `node_modules/.pnpm`, and
 * fs-allow comparisons happen on whichever of the two forms the request
 * produced.
 * @param {string} workspaceRoot
 */
export function resolveFsAllow(workspaceRoot) {
  const candidates = [workspaceRoot, realpathOrSelf(workspaceRoot), APP_ROOT, realpathOrSelf(APP_ROOT)];
  return [...new Set(candidates)];
}
