// @ts-check
// The supervised child behind `zudo-composer seed`. Tool-owned TypeScript is
// evaluated through Vite so the same command works inside node_modules.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateAssetStoreRoot } from "../../plugins/composer-file-provider-plugin.mjs";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { loadHostContext } from "../host-context.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";
import { parseArguments, USAGE } from "./run.mjs";

const parsed = parseArguments(["seed", ...process.argv.slice(2)]);
if ("error" in parsed) {
  process.stderr.write(`[zudo-composer] ${parsed.error}\n\n${USAGE}`);
  process.exitCode = 1;
} else if (parsed.command === "seed") {
  try {
    const { composerConfig, pack, packIdentity } = await loadHostContext(parsed.options);
    const source = parsed.options.from ?? resolve(composerConfig.workspaceRoot, "site-project.json");
    const project = JSON.parse(await readFile(source, "utf8"));
    const { seedSiteProject } = /** @type {typeof import("../site-project-local/seed.js")} */ (
      await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "server/site-project-local/seed.ts"))
    );
    const result = await seedSiteProject(project, {
      pack, packIdentity, workspaceRoot: composerConfig.workspaceRoot,
      assetsStoreRoot: validateAssetStoreRoot(process.env.ZUDO_ASSETS_STORE_ROOT) ?? composerConfig.paths.assets,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`[zudo-composer] seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else {
  process.stdout.write(USAGE);
}
