// @ts-check
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export const DEMO_EDITOR_HOSTS = Object.freeze({
  sample: "packages/demo-sample",
  shop: "packages/demo-webshop",
  landing: "packages/demo-landing",
  blog: "packages/demo-blog",
});

/** Names are repository-relative; explicit directories are caller-relative.
 * @param {string} target
 * @param {{root?: string, cwd?: string}} [options]
 */
export function resolveDemoEditorHost(target, { root = resolve(import.meta.dirname, ".."), cwd = process.cwd() } = {}) {
  if (!target || target.startsWith("-")) throw new Error("Usage: pnpm demo:build-editor <sample|shop|landing|blog|dir>");
  const named = Object.hasOwn(DEMO_EDITOR_HOSTS, target) ? DEMO_EDITOR_HOSTS[/** @type {keyof typeof DEMO_EDITOR_HOSTS} */ (target)] : undefined;
  const host = named ? resolve(root, named) : resolve(cwd, target);
  if (!existsSync(resolve(host, "site-project.json"))) throw new Error(`No site-project.json in ${host}. Select a demo name or a generated host directory.`);
  return realpathSync(host);
}
