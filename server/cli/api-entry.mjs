// @ts-check
// The child process behind `zudo-composer api`.
//
// It is the JSON-stdin SiteProject CLI, reached through Vite's module runner
// rather than `import()`: the runner's modules are TypeScript, and Node refuses
// to strip types under `node_modules`, which is where an installed
// zudo-composer lives.

import { resolve } from "node:path";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { createModuleEvaluator } from "../dev-server.mjs";

const evaluate = createModuleEvaluator(APP_ROOT);

try {
  const [{ runSiteProjectCli }, { createLocalSiteProjectApiService }, { validateMediaStoreRoot }] = await Promise.all([
    evaluate(resolve(APP_ROOT, "server/site-project-local/cli-runner.ts")),
    evaluate(resolve(APP_ROOT, "server/site-project-local/service.ts")),
    evaluate(resolve(APP_ROOT, "plugins/composer-file-provider-plugin.mjs")),
  ]);
  process.exitCode = await runSiteProjectCli(
    createLocalSiteProjectApiService({ mediaStoreRoot: validateMediaStoreRoot(process.env.ZUDO_MEDIA_STORE_ROOT) }),
    { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
  );
} catch (error) {
  process.stderr.write(`SiteProject CLI internal failure: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.stdout.write('{"error":{"code":"internal","message":"The SiteProject CLI failed unexpectedly."},"ok":false}\n');
  process.exitCode = 1;
}
