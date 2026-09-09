// @ts-check
// The child process behind `zudo-composer release`.
//
// It is the JSON-stdin SiteProject release CLI, reached through Vite's module runner
// rather than `import()`: the runner's modules are TypeScript, and Node refuses
// to strip types under `node_modules`, which is where an installed
// zudo-composer lives.

import { resolve } from "node:path";
import { validateAssetStoreRoot } from "../../plugins/composer-file-provider-plugin.mjs";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";
import { loadHostContext } from "../host-context.mjs";

const evaluate = createModuleEvaluator(APP_ROOT);

try {
  const [{ runSiteProjectCli }, { createLocalSiteProjectApiService }, { composerConfig, pack, packIdentity }] = await Promise.all([
    evaluate(resolve(APP_ROOT, "server/site-project-local/cli-runner.ts")),
    evaluate(resolve(APP_ROOT, "server/site-project-local/service.ts")),
    loadHostContext(),
  ]);
  process.exitCode = await runSiteProjectCli(
    createLocalSiteProjectApiService({
      pack,
      packIdentity,
      workspaceRoot: composerConfig.workspaceRoot,
      assetsStoreRoot: validateAssetStoreRoot(process.env.ZUDO_ASSETS_STORE_ROOT) ?? composerConfig.paths.assets,
    }),
    { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
  );
} catch (error) {
  process.stderr.write(`SiteProject CLI internal failure: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.stdout.write('{"error":{"code":"internal","message":"The SiteProject CLI failed unexpectedly."},"ok":false}\n');
  process.exitCode = 1;
}
