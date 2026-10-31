// @ts-check
// Opt-in real-CLI acceptance for Content-AI, ONE provider at a time, through the
// independently installed Article CMS: the host's Node process runs the CLI with
// the person's normal sign-in, and a real browser drives the host admin. A real
// run is refused in CI and makes no model call until --yes. The steps run in
// real-cli-runner.mjs as one process group under the --max-minutes deadline.
//
// The scratch host is a fresh copy of this checkout's article-cms fixture over an
// installed consumer's node_modules (pnpm hosted:install <sha> <dir>), with its
// own SQLite data in a temp dir: no existing workspace or data is opened.
// Exactly one model call is planned (one title-only proposal) and a hard cap
// refuses a second; render, Apply, restart, recovery and Undo never call the
// model. Every step runs once and is judged by targets, structure, saved values,
// unchanged fields and receipt/history invariants — never by model wording.
//
// --allow-fake-executable permits ONLY the repository's fake CLI fixtures, for a
// dry run of this script itself; its result is labelled and never written under
// verification/.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DRY_LABEL, REAL_LABEL, ciRefusal, createScrubber, repo, selectCliExecutable, writeNumberedResult, writesUnderVerification } from "../assistant/real-cli-shared.mjs";
import { runBoundedChild } from "./bounded-run.mjs";

const MODEL_CALL_BUDGET = 1;
const USAGE = `Usage: node scripts/content-ai/verify-real-cli.mjs --provider claude-cli|codex-cli --consumer <installed consumer dir> [--executable <name|/abs/path>] [--model <id>] [--timeout-ms <n>] [--max-minutes <n>] [--plan] [--yes] [--keep]
  --consumer               an installed hosted consumer (pnpm hosted:install <sha> <dir>) whose zudo-composer hosted-content payload equals this checkout
  --plan                   print the target data, provider and planned calls, then exit without running anything
  --yes                    required to start (the one real CLI call spends your normal CLI plan/quota)
  --timeout-ms             bound for the one model reply (default 180000, at most 600000)
  --max-minutes            deadline for the whole run, including setup and cleanup (default 10, at most 30); at the
                           deadline the run's own processes are stopped, then killed after a 15 s grace period, and a
                           failed result naming the phase is written
  --keep                   keep the disposable host directory afterwards
  --out-dir <dir>          where the JSON result goes (default verification/content-ai/real-cli)
  --allow-fake-executable  dry run of this script with scripts/fixtures/assistant/fake-*-cli.mjs only
Exit codes: 0 all steps passed, 1 a step failed, 2 refused/usage, 3 provider blocked.`;

// `pnpm <script> -- --flag` passes the separator through; it is not an argument.
const argv = process.argv.slice(2);
const { values: options } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  strict: true,
  options: {
    provider: { type: "string" }, consumer: { type: "string" }, executable: { type: "string" }, model: { type: "string" },
    "timeout-ms": { type: "string", default: "180000" }, "max-minutes": { type: "string", default: "10" },
    plan: { type: "boolean", default: false }, yes: { type: "boolean", default: false }, keep: { type: "boolean", default: false },
    "out-dir": { type: "string" }, "allow-fake-executable": { type: "boolean", default: false }, help: { type: "boolean", default: false },
  },
});
/** @param {string} message @returns {never} */
const refuse = message => { console.error(`${message}\n${USAGE}`); process.exit(2); };
if (options.help) { console.log(USAGE); process.exit(0); }
const provider = /** @type {"claude-cli" | "codex-cli"} */ (options.provider);
if (provider !== "claude-cli" && provider !== "codex-cli") refuse("--provider must be claude-cli or codex-cli.");
const timeoutMs = Number(options["timeout-ms"]), maxMinutes = Number(options["max-minutes"]);
if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 600_000) refuse("--timeout-ms must be an integer between 5000 and 600000.");
if (!Number.isFinite(maxMinutes) || maxMinutes <= 0 || maxMinutes > 30) refuse("--max-minutes must be greater than 0 and at most 30.");
if (!options.consumer) refuse("--consumer is required: install one with pnpm hosted:install <pushed sha> <dir>.");
const consumer = resolve(/** @type {string} */ (options.consumer));
const selected = await selectCliExecutable({ provider, requested: options.executable, allowFake: options["allow-fake-executable"] });
if ("refusal" in selected) refuse(selected.refusal);
const { executable, dryRun } = /** @type {{ executable: string, dryRun: boolean }} */ (selected);
// A real model run never happens in CI; a dry run with a repository fake executable makes no model call and may.
const inCi = dryRun ? null : ciRefusal();
if (inCi) refuse(inCi);
// Proof-only faults and a shorter cleanup grace exist for the deterministic deadline tests, and only in a dry run.
const FAULTS = ["stall-http", "stall-render", "slow-provider", "stall-cleanup"];
const fault = process.env.CONTENT_AI_REAL_CLI_FAULT || null;
if (fault && (!dryRun || !FAULTS.includes(fault))) refuse(`CONTENT_AI_REAL_CLI_FAULT is a dry-run test hook (${FAULTS.join(", ")}).`);
const graceOverride = process.env.CONTENT_AI_REAL_CLI_GRACE_MS;
if (graceOverride && !dryRun) refuse("CONTENT_AI_REAL_CLI_GRACE_MS is a dry-run test hook.");
const graceMs = graceOverride ? Number(graceOverride) : 15_000;
const label = dryRun ? DRY_LABEL : REAL_LABEL;
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const outDir = options["out-dir"] ? resolve(options["out-dir"]) : dryRun ? join(repo, "test-results/content-ai-real-cli-dry-run") : join(repo, "verification/content-ai/real-cli");
if (dryRun && writesUnderVerification(outDir)) refuse("A dry run never writes under verification/.");

