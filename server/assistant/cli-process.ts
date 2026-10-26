import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { ProviderError } from "./provider";

/** Largest single JSONL line accepted from a CLI. */
export const MAX_CLI_LINE_BYTES = 2 * 1024 * 1024;
/** Largest total stdout accepted for one invocation. */
export const MAX_CLI_STDOUT_BYTES = 16 * 1024 * 1024;
const STDERR_TAIL_BYTES = 8 * 1024;
/** Time a process tree gets between SIGTERM and SIGKILL. */
export const KILL_GRACE_MS = 2_000;

export interface CliInvocation {
  /** Bare command name or absolute path from trusted host config. Never a shell line. */
  executable: string;
  /** Fixed by the adapter; never derived from prompts or model output. */
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  /** Scratch directory owned by this invocation; never canonical host data. */
  cwd: string;
  /** Prompt and context; the CLI reads them from stdin. */
  stdin: string;
  timeoutMs: number;
  signal: AbortSignal;
  /** One complete stdout line (UTF-8 decoded, without the newline). Throwing stops the process. */
  onLine(line: string): void;
  maxLineBytes?: number;
  maxStdoutBytes?: number;
}
export interface CliExit { code: number | null; signal: NodeJS.Signals | null; stderrTail: string }

/** Signals the whole process group the CLI leads, and nothing else. */
function killTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch { /* already gone */ }
}

/**
 * Run one CLI invocation with shell:false, prompt on stdin and JSONL on
 * stdout. Resolves only when the process has exited; the caller decides
 * success from the parsed terminal result together with the exit status.
 * Stop, timeout and shutdown terminate the process group this call started,
 * wait for it to exit, and ignore any output that arrives afterwards.
 */
export function runCliProcess(invocation: CliInvocation): Promise<CliExit> {
  const maxLine = invocation.maxLineBytes ?? MAX_CLI_LINE_BYTES;
  const maxTotal = invocation.maxStdoutBytes ?? MAX_CLI_STDOUT_BYTES;
  return new Promise((resolve, reject) => {
    if (invocation.signal.aborted) { reject(new ProviderError("aborted", "Stopped.", false)); return; }
    let child: ChildProcess;
    try {
      child = spawn(invocation.executable, [...invocation.args], {
        cwd: invocation.cwd, env: invocation.env, shell: false, windowsHide: true,
        // Own process group, so Stop reaches the CLI's children without touching anything else.
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) { reject(spawnFailure(error, invocation.executable)); return; }

    let failure: ProviderError | undefined;
    let accepting = true;
    let total = 0;
    let line: Buffer[] = [], lineBytes = 0;
    let stderr = Buffer.alloc(0);
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const decoder = new StringDecoder("utf8");
    const stop = (error: ProviderError) => {
      if (!failure) failure = error;
      accepting = false;
      killTree(child, "SIGTERM");
      killTimer ??= setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => stop(new ProviderError("timeout", "The local CLI did not finish in time and was stopped.", true)), invocation.timeoutMs);
    const onAbort = () => stop(new ProviderError("aborted", "Stopped.", false));
    invocation.signal.addEventListener("abort", onAbort, { once: true });

    const emit = (bytes: Buffer) => {
      if (!accepting) return;
      // Decode whole lines only, so a multi-byte character split across chunks is never mangled.
      const text = decoder.write(bytes) + decoder.end();
      try { invocation.onLine(text.replace(/\r$/, "")); } catch (error) { stop(error instanceof ProviderError ? error : new ProviderError("malformed-output", "The local CLI produced output Composer could not read.", true)); }
    };
    child.stdout!.on("data", (chunk: Buffer) => {
      if (!accepting) return;
      total += chunk.length;
      if (total > maxTotal) { stop(new ProviderError("malformed-output", "The local CLI produced more output than Composer accepts.", true)); return; }
      let start = 0;
      for (let index = chunk.indexOf(10); index !== -1 && accepting; index = chunk.indexOf(10, start)) {
        const piece = chunk.subarray(start, index);
        if (lineBytes + piece.length > maxLine) { stop(new ProviderError("malformed-output", "The local CLI produced an oversized output line.", true)); return; }
        line.push(piece);
        emit(Buffer.concat(line));
        line = []; lineBytes = 0; start = index + 1;
      }
      if (!accepting) return;
      const rest = chunk.subarray(start);
      lineBytes += rest.length;
      if (lineBytes > maxLine) { stop(new ProviderError("malformed-output", "The local CLI produced an oversized output line.", true)); return; }
      if (rest.length) line.push(rest);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > STDERR_TAIL_BYTES) stderr = stderr.subarray(stderr.length - STDERR_TAIL_BYTES);
    });
    // A CLI that exits before reading stdin raises EPIPE here; the exit status reports the real failure.
    child.stdin!.on("error", () => {});
    child.on("error", error => { stop(spawnFailure(error, invocation.executable)); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      invocation.signal.removeEventListener("abort", onAbort);
      // A final line without a trailing newline still counts.
      if (accepting && lineBytes) emit(Buffer.concat(line));
      accepting = false;
      // Children may still hold the group after the leader exits; make sure none outlive the call.
      if (child.pid !== undefined && process.platform !== "win32") { try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already empty */ } }
      if (failure) reject(failure);
      else resolve({ code, signal, stderrTail: stderr.toString("utf8") });
    });
    child.stdin!.end(invocation.stdin);
  });
}

function spawnFailure(error: unknown, executable: string): ProviderError {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOENT") return new ProviderError("not-installed", `The local CLI "${executable}" was not found. Install it or set assistant.executable.`, false);
  if (code === "EACCES") return new ProviderError("not-installed", `The local CLI "${executable}" is not executable.`, false);
  return new ProviderError("process-failed", "The local CLI could not be started.", false);
}

/** Short bounded probe (`--version`, `--help`). Resolves with stdout+stderr text and the exit code. */
export async function probeCli(executable: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ code: number | null; output: string }> {
  const cwd = await createCliScratch();
  const lines: string[] = [];
  try {
    const exit = await runCliProcess({ executable, args, env: options.env ?? process.env, cwd, stdin: "", timeoutMs: options.timeoutMs ?? 15_000, signal: new AbortController().signal, onLine: text => { if (lines.length < 2_000) lines.push(text); }, maxStdoutBytes: 1024 * 1024 });
    return { code: exit.code, output: `${lines.join("\n")}\n${exit.stderrTail}` };
  } finally { await removeCliScratch(cwd); }
}

/** A fresh empty working directory outside every host data root. */
export const createCliScratch = () => mkdtemp(join(tmpdir(), "zudo-assistant-cli-"));
export const removeCliScratch = (directory: string) => rm(directory, { recursive: true, force: true }).catch(() => {});

/**
 * Environment for a CLI child: the server's own environment, so the CLI's
 * normal sign-in works, plus fixed non-secret additions from the adapter.
 * Composer never reads, copies or stores credentials, and does not relocate
 * HOME or CLI config directories.
 */
export function cliEnvironment(additions: Record<string, string> = {}, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, NO_COLOR: "1", ...additions };
}
