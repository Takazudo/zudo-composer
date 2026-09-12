// @ts-check
// The host's resolved config and component pack, for the lanes that have no
// Vite server to ask.
//
// `zudo-composer dev` builds a server around this; `zudo-composer release` runs in
// a child process with no server at all and still has to validate against the
// host's pack. Both reach TypeScript through the module evaluator, because Node
// refuses to strip types under `node_modules` — which is where an installed
// zudo-composer lives.

import { resolve } from "node:path";
import { APP_ROOT, resolveWorkspaceRoot } from "../plugins/roots.mjs";
import { loadComponentPack } from "../plugins/component-pack.mjs";
import { createModuleEvaluator } from "./module-evaluator.mjs";

/**
 * Resolve the host's `zudo-composer.config.ts`.
 * @param {string} workspaceRoot
 * @param {Record<string, string | undefined>} [env]
 */
export async function loadHostConfig(workspaceRoot, env) {
  const evaluateApp = createModuleEvaluator(APP_ROOT);
  const { loadComposerConfig } = /** @type {{loadComposerConfig: (options: unknown) => Promise<any>}} */ (
    await evaluateApp(resolve(APP_ROOT, "server/config/index.ts"))
  );
  return loadComposerConfig({ workspaceRoot, env, load: createModuleEvaluator(workspaceRoot) });
}

/**
 * The config plus the loaded pack it names. Resolution failure and an
 * unresolvable `source.module` both throw here, naming the specifier and the
 * path they were looked for at; there is no fallback pack.
 * @param {{workspaceRoot?: string, env?: Record<string, string | undefined>}} [options]
 */
export async function loadHostContext(options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const composerConfig = await loadHostConfig(workspaceRoot, options.env);
  const evaluateHost = createModuleEvaluator(workspaceRoot);
  const { identity, pack } = await loadComponentPack(workspaceRoot, composerConfig.settings.pack, evaluateHost);
  return { composerConfig, pack, packIdentity: identity, workspaceRoot };
}
