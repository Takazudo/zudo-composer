// @ts-check
/* global clearTimeout */
// One test-owned child process under an overall deadline. The child leads its own
// process group and carries a run marker in its environment, which every process it
// starts inherits (the browser, and a CLI even in the CLI's own group). At the
// deadline the group is asked to stop (SIGTERM), given a bounded grace period, then
// killed; finally any process still carrying the marker is killed. Nothing without
// the marker is ever signalled, so the person's other CLI sessions are untouched.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

export const RUN_MARKER = "ZUDO_CONTENT_AI_RUN_ID";

/** Processes whose environment carries this run's marker (Linux /proc; empty elsewhere). @param {string} runId */
export function markedProcesses(runId) {
  /** @type {number[]} */
  const found = [];
  let entries;
  try { entries = readdirSync("/proc"); } catch { return found; }
  const needle = `${RUN_MARKER}=${runId}`;
  for (const name of entries) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try { if (readFileSync(`/proc/${name}/environ`, "latin1").split("\0").includes(needle)) found.push(Number(name)); } catch { /* exited or not ours to read */ }
  }
  return found;
}

/** @param {number} pid @param {NodeJS.Signals | 0} signal */
const signalGroup = (pid, signal) => { try { process.kill(-pid, signal); return true; } catch { return false; } };

/**
 * @param {{ command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv, message?: unknown, deadlineAt: number, graceMs: number,
 *   onMessage?: (message: any) => void, onOutput?: (text: string) => void }} options
 * @returns {Promise<{ ended: "completed" | "deadline", cleanup: "clean" | "forced", phase: string | null, done: any, exitCode: number | null,
 *   signal: NodeJS.Signals | null, strays: number, remaining: number[], runId: string, pid: number }>}
 */
export function runBoundedChild({ command, args, cwd, env = process.env, message, deadlineAt, graceMs, onMessage, onOutput }) {
  const runId = randomUUID();
  const child = spawn(command, args, { cwd, env: { ...env, [RUN_MARKER]: runId }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const pid = /** @type {number} */ (child.pid);
  /** @type {"completed" | "deadline"} */ let ended = "completed";
  /** @type {"clean" | "forced"} */ let cleanup = "clean";
  /** @type {string | null} */ let phase = null;
  /** @type {string | null} */ let expiredIn = null;
  /** @type {any} */ let done = null;
  /** @type {NodeJS.Timeout[]} */ const timers = [];
  const later = (/** @type {number} */ ms, /** @type {() => void} */ action) => { timers.push(setTimeout(action, Math.max(0, ms))); };
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  let leaderGone = false;
  void exited.then(() => { leaderGone = true; });
  const force = () => { if (!leaderGone || signalGroup(pid, 0)) { cleanup = "forced"; signalGroup(pid, "SIGKILL"); } };
  /** Ask the group to stop, then kill it once the grace period is over. */
  const stop = () => { signalGroup(pid, "SIGTERM"); later(graceMs, force); };

  child.stdout?.on("data", chunk => onOutput?.(String(chunk)));
  child.stderr?.on("data", chunk => onOutput?.(String(chunk)));
  child.on("message", (/** @type {any} */ received) => {
    if (received?.type === "phase") phase = received.name;
    if (received?.type === "done") {
      done = received;
      // The work is over; its own cleanup gets the same bounded grace period.
      later(graceMs, () => { if (!leaderGone) force(); });
    }
    onMessage?.(received);
  });
  if (message !== undefined) child.send(/** @type {any} */ (message));
  // The phase is frozen when the deadline fires; the child reports "cleanup" afterwards.
  later(deadlineAt - Date.now(), () => { if (leaderGone || done) return; ended = "deadline"; expiredIn = phase; stop(); });

  return exited.then(async (/** @type {any} */ exit) => {
    for (const timer of timers) clearTimeout(timer);
    // The leader is gone; its group gets a moment to finish exiting (a closed browser's helpers), then
    // anything left in it or carrying the marker is this run's and is killed.
    for (let waited = 0; signalGroup(pid, 0) && waited < 2_000; waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
    if (signalGroup(pid, 0)) { signalGroup(pid, "SIGKILL"); cleanup = "forced"; }
    const strays = markedProcesses(runId);
    for (const stray of strays) { try { process.kill(stray, "SIGKILL"); } catch { /* already gone */ } }
    if (strays.length) { cleanup = "forced"; await new Promise(resolve => setTimeout(resolve, 200)); }
    return { ended, cleanup, phase: ended === "deadline" ? expiredIn : phase, done, exitCode: exit.code, signal: exit.signal, strays: strays.length, remaining: markedProcesses(runId), runId, pid };
  });
}
