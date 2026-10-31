// @vitest-environment node
// The real-CLI acceptance's deadline primitive with plain Node children: stalled HTTP,
// slow work, cleanup past its grace and normal completion. Each case must end on time
// and leave no process of its own (process group or run marker) behind.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markedProcesses, runBoundedChild } from "../content-ai/bounded-run.mjs";

let directory = "";
let server: Server;
let url = "";
const script = async (name: string, source: string) => { const file = join(directory, name); await writeFile(file, source); return file; };
const alive = (pid: number) => { try { process.kill(-pid, 0); return true; } catch { return false; } };
// A killed orphan can stay a zombie until init reaps it; it no longer runs.
const running = (pid: number) => { try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return false; } };

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "bounded-run-test-"));
  // Accepts every request and never answers it.
  server = createServer(() => {});
  await new Promise<void>(ready => server.listen(0, "127.0.0.1", ready));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  await rm(directory, { recursive: true, force: true });
});

describe("runBoundedChild", () => {
  it("returns a normal completion with its done message and a clean group", async () => {
    const file = await script("ok.mjs", `process.once("message", m => { process.send({ type: "phase", name: "work" }); process.send({ type: "done", echo: m.value }); setTimeout(() => process.exit(0), 50); });`);
    const outcome = await runBoundedChild({ command: process.execPath, args: [file], message: { value: 7 }, deadlineAt: Date.now() + 10_000, graceMs: 2_000 });
    expect(outcome).toMatchObject({ ended: "completed", cleanup: "clean", exitCode: 0, strays: 0, remaining: [] });
    expect(outcome.done.echo).toBe(7);
    expect(alive(outcome.pid)).toBe(false);
  });

  it("cancels an HTTP request that never answers at the deadline and records its phase", async () => {
    const file = await script("http.mjs", `
      const cancel = new AbortController();
      process.once("SIGTERM", () => cancel.abort());
      process.send({ type: "phase", name: "request" });
      try { await fetch(${JSON.stringify(url)}, { signal: cancel.signal }); } catch { process.send({ type: "phase", name: "cleanup" }); process.exit(1); }`);
    const started = Date.now();
    const outcome = await runBoundedChild({ command: process.execPath, args: [file], deadlineAt: Date.now() + 1_000, graceMs: 2_000 });
    expect(outcome).toMatchObject({ ended: "deadline", phase: "request", cleanup: "clean", exitCode: 1, remaining: [] });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  // The run marker is found through /proc; elsewhere a CLI is stopped by the run's cancellation only.
  it.skipIf(!existsSync("/proc/self/environ"))("stops slow work and its own grandchild, but no process without the run marker", async () => {
    const pidFile = join(directory, "grandchild.pid");
    // The grandchild leads its own process group, like a CLI, so only the run marker finds it.
    const file = await script("slow.mjs", `
      import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
      const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
      writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));
      process.send({ type: "phase", name: "provider" });
      process.once("SIGTERM", () => process.exit(1));
      setInterval(() => {}, 1000);`);
    const bystander = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
    try {
      const outcome = await runBoundedChild({ command: process.execPath, args: [file], deadlineAt: Date.now() + 1_000, graceMs: 1_000 });
      expect(outcome).toMatchObject({ ended: "deadline", phase: "provider", remaining: [] });
      expect(outcome.strays).toBe(1);
      expect(markedProcesses(outcome.runId)).toEqual([]);
      expect(running(Number(readFileSync(pidFile, "utf8")))).toBe(false);
      expect(running(bystander.pid!)).toBe(true);
    } finally { bystander.kill("SIGKILL"); }
  });

  it("kills a cleanup that exceeds its grace period and reports it as forced", async () => {
    const file = await script("stuck.mjs", `
      process.on("SIGTERM", () => {});
      process.send({ type: "done", exitCode: 0 });
      process.send({ type: "phase", name: "cleanup" });
      setInterval(() => {}, 1000);`);
    const started = Date.now();
    const outcome = await runBoundedChild({ command: process.execPath, args: [file], deadlineAt: Date.now() + 30_000, graceMs: 500 });
    expect(outcome).toMatchObject({ ended: "completed", cleanup: "forced", signal: "SIGKILL", remaining: [] });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(alive(outcome.pid)).toBe(false);
  });

  it("kills a child that ignores the deadline's SIGTERM after the grace period", async () => {
    const file = await script("deaf.mjs", `process.on("SIGTERM", () => {}); process.send({ type: "phase", name: "render" }); setInterval(() => {}, 1000);`);
    const outcome = await runBoundedChild({ command: process.execPath, args: [file], deadlineAt: Date.now() + 500, graceMs: 500 });
    expect(outcome).toMatchObject({ ended: "deadline", phase: "render", cleanup: "forced", signal: "SIGKILL", remaining: [] });
  });
});
