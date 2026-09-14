// @ts-check
// The supervised child behind `zudo-composer grammar`.
//
// Resolve the host context first (config + component pack), then evaluate
// `grammar.ts` through the tool-rooted module runner — the same two-step
// `generate` uses — because Node refuses to strip types for a `.ts` file
// living under an installed package's `node_modules`.

import { resolve } from "node:path";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { loadHostContext } from "../host-context.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";
import { parseArguments, USAGE } from "./run.mjs";

const parsed = parseArguments(["grammar", ...process.argv.slice(2)]);
if ("error" in parsed) {
  process.stderr.write(`[zudo-composer] ${parsed.error}\n\n${USAGE}`);
  process.exitCode = 1;
} else if (parsed.command === "grammar") {
  try {
    const { composerConfig, pack } = await loadHostContext({ workspaceRoot: parsed.options.workspaceRoot });
    const grammarModule = /** @type {typeof import("./grammar.js")} */ (
      await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "server/cli/grammar.ts"))
    );
    let grammar = await grammarModule.buildHostGrammar({
      componentPack: pack.manifest,
      paths: composerConfig.paths,
    });
    if (parsed.options.template !== undefined) {
      grammar = grammarModule.selectGrammarTemplate(grammar, parsed.options.template);
    }
    process.stdout.write(parsed.options.json
      ? `${JSON.stringify(grammar, null, 2)}\n`
      : `${grammarModule.renderGrammarMarkdown(grammar)}\n`);
  } catch (error) {
    process.stderr.write(`[zudo-composer] grammar failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else {
  process.stdout.write(USAGE);
}
