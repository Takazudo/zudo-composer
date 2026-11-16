// @ts-check
import { join } from "node:path";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";
async function identity() {
  return /** @type {typeof import("./identity.js")} */ (await createModuleEvaluator(APP_ROOT)(join(APP_ROOT, "server/authoring-workspace/identity.ts")));
}
/** @param {Parameters<typeof import('./identity.js').resolveAuthoringPackIdentity>[0]} options */
export async function resolveAuthoringPackIdentity(options) { return (await identity()).resolveAuthoringPackIdentity(options); }
/** @param {Parameters<typeof import('./identity.js').resolveAuthoringRendererIdentity>[0]} options */
export async function resolveAuthoringRendererIdentity(options) { return (await identity()).resolveAuthoringRendererIdentity(options); }
