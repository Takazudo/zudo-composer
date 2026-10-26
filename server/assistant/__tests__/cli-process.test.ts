// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cliEnvironment, createCliScratch, runCliProcess, type CliInvocation } from "../cli-process";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** Writes a child script and returns an invocation running it with node (shell:false). */
async function child(source: string, overrides: Partial<CliInvocation> = {}) {
  const root = await mkdtemp(join(tmpdir(), "cli-process-test-"));
  roots.push(root);
  const script = join(root, "child.mjs");
  await writeFile(script, source);
  const lines: string[] = [];
  const invocation: CliInvocation = { executable: process.execPath, args: [script], env: cliEnvironment({ CHILD_ROOT: root }), cwd: root, stdin: "", timeoutMs: 10_000, signal: new AbortController().signal, onLine: line => lines.push(line), ...overrides };
  return { root, lines, invocation, script };
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (check: () => boolean | Promise<boolean>, ms = 5_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error("timed out"); };

describe("CLI process runner", () => {
  it("passes the prompt on stdin, never through a shell, and reads complete JSONL lines", async () => {
    const { lines, invocation, script } = await child(`
      let input = ""; process.stdin.on("data", d => input += d).on("end", () => {
        process.stdout.write(JSON.stringify({ stdin: input, argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n{\\"partial\\":");
        setTimeout(() => process.stdout.write("true}"), 20);
      });`, { stdin: "$(touch pwned) `id` ; echo hi" });
    invocation.args = [script, "--literal", "$HOME;touch pwned-arg"];
    const exit = await runCliProcess(invocation);
    expect(exit.code).toBe(0);
    const first = JSON.parse(lines[0]);
    expect(first.stdin).toBe("$(touch pwned) `id` ; echo hi");
    expect(first.argv).toEqual(["--literal", "$HOME;touch pwned-arg"]);
    expect(existsSync(join(invocation.cwd, "pwned-arg"))).toBe(false);
    expect(lines[1]).toBe('{"partial":true}');
    expect(existsSync(join(invocation.cwd, "pwned"))).toBe(false);
  });

  it("keeps multi-byte characters intact when chunks split them", async () => {
    const { lines, invocation } = await child(`
      const bytes = Buffer.from(JSON.stringify({ text: "日本語テキスト🙂" }) + "\\n");
      (async () => { for (const byte of bytes) { process.stdout.write(Buffer.from([byte])); await new Promise(r => setTimeout(r, 1)); } })();`);
    await runCliProcess(invocation);
    expect(JSON.parse(lines[0])).toEqual({ text: "日本語テキスト🙂" });
  });

  it("refuses an oversized line and total output", async () => {
    const huge = await child(`process.stdout.write("x".repeat(5000)); setInterval(() => {}, 1000);`, { maxLineBytes: 1000 });
    await expect(runCliProcess(huge.invocation)).rejects.toMatchObject({ code: "malformed-output" });
    const flood = await child(`const line = "y".repeat(100) + "\\n"; setInterval(() => process.stdout.write(line.repeat(50)), 1);`, { maxStdoutBytes: 20_000 });
    await expect(runCliProcess(flood.invocation)).rejects.toMatchObject({ code: "malformed-output" });
  });

  it("reports a missing executable as not installed", async () => {
    const { invocation } = await child("");
    await expect(runCliProcess({ ...invocation, executable: join(invocation.cwd, "no-such-cli"), args: [] })).rejects.toMatchObject({ code: "not-installed" });
  });

  it("stops the whole process tree it started on abort and ignores later output", async () => {
    const controller = new AbortController();
    const { root, lines, invocation } = await child(`
      import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
      const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
      writeFileSync(process.env.CHILD_ROOT + "/pids", JSON.stringify([process.pid, grandchild.pid]));
      process.on("SIGTERM", () => { process.stdout.write("late\\n"); });
      process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`, { signal: controller.signal });
    const running = runCliProcess(invocation);
    await waitFor(() => lines.includes("ready"));
    const pids: number[] = JSON.parse(await readFile(join(root, "pids"), "utf8"));
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: "aborted" });
    await waitFor(() => pids.every(pid => !alive(pid)));
    expect(lines).toEqual(["ready"]);
  });

  it("times out and kills the process group", async () => {
    const { root, invocation } = await child(`
      import { writeFileSync } from "node:fs"; writeFileSync(process.env.CHILD_ROOT + "/pid", String(process.pid)); setInterval(() => {}, 1000);`, { timeoutMs: 300 });
    await expect(runCliProcess(invocation)).rejects.toMatchObject({ code: "timeout" });
    const pid = Number(await readFile(join(root, "pid"), "utf8"));
    await waitFor(() => !alive(pid));
  });

  it("does not wait for a grandchild that keeps stdout open after the CLI exits, and stops it", async () => {
    const { root, invocation } = await child(`
      import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
      const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] });
      writeFileSync(process.env.CHILD_ROOT + "/pid", String(grandchild.pid));
      process.stdout.write("done\\n"); process.exit(0);`, { timeoutMs: 20_000 });
    const started = Date.now();
    await expect(runCliProcess(invocation)).resolves.toMatchObject({ code: 0 });
    expect(Date.now() - started).toBeLessThan(5_000);
    const pid = Number(await readFile(join(root, "pid"), "utf8"));
    await waitFor(() => !alive(pid));
  });

  it("times out even when a grandchild that ignores SIGTERM holds stdout", async () => {
    const { root, invocation } = await child(`
      import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
      const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] });
      writeFileSync(process.env.CHILD_ROOT + "/pid", String(grandchild.pid));
      process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`, { timeoutMs: 300 });
    const started = Date.now();
    await expect(runCliProcess(invocation)).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(300 + 3 * 2_000);
    const pid = Number(await readFile(join(root, "pid"), "utf8"));
    await waitFor(() => !alive(pid));
  });

  it("resolves with the exit status so callers decide success from result and status together", async () => {
    const { invocation } = await child(`process.stdout.write('{"type":"result"}\\n'); process.stderr.write("boom"); process.exit(3);`);
    await expect(runCliProcess(invocation)).resolves.toMatchObject({ code: 3, stderrTail: "boom" });
  });

  it("creates scratch working directories outside any host", async () => {
    const scratch = await createCliScratch();
    roots.push(scratch);
    expect(scratch.startsWith(tmpdir())).toBe(true);
  });
});

