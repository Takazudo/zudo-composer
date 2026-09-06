// @ts-check
// Two roots that `config.root` used to conflate. Once zudo-composer runs from a
// host project's node_modules the package directory and the host project
// directory are different places, and no single Vite root satisfies both.

import { fileURLToPath } from "node:url";
import { isAbsolute, resolve, sep } from "node:path";

/** The installed package directory. Never derived from `config.root`. */
export const APP_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

/**
 * Vite dev-server id for a file inside the package. A root-absolute specifier
 * (`/src/…`) resolves against the host project, so package-owned Node entries
 * must be addressed through Vite's `/@fs` prefix instead.
 * @param {string} relativePath
 */
export function appModuleId(relativePath) {
  const absolute = resolve(APP_ROOT, relativePath).split(sep).join("/");
  return `/@fs${absolute.startsWith("/") ? "" : "/"}${absolute}`;
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
 * The host project directory. Authored data — compositions, media-store,
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
