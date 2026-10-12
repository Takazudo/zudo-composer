// @ts-check
import { resolve } from "node:path";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { loadHostContext } from "../host-context.mjs";
import { createModuleEvaluator } from "../module-evaluator.mjs";
const [command, ...args] = process.argv.slice(2);
try {
  let workspaceRoot;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--root" && args[index + 1] && !args[index + 1].startsWith("-")) workspaceRoot = resolve(args[++index]);
    else if (args[index] !== "--stdin" && args[index] !== "--json") throw Object.assign(new Error(`Unknown or incomplete edit option: ${args[index]}`), { code: "invalid-request" });
  }
  const { composerConfig: config, pack, packIdentity } = await loadHostContext({ workspaceRoot });
  const { runEdit } = /** @type {typeof import("./edit.js")} */ (await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "server/cli/edit.ts")));
  const result = await runEdit({ config, pack, packIdentity }, command ?? "");
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
} catch (error) {
  const failure = /** @type {{code?: string,message?: string}} */ (error);
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: failure.code ?? "edit-failed", message: failure.message ?? "Editing failed." } })}\n`);
  process.exitCode = 2;
}
