// @ts-check
// The supervised child behind `zudo-composer generate`.
//
// The host's source and component pack are TypeScript/TSX modules. Resolve the
// host context first, then evaluate the generator through the tool-rooted
// module runner and the authored source through the host-rooted runner. Both
// runners use the canonical Preact JSX policy from module-evaluator.mjs.

import { resolve } from "node:path";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { loadHostContext } from "../host-context.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";
import { parseArguments, USAGE } from "./run.mjs";

const parsed = parseArguments(["generate", ...process.argv.slice(2)]);
if ("error" in parsed) {
  process.stderr.write(`[zudo-composer] ${parsed.error}\n\n${USAGE}`);
  process.exitCode = 1;
} else if (parsed.command === "generate") {
  try {
    const { composerConfig, pack } = await loadHostContext({ workspaceRoot: parsed.options.workspaceRoot });
    const generator = /** @type {typeof import("./generate.js")} */ (
      await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "server/cli/generate.ts"))
    );
    const result = await generator.generateSiteProject({
      packageRoot: composerConfig.workspaceRoot,
      componentPack: pack.manifest,
      evaluate: createModuleEvaluator(composerConfig.workspaceRoot),
      check: parsed.options.check,
    });
    process.stdout.write(`${parsed.options.check ? "Current" : result.changed ? "Wrote" : "Unchanged"} ${result.outputPath}\n`);
  } catch (error) {
    process.stderr.write(`[zudo-composer] generate failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else {
  process.stdout.write(USAGE);
}
