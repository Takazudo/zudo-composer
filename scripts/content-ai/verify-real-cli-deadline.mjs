// @ts-check
/* global clearTimeout */
// Deterministic checks of the real-CLI acceptance's run deadline, with the repository fake
// CLI and proof-only stalls: no model is called. Each case runs the real command (supervisor,
// runner process group, host, browser) and must end within its deadline plus grace, write an
// accurate result, and leave none of its own processes running.
// Usage: node scripts/content-ai/verify-real-cli-deadline.mjs --consumer <installed consumer>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { FAKE_CLIS, repo } from "../assistant/real-cli-shared.mjs";

const { values } = parseArgs({ strict: true, options: { consumer: { type: "string" }, only: { type: "string" } } });
assert.ok(values.consumer, "--consumer <installed consumer> is required");
const DEADLINE_MINUTES = 0.25, GRACE_MS = 3_000;
const cases = [
  { name: "normal completion", fault: null, maxMinutes: 5, exit: 0, outcome: "pass", timedOutPhase: null, cleanup: "clean" },
  { name: "HTTP request that never answers", fault: "stall-http", exit: 1, outcome: "fail", timedOutPhase: "restart-recover-apply", cleanup: null },
  { name: "candidate render that never finishes", fault: "stall-render", exit: 1, outcome: "fail", timedOutPhase: "render-and-apply", cleanup: null },
  { name: "slow provider (fake CLI that never replies)", fault: "slow-provider", exit: 1, outcome: "fail", timedOutPhase: "prepare-title-only", cleanup: null },
  { name: "cleanup that exceeds its grace period", fault: "stall-cleanup", maxMinutes: 5, exit: 1, outcome: "fail", timedOutPhase: "cleanup", cleanup: "forced" },
].filter(entry => !values.only || entry.fault === values.only || (values.only === "normal" && !entry.fault));

/** Scratch directories this command creates, so a case can prove its own was removed. */
const scratch = async () => (await readdir(tmpdir())).filter(name => name.startsWith("content-ai-real-cli-")).sort();
let failures = 0;
for (const entry of cases) {
  const outDir = await mkdtemp(join(tmpdir(), "content-ai-deadline-result-"));
  const maxMinutes = entry.maxMinutes ?? DEADLINE_MINUTES;
  const before = await scratch();
  const started = Date.now();
  const child = spawn(process.execPath, [join(repo, "scripts/content-ai/verify-real-cli.mjs"), "--provider", "claude-cli", "--consumer", /** @type {string} */ (values.consumer),
    "--executable", FAKE_CLIS["claude-cli"], "--allow-fake-executable", "--timeout-ms", "600000", "--max-minutes", String(maxMinutes), "--out-dir", outDir],
  { cwd: repo, env: { ...process.env, CONTENT_AI_REAL_CLI_GRACE_MS: String(GRACE_MS), ...(entry.fault ? { CONTENT_AI_REAL_CLI_FAULT: entry.fault } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  // The test's own bound: well past the deadline and grace, so a run that ignores them is caught.
  const bound = maxMinutes * 60_000 + GRACE_MS + 30_000;
  const killer = setTimeout(() => child.kill("SIGKILL"), bound);
  const code = await new Promise(resolve => child.once("exit", resolve));
  clearTimeout(killer);
  const elapsed = Date.now() - started;
  /** @type {any} */ let result = null;
  try {
    const files = await readdir(outDir);
    assert.equal(files.length, 1, "exactly one result is written");
    result = JSON.parse(await readFile(join(outDir, files[0]), "utf8"));
    assert.equal(code, entry.exit, `exit code ${code}`);
    assert.equal(result.outcome, entry.outcome);
    assert.equal(result.deadline.timedOutPhase, entry.timedOutPhase);
    if (entry.cleanup) assert.equal(result.deadline.cleanup, entry.cleanup);
    assert.equal(result.deadline.ownedProcessesStopped, true, "no process of the run is left");
    assert.equal(result.modelCalls <= 1, true);
    assert.match(result.label, /dry run/);
    assert.ok(elapsed <= maxMinutes * 60_000 + GRACE_MS + 10_000, `ended in ${elapsed} ms`);
    if (entry.fault && entry.fault !== "stall-cleanup") {
      assert.equal(result.deadline.expired, true);
      assert.ok(result.steps.some((/** @type {any} */ step) => step.status === "fail" && step.error.includes(entry.timedOutPhase)), "the failed step names the phase");
      assert.ok(elapsed >= maxMinutes * 60_000 - 1_000, "it ran until the deadline, not shorter");
    }
    const after = await scratch();
    assert.deepEqual(after.filter(name => !before.includes(name)), [], "the scratch host is removed (no --keep)");
    console.log(`PASS ${entry.name}: exit ${code}, ${result.outcome}, timed out in ${result.deadline.timedOutPhase ?? "—"}, cleanup ${result.deadline.cleanup}, ${elapsed} ms`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${entry.name}: ${error instanceof Error ? error.message : error}\nresult: ${JSON.stringify(result && { outcome: result.outcome, deadline: result.deadline, steps: result.steps })}\n${output}`);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
if (failures) { console.error(`${failures} deadline case(s) failed`); process.exit(1); }
console.log(`Real-CLI deadline checks passed: ${cases.length} cases, fake CLI only, no model call.`);
