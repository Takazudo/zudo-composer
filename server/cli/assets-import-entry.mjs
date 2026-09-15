// @ts-check
// The supervised child behind `zudo-composer assets import`. Vite evaluates
// package-owned TypeScript even when the tool is installed under node_modules.
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { APP_ROOT, resolveWorkspaceRoot } from "../../plugins/roots.mjs";
import { loadHostConfig } from "../host-context.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";
import { parseArguments, USAGE } from "./run.mjs";

const parsed = parseArguments(["assets", "import", ...process.argv.slice(2)]);
if ("error" in parsed) {
  process.stderr.write(`[zudo-composer] ${parsed.error}\n\n${USAGE}`);
  process.exitCode = 1;
} else if (parsed.command === "assets-import") {
  try {
    const evaluate = createModuleEvaluator(APP_ROOT);
    const [{ runAssetImportCli }, { createAssetImportService }] = /** @type {[typeof import("./assets-import-runner"), typeof import("./assets-import-service")]} */ (await Promise.all([
      evaluate(resolve(APP_ROOT, "server/cli/assets-import-runner.ts")),
      evaluate(resolve(APP_ROOT, "server/cli/assets-import-service.ts")),
    ]));
    const workspaceRoot = resolveWorkspaceRoot(parsed.options.workspaceRoot);
    process.exitCode = await runAssetImportCli({
      // Config errors also use the one-response failure framing, after stdin validation.
      handle: async (/** @type {unknown} */ request) => createAssetImportService(await loadHostConfig(workspaceRoot)).handle(request),
    }, {
      stdin: parsed.options.manifest === undefined ? process.stdin : Readable.from([JSON.stringify({ manifest: parsed.options.manifest })]),
      stdout: process.stdout,
      stderr: process.stderr,
    });
  } catch (error) {
    process.stderr.write(`Assets import internal failure: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.stdout.write('{"error":{"code":"internal","message":"The Assets import failed unexpectedly."},"ok":false}\n');
    process.exitCode = 1;
  }
} else { process.stdout.write(USAGE); }
