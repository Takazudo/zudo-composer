// @ts-check
// Installed Node adapter. Evaluation stays rooted at the installed tool; hosts
// never import TypeScript implementation paths from node_modules themselves.
import { resolve } from "node:path";
import { APP_ROOT } from "../plugins/roots.mjs";
import { loadHostContext } from "./host-context.mjs";
import { createModuleEvaluator } from "./module-evaluator.mjs";
/** @param {{workspaceRoot?: string}} [options] */
export async function createEditingService(options = {}) {
  const { composerConfig: config, pack, packIdentity } = await loadHostContext(options);
  const module = /** @type {typeof import("./edit/service.js")} */ (await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "server/edit/service.ts")));
  return module.createEditingService({ config, pack, packIdentity });
}
