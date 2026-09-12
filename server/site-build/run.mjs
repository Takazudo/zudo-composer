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
    const nodeEnv = process.env.NODE_ENV;
    // runnerImport defaults to development, before build() can select its
    // production default. Evaluate build/host config under the same default
    // as Vite's build lane, while honoring an explicit caller environment.
    if (!nodeEnv) process.env.NODE_ENV = "production";
    /** @type {import("vite").InlineConfig} */
    let config;
    try {
      const { resolveStaticSiteConfig } = /** @type {typeof import("./vite-config.js")} */ (
        await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "server/site-build/vite-config.ts"))
      );
      config = await resolveStaticSiteConfig({ workspaceRoot, sourceRevision, env: options.env });
    } finally {
      // Remove only our temporary default, including on evaluation failure.
      // Vite must still see an unset/empty value to honor the host's .env
      // NODE_ENV setting. Keep any different value selected by host config.
      if (!nodeEnv && process.env.NODE_ENV === "production") {
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
      }
    }
    const build = deps.build ?? (await import("vite")).build;
    await build(config);
  }
  return verifySiteStaticArtifact({ directory, expectedSourceRevision: sourceRevision });
}
