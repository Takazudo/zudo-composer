// @ts-check
// Node entry for the static builder. Only the build path evaluates TypeScript;
// artifact inspection works without the host's config, source or dependencies.
import { resolve } from "node:path";
import { APP_ROOT, resolveWorkspaceRoot, validateRootOverride } from "../../plugins/roots.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";
import { verifySiteStaticArtifact } from "../site-build.mjs";
import { resolveSiteSourceRevision } from "./source-revision.mjs";

/**
 * @param {import("./run.d.mts").BuildSiteOptions} [options]
 * @param {{build?: (config: import("vite").InlineConfig) => Promise<unknown>}} [deps]
 */
export async function runSiteBuild(options = {}, deps = {}) {
  const sourceRevision = resolveSiteSourceRevision(options.sourceRevision, options.env);
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const directory = validateRootOverride(options.verifyDirectory, "Verification directory") ?? resolve(workspaceRoot, "dist-site");
  if (options.verifyDirectory === undefined && !options.printRoutes) {
    const { resolveStaticSiteConfig } = /** @type {typeof import("./vite-config.js")} */ (
      await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "server/site-build/vite-config.ts"))
    );
    const build = deps.build ?? (await import("vite")).build;
    await build(await resolveStaticSiteConfig({ workspaceRoot, sourceRevision, env: options.env }));
  }
  return verifySiteStaticArtifact({ directory, expectedSourceRevision: sourceRevision });
}