// The installed tool must be this checkout's hosted-content payload, or the run would test other code.
/** @param {string} directory */
async function digestTree(directory) {
  const hash = createHash("sha256");
  for (const name of (await readdir(directory, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => relative(directory, join(entry.parentPath, entry.name))).sort())
    hash.update(`${name}\0${createHash("sha256").update(await readFile(join(directory, name))).digest("hex")}\n`);
  return hash.digest("hex");
}
const installed = join(consumer, "node_modules/zudo-composer/server/hosted-content");
if (!existsSync(installed)) refuse(`${consumer} is not an installed hosted consumer (no node_modules/zudo-composer).`);
if (await digestTree(installed) !== await digestTree(join(repo, "server/hosted-content"))) refuse("The consumer's installed zudo-composer hosted-content payload differs from this checkout; install the pushed commit of this checkout.");

const INSTRUCTION = dryRun ? "shorter title" : "Rewrite only the title of this article so it is shorter and clearer. Do not change the body.";
console.log([
  `Content-AI ${dryRun ? "DRY RUN" : "real CLI check"}: ${provider} (${basename(executable)}${options.model ? `, model ${options.model}` : ""})`,
  `  Label:    ${label}`,
  "  Data:     a fresh disposable Article CMS (SQLite with the demo articles only) in a temp dir, built from this checkout's",
  "            article-cms fixture over the installed consumer. No existing workspace or data is opened or changed.",
  `  Provider: ${provider} with ${dryRun ? "the repository fake executable" : "your normal CLI sign-in"}; it is never replaced by another provider.`,
  `  Calls:    exactly ${MODEL_CALL_BUDGET} model call (one title-only proposal for the "welcome" article); a second call is refused.`,
  "            Rendering, Apply, restart, recovery and Undo read saved state and never call the model.",
  `  Limits:   ${timeoutMs} ms for the model reply; ${maxMinutes} min deadline for the whole run (setup, steps, cleanup); the proposal is bounded by the service (50000 characters a field, 80 for the title).`,
  "  Steps:    provider status → publish A, save B → prepare (title only) → rendered candidate → Apply →",
  "            restart, reload and recover the Apply → Undo → restart and recover the Undo.",
  `  Instruction: ${JSON.stringify(INSTRUCTION)}`,
  `  Result:   ${relative(repo, outDir) || "."}/${provider}-<cliVersion>-${sha.slice(0, 8)}.json`,
].join("\n"));
if (options.plan) process.exit(0);
if (!dryRun && !options.yes) { console.log("Nothing was run. Re-run with --yes to start."); process.exit(2); }

// The deadline bounds everything from here: scratch setup, the run and its cleanup.
const deadlineAt = Date.now() + maxMinutes * 60_000;
const temporary = await mkdtemp(join(tmpdir(), "content-ai-real-cli-"));
const hostDir = join(temporary, "host"), data = join(temporary, "data");
await cp(join(repo, "fixtures/hosted-content-consumer/article-cms"), join(hostDir, "article-cms"), { recursive: true });
await cp(join(repo, "fixtures/hosted-content-consumer/sqlite-storage.mjs"), join(hostDir, "sqlite-storage.mjs"));
await cp(join(consumer, "package.json"), join(hostDir, "package.json"));
await symlink(join(consumer, "node_modules"), join(hostDir, "node_modules"), "dir");
const scrubPaths = [temporary, consumer, repo];
const scrub = createScrubber(scrubPaths);
const log = (/** @type {string} */ line) => console.log(`content-ai-real-cli: ${line}`);

// The run is its own process group (host, browser, provider); its CLI inherits the run marker.
/** @type {any[]} */ const steps = [];
/** @type {any} */ let inference = null;
let modelCalls = 0;
const outcome = await runBoundedChild({
  command: process.execPath, args: [join(repo, "scripts/content-ai/real-cli-runner.mjs")], cwd: hostDir,
  env: { ...process.env, ...(fault === "slow-provider" ? { FAKE_CLAUDE_MODE: "hang", FAKE_CODEX_MODE: "hang" } : {}) },
  message: { hostDir, data, provider, executable, model: options.model ?? null, timeoutMs, deadlineAt, instruction: INSTRUCTION, budget: MODEL_CALL_BUDGET, scrubPaths, fault },
  deadlineAt, graceMs,
  onMessage: message => {
    if (message?.type === "step") steps.push(message.step);
    if (message?.type === "inference") inference = message.inference;
    if (message?.type === "calls") modelCalls = message.count;
  },
  onOutput: text => process.stdout.write(scrub(text)),
});
const done = outcome.done;
const expired = outcome.ended === "deadline";
if (expired) {
  steps.push({ name: outcome.phase ?? "startup", status: "fail", durationMs: 0, details: {}, error: `The ${maxMinutes}-minute run limit expired during ${outcome.phase ?? "startup"}; the run's processes were stopped.` });
  log(`deadline: expired during ${outcome.phase ?? "startup"} — run stopped (${outcome.cleanup} cleanup)`);
}
if (outcome.cleanup === "forced" && !expired) {
  steps.push({ name: "cleanup", status: "fail", durationMs: 0, details: {}, error: `Cleanup exceeded its ${graceMs} ms grace period; the run's processes were killed.` });
  log(`cleanup: exceeded its ${graceMs} ms grace period and was ended`);
}
const blockedReason = !expired && done?.exitCode === 3 ? done.blockedReason : null;
const exitCode = expired || outcome.cleanup === "forced" || !done ? 1 : done.exitCode;
const version = String(inference?.version ?? "unknown").replace(/[^A-Za-z0-9._-]+/g, "_");
const result = {
  label,
  evidence: dryRun ? "none: the CLI was a repository fake; its reply comes from fake-decide.mjs" : exitCode === 3 ? "none: the provider was unavailable, so no model call was made"
    : modelCalls === 0 ? "none: no model call completed" : "real CLI inference through the person's normal sign-in, via the independently installed Article CMS",
  outcome: exitCode === 0 ? "pass" : exitCode === 3 ? "blocked" : "fail",
  ...(blockedReason ? { blockedReason } : {}),
  ...(fault ? { fault } : {}),
  provider: { kind: provider, executable: basename(executable), model: options.model ?? null, version: inference?.version ?? null },
  composer: { sha, installedHostedContentMatchesCheckout: true },
  modelCalls,
  deadline: { maxMinutes, expired, timedOutPhase: expired ? outcome.phase ?? "startup" : outcome.cleanup === "forced" ? "cleanup" : null, cleanup: outcome.cleanup, graceMs,
    ownedProcessesStopped: outcome.remaining.length === 0, straysKilled: outcome.strays },
  ranAt: new Date().toISOString(),
  steps,
};
const file = await writeNumberedResult(outDir, `${provider}-${version}-${sha.slice(0, 8)}`, result);
if (options.keep) log(`kept disposable host at ${temporary}`);
else await rm(temporary, { recursive: true, force: true });
log(`${result.outcome} (${label}); result: ${relative(repo, file)}`);
process.exitCode = exitCode;
