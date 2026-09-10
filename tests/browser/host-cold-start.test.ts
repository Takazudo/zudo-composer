// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FullConfig } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  HOST_COLD_START_TIMEOUT_MS,
  type HostColdStartPage,
  runHostColdStartGate,
} from "../host-cold-start";
import { watchRuntimeFailures } from "../runtime-failures";

interface FakeHooks {
  navigation?: (options: { timeout: number }) => void | Promise<void>;
  heading?: (options: { timeout: number }) => void | Promise<void>;
  settle?: (options: { timeout: number }) => void | Promise<void>;
}

function fakePage(hooks: FakeHooks = {}): {
  page: HostColdStartPage;
  navigationTimeouts: number[];
  headingTimeouts: number[];
  settleTimeouts: number[];
  settleCalls: number;
} {
  const navigationTimeouts: number[] = [];
  const headingTimeouts: number[] = [];
  const settleTimeouts: number[] = [];
  let settleCalls = 0;
  const heading = {
    toBeVisible: async (options: { timeout: number }) => {
      headingTimeouts.push(options.timeout);
      await hooks.heading?.(options);
    },
    toHaveCount: async () => {
      throw new Error("The fake heading locator was asked for a count.");
    },
  };
  const busy = {
    toBeVisible: async () => {
      throw new Error("The fake busy locator was asked for visibility.");
    },
    toHaveCount: async (_count: number, options: { timeout: number }) => {
      settleCalls += 1;
      settleTimeouts.push(options.timeout);
      await hooks.settle?.(options);
    },
  };
  return {
    page: {
      goto: async (_route, options) => {
        navigationTimeouts.push(options.timeout);
        await hooks.navigation?.(options);
      },
      getByRole: () => heading,
      locator: () => busy,
    },
    navigationTimeouts,
    headingTimeouts,
    settleTimeouts,
    get settleCalls() { return settleCalls; },
  };
}

function emitRuntimeFailures(): {
  failures: string[];
  emit(event: string, value: unknown): void;
} {
  const listeners = new Map<string, (value: unknown) => void>();
  const page = {
    on(event: string, listener: (value: unknown) => void) {
      listeners.set(event, listener);
      return page;
    },
  } as unknown as Page;
  const failures = watchRuntimeFailures(page);
  return {
    failures,
    emit: (event, value) => listeners.get(event)?.(value),
  };
}

describe("host cold-start gate", () => {
  it("runs navigation, exact heading and busy settlement under one decreasing deadline", async () => {
    let now = 0;
    const fake = fakePage({
      navigation: async () => { now = 100; },
      heading: async () => { now = 250; },
      settle: async () => { now = 400; },
    });

    await expect(runHostColdStartGate({ page: fake.page, now: () => now })).resolves.toEqual({
      navigationDurationMs: 100,
      headingDurationMs: 150,
      settleDurationMs: 150,
      totalNavigationThroughSettleDurationMs: 400,
    });
    expect(fake.navigationTimeouts).toEqual([HOST_COLD_START_TIMEOUT_MS]);
    expect(fake.headingTimeouts).toEqual([HOST_COLD_START_TIMEOUT_MS - 100]);
    expect(fake.settleTimeouts).toEqual([HOST_COLD_START_TIMEOUT_MS - 250]);
    expect(fake.settleCalls).toBe(1);
  });

  it("fails at exact deadline without ever passing a zero timeout", async () => {
    let now = 0;
    const fake = fakePage({ navigation: async () => { now = HOST_COLD_START_TIMEOUT_MS; } });

    await expect(runHostColdStartGate({ page: fake.page, now: () => now })).rejects.toMatchObject({
      phase: "navigation",
      measurements: {
        navigationDurationMs: null,
        headingDurationMs: null,
        settleDurationMs: null,
        totalNavigationThroughSettleDurationMs: null,
      },
    });
    expect(fake.navigationTimeouts).toEqual([HOST_COLD_START_TIMEOUT_MS]);
    expect(fake.headingTimeouts).toEqual([]);
    expect(fake.settleTimeouts).toEqual([]);
  });

  it("does not reach busy settlement when the exact heading is absent", async () => {
    const fake = fakePage({ heading: async () => { throw new Error("All models was not visible"); } });

    await expect(runHostColdStartGate({ page: fake.page, now: () => 0 })).rejects.toMatchObject({ phase: "heading" });
    expect(fake.settleCalls).toBe(0);
  });

  it("fails a stuck busy state in the settle phase", async () => {
    const fake = fakePage({ settle: async () => { throw new Error("busy never settled"); } });

    await expect(runHostColdStartGate({ page: fake.page, now: () => 0 })).rejects.toMatchObject({ phase: "settle" });
    expect(fake.settleCalls).toBe(1);
  });

  it("retains a navigation cause with runtime diagnostics", async () => {
    const diagnostics = ["console: navigation failure", "page: second failure"];
    const original = new Error("navigation failed");
    const fake = fakePage({ navigation: async () => { throw original; } });

    await expect(runHostColdStartGate({ page: fake.page, now: () => 0, runtimeFailures: diagnostics })).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof Error)) return false;
      const gateError = error as Error & { phase?: string; runtimeFailures?: readonly string[] };
      return gateError.phase === "navigation" && gateError.cause === original
        && JSON.stringify(gateError.runtimeFailures) === JSON.stringify(diagnostics);
    });
  });

  it("fails on diagnostics between heading and settlement and after settlement", async () => {
    let now = 0;
    const between = ["console: after heading"];
    let headed = false;
    const first = fakePage({
      navigation: async () => { now = 10; },
      heading: async () => { now = 20; headed = true; },
    });
    await expect(runHostColdStartGate({ page: first.page, now: () => now, runtimeFailures: () => headed ? between : [] })).rejects.toMatchObject({
      phase: "heading",
      runtimeFailures: between,
      measurements: { navigationDurationMs: 10, headingDurationMs: 10 },
    });

    now = 0;
    const after = ["request: /content (net::ERR_FAILED)"];
    let settled = false;
    const secondWithDiagnostics = fakePage({
      navigation: async () => { now = 10; },
      heading: async () => { now = 20; },
      settle: async () => { now = 30; settled = true; },
    });
    await expect(runHostColdStartGate({ page: secondWithDiagnostics.page, now: () => now, runtimeFailures: () => settled ? after : [] })).rejects.toMatchObject({
      phase: "settle",
      runtimeFailures: after,
      measurements: {
        navigationDurationMs: 10,
        headingDurationMs: 10,
        settleDurationMs: 10,
        totalNavigationThroughSettleDurationMs: 30,
      },
    });
  });

  it("keeps the shared runtime watcher strict while preserving canonical aborted navigation handling", () => {
    const observed = emitRuntimeFailures();
    observed.emit("console", { type: () => "error", text: () => "console failed" });
    observed.emit("pageerror", { message: "page failed" });
    observed.emit("requestfailed", {
      url: () => "http://127.0.0.1:4173/aborted",
      failure: () => ({ errorText: "net::ERR_ABORTED" }),
    });
    observed.emit("requestfailed", {
      url: () => "http://127.0.0.1:4173/failed",
      failure: () => ({ errorText: "net::ERR_FAILED" }),
    });
    expect(observed.failures).toEqual([
      "console: console failed",
      "page: page failed",
      "request: http://127.0.0.1:4173/failed (net::ERR_FAILED)",
    ]);
  });
});

interface FakeSetupOptions {
  contextCreationError?: unknown;
  pageCreationError?: unknown;
  navigation?: () => void | Promise<void>;
  heading?: () => void | Promise<void>;
  settle?: () => void | Promise<void>;
  close?: () => void | Promise<void>;
  contextClose?: () => void | Promise<void>;
  browserClose?: () => void | Promise<void>;
}

interface FakeSetupLocator {
  toBeVisible(options: { timeout: number }): Promise<void>;
  toHaveCount(count: number, options: { timeout: number }): Promise<void>;
}

function fakeSetupHarness(options: FakeSetupOptions = {}) {
  const listeners = new Map<string, (value: unknown) => void>();
  const closeCalls = { page: 0, context: 0, browser: 0 };
  const heading: FakeSetupLocator = {
    toBeVisible: async () => { await options.heading?.(); },
    toHaveCount: async () => { throw new Error("unexpected heading count assertion"); },
  };
  const busy: FakeSetupLocator = {
    toBeVisible: async () => { throw new Error("unexpected busy visibility assertion"); },
    toHaveCount: async () => { await options.settle?.(); },
  };
  const page = {
    on(event: string, listener: (value: unknown) => void) {
      listeners.set(event, listener);
      return page;
    },
    goto: async () => { await options.navigation?.(); },
    getByRole: () => heading,
    locator: () => busy,
    close: async () => { closeCalls.page += 1; await options.close?.(); },
  };
  const context = {
    newPage: async () => {
      if (options.pageCreationError !== undefined) throw options.pageCreationError;
      return page;
    },
    close: async () => { closeCalls.context += 1; await options.contextClose?.(); },
  };
  const browser = {
    newContext: async () => {
      if (options.contextCreationError !== undefined) throw options.contextCreationError;
      return context;
    },
    close: async () => { closeCalls.browser += 1; await options.browserClose?.(); },
  };
  return {
    page,
    context,
    browser,
    closeCalls,
    emit(event: string, value: unknown) { listeners.get(event)?.(value); },
  };
}

function fakePlaywrightExpect(locator: unknown): FakeSetupLocator {
  return locator as FakeSetupLocator;
}

async function loadMockedGlobalSetup(browser: unknown) {
  vi.doMock("@playwright/test", () => ({
    chromium: { launch: async () => browser },
    expect: fakePlaywrightExpect,
  }));
  return (await import("../host-cold-start.setup")).default;
}

afterEach(() => {
  vi.doUnmock("@playwright/test");
  vi.resetModules();
});

describe("host cold-start setup lifecycle", () => {
  it("closes every resource and preserves the primary error with runtime and cleanup diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "zudo-composer-host-cold-start-setup-"));
    try {
      const original = new Error("navigation broke first");
      const cleanup = new Error("page close broke second");
      const harness = fakeSetupHarness({
        navigation: async () => {
          harness.emit("console", { type: () => "error", text: () => "console during navigation" });
          throw original;
        },
        close: async () => {
          harness.emit("pageerror", { message: "late page error during teardown" });
          throw cleanup;
        },
      });
      const setup = await loadMockedGlobalSetup(harness.browser);
      const outputDir = join(root, "results");
      const config = { projects: [{ outputDir, use: { baseURL: "http://127.0.0.1:4173" } }] } as unknown as FullConfig;
      let thrown: unknown;
      try { await setup(config); }
      catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(Error);
      const setupError = thrown as Error & { cause?: Error & { cause?: unknown } };
      expect(setupError.message).toContain("navigation");
      expect(setupError.message).toContain("page close");
      expect(setupError.cause?.cause).toBe(original);
      expect(harness.closeCalls).toEqual({ page: 1, context: 1, browser: 1 });
      const result = JSON.parse(await readFile(join(outputDir, "host-cold-start.json"), "utf8")) as {
        outcome: string;
        phase: string | null;
        runtimeFailures: string[];
        error: { cause?: { cause?: { message?: string } } } | null;
      };
      expect(result).toMatchObject({ outcome: "failed", phase: "navigation" });
      expect(result.runtimeFailures).toEqual([
        "console: console during navigation",
        "page: late page error during teardown",
      ]);
      expect(JSON.stringify(result.error)).toContain("navigation broke first");
      expect(JSON.stringify(result.error)).toContain("page close broke second");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats a runtime failure during teardown as a failed gate after a successful route", async () => {
    const root = await mkdtemp(join(tmpdir(), "zudo-composer-host-cold-start-setup-"));
    try {
      const harness = fakeSetupHarness({
        close: async () => {
          harness.emit("requestfailed", {
            url: () => "http://127.0.0.1:4173/late",
            failure: () => ({ errorText: "net::ERR_FAILED" }),
          });
        },
      });
      const setup = await loadMockedGlobalSetup(harness.browser);
      const outputDir = join(root, "results");
      const config = { projects: [{ outputDir, use: { baseURL: "http://127.0.0.1:4173" } }] } as unknown as FullConfig;
      await expect(setup(config)).rejects.toThrow(/Runtime failures/);
      expect(harness.closeCalls).toEqual({ page: 1, context: 1, browser: 1 });
      const result = JSON.parse(await readFile(join(outputDir, "host-cold-start.json"), "utf8")) as {
        outcome: string;
        phase: string | null;
        runtimeFailures: string[];
        totalNavigationThroughSettleDurationMs: number | null;
      };
      expect(result).toMatchObject({ outcome: "failed", phase: "cleanup" });
      expect(result.runtimeFailures).toEqual(["request: http://127.0.0.1:4173/late (net::ERR_FAILED)"]);
      expect(result.totalNavigationThroughSettleDurationMs).not.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("closes a launched browser and writes infrastructure diagnostics when context creation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "zudo-composer-host-cold-start-setup-"));
    try {
      const harness = fakeSetupHarness({ contextCreationError: new Error("context could not start") });
      const setup = await loadMockedGlobalSetup(harness.browser);
      const outputDir = join(root, "results");
      const config = { projects: [{ outputDir, use: { baseURL: "http://127.0.0.1:4173" } }] } as unknown as FullConfig;
      await expect(setup(config)).rejects.toThrow(/context/);
      expect(harness.closeCalls).toEqual({ page: 0, context: 0, browser: 1 });
      const result = JSON.parse(await readFile(join(outputDir, "host-cold-start.json"), "utf8")) as {
        phase: string | null;
        browserLaunchDurationMs: number | null;
        navigationDurationMs: number | null;
      };
      expect(result).toMatchObject({ phase: "context", navigationDurationMs: null });
      expect(result.browserLaunchDurationMs).not.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const SUBPROCESS_TIMEOUT_MS = 20_000;
const TERMINATION_GRACE_MS = 750;
const LIFECYCLE_LOOPBACK_HOST = process.platform === "linux" ? "127.0.0.2" : "127.0.0.1";

function signalRunner(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try { child.kill(signal); }
    catch { /* The runner may have exited before escalation. */ }
    return;
  }
  try { process.kill(-child.pid, signal); }
  catch {
    try { child.kill(signal); }
    catch { /* The runner may have exited before escalation. */ }
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(pid, signal); }
  catch { /* The fixture server may have exited with the runner. */ }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForPidExit(pid: number, timeoutMs = TERMINATION_GRACE_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (pidIsAlive(pid)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(50, remaining)));
  }
  return true;
}

async function readFixturePid(serverPidPath: string): Promise<number | null> {
  try {
    const pid = Number((await readFile(serverPidPath, "utf8")).trim());
    return Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid ? pid : null;
  } catch {
    return null;
  }
}

async function waitForFixturePid(serverPidPath: string, timeoutMs = 5_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = await readFixturePid(serverPidPath);
    if (pid !== null) return pid;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`The lifecycle fixture did not publish its server PID at ${serverPidPath}.`);
}

async function terminateFixtureServer(serverPidPath: string): Promise<void> {
  const pid = await waitForFixturePid(serverPidPath, TERMINATION_GRACE_MS).catch(() => null);
  if (pid === null) return;
  signalPid(pid, "SIGTERM");
  if (await waitForPidExit(pid)) return;
  signalPid(pid, "SIGKILL");
  await waitForPidExit(pid);
}

async function terminateProcessTree(child: ChildProcess, serverPidPath: string): Promise<void> {
  signalRunner(child, "SIGTERM");
  const serverTermination = terminateFixtureServer(serverPidPath);
  await new Promise((resolveWait) => setTimeout(resolveWait, TERMINATION_GRACE_MS));
  signalRunner(child, "SIGKILL");
  await serverTermination;
}

interface SubprocessOptions {
  timeoutMs?: number;
  startupTimeoutMs?: number;
  timeoutReadyPath?: string;
  environment?: Record<string, string>;
}

async function runPlaywrightSubprocess(
  configPath: string,
  markerPath: string,
  serverPidPath: string,
  args: string[] = [],
  options: SubprocessOptions = {},
): Promise<ProcessResult> {
  await rm(serverPidPath, { force: true });
  if (options.timeoutReadyPath) await rm(options.timeoutReadyPath, { force: true });
  const cliPath = resolve(process.cwd(), "node_modules/@playwright/test/cli.js");
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [cliPath, "test", "--config", configPath, ...args], {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: { ...process.env, ...options.environment, COLD_START_MARKER: markerPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let termination: Promise<void> | undefined;
    const timeoutMs = options.timeoutMs ?? SUBPROCESS_TIMEOUT_MS;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let readinessTimer: ReturnType<typeof setTimeout> | undefined;
    const triggerTermination = (isTimeout: boolean) => {
      if (settled || termination) return;
      timedOut ||= isTimeout;
      termination = terminateProcessTree(child, serverPidPath);
    };
    const armTimeout = () => {
      if (settled || termination) return;
      if (startupTimer) clearTimeout(startupTimer);
      timeoutTimer = setTimeout(() => triggerTermination(true), timeoutMs);
    };
    if (options.timeoutReadyPath) {
      const startupDeadline = Date.now() + (options.startupTimeoutMs ?? SUBPROCESS_TIMEOUT_MS);
      startupTimer = setTimeout(() => triggerTermination(false), options.startupTimeoutMs ?? SUBPROCESS_TIMEOUT_MS);
      const waitForReady = async () => {
        if (settled || termination) return;
        try {
          await readFile(options.timeoutReadyPath!, "utf8");
          armTimeout();
          return;
        } catch { /* The setup marker has not been written yet. */ }
        if (Date.now() >= startupDeadline) {
          triggerTermination(false);
          return;
        }
        readinessTimer = setTimeout(() => { void waitForReady(); }, 50);
      };
      void waitForReady();
    } else {
      timeoutTimer = setTimeout(() => triggerTermination(true), timeoutMs);
    }
    const finish = async (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (startupTimer) clearTimeout(startupTimer);
      if (readinessTimer) clearTimeout(readinessTimer);
      if (termination) await termination;
      else await terminateFixtureServer(serverPidPath);
      resolveResult(result);
    };
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (startupTimer) clearTimeout(startupTimer);
      if (readinessTimer) clearTimeout(readinessTimer);
      void (termination ?? terminateFixtureServer(serverPidPath)).finally(() => rejectResult(error));
    });
    child.once("close", (code, signal) => { void finish({ code, signal, stdout, stderr, timedOut }); });
  });
}

async function availablePort(): Promise<number> {
  // Linux uses a second loopback address to avoid WSL's 127.0.0.1 forwarding;
  // other platforms retain the standard loopback address.
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, LIFECYCLE_LOOPBACK_HOST, () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    throw new Error("The lifecycle test could not allocate a TCP port.");
  }
  const port = address.port;
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  return port;
}

async function writeLifecycleFixture(root: string, port: number): Promise<{ configPath: string; markerPath: string; baseURL: string; serverPidPath: string; hangMarkerPath: string }> {
  const markerPath = join(root, "setup-markers.jsonl");
  const serverPath = join(root, "server.mjs");
  const serverPidPath = join(root, "server.pid");
  const hangMarkerPath = join(root, "setup-hang.marker");
  const setupPath = join(root, "global-setup.mjs");
  const beforeFailurePath = join(root, "01-before-failure.pw.mjs");
  const afterFailurePath = join(root, "02-after-failure.pw.mjs");
  const configPath = join(root, "playwright.config.mjs");
  const playwrightTestModule = resolve(process.cwd(), "node_modules/@playwright/test/index.mjs");
  const baseURL = `http://${LIFECYCLE_LOOPBACK_HOST}:${port}`;
  await writeFile(serverPath, `import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(serverPidPath)}, String(process.pid) + "\\n");
const server = createServer((request, response) => {
  if (request.url === "/ready") { response.writeHead(200); response.end("ready"); return; }
  response.writeHead(404); response.end();
});
server.listen(${port}, ${JSON.stringify(LIFECYCLE_LOOPBACK_HOST)});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
`);
  await writeFile(setupPath, `import { appendFile } from "node:fs/promises";
export default async function setup(config) {
  const urls = config.projects.map((project) => project.use.baseURL);
  if (urls.length === 0 || urls.some((url) => url !== urls[0])) throw new Error("inconsistent baseURL");
  const response = await fetch(new URL("/ready", urls[0]));
  if (!response.ok) throw new Error("webServer was not ready");
  if (process.env.COLD_START_HANG === "1") {
    await appendFile(process.env.COLD_START_HANG_MARKER, "ready\\n");
    await new Promise(() => {});
  }
  await appendFile(process.env.COLD_START_MARKER, JSON.stringify({ baseURL: urls[0] }) + "\\n");
}
`);
  await writeFile(beforeFailurePath, `import { test } from ${JSON.stringify(playwrightTestModule)};
test("passes before failure", () => {});
test("intentional lifecycle failure", () => { throw new Error("expected lifecycle failure"); });
`);
  await writeFile(afterFailurePath, `import { test } from ${JSON.stringify(playwrightTestModule)};
test("after worker replacement", () => {});
test("later test after worker replacement", () => {});
`);
  await writeFile(configPath, `import { defineConfig } from ${JSON.stringify(playwrightTestModule)};
export default defineConfig({
  testDir: ${JSON.stringify(root)},
  testMatch: "**/*.pw.mjs",
  globalSetup: ${JSON.stringify(setupPath)},
  reporter: "line",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: [{ name: "desktop" }, { name: "coarse" }],
  use: { baseURL: ${JSON.stringify(baseURL)} },
  webServer: {
    command: ${JSON.stringify(`${JSON.stringify(process.execPath)} ${JSON.stringify(serverPath)}`)},
    url: ${JSON.stringify(`${baseURL}/ready`)},
    reuseExistingServer: false,
    timeout: 5000,
  },
});
`);
  await appendFile(markerPath, "");
  return { configPath, markerPath, baseURL, serverPidPath, hangMarkerPath };
}

describe("host global setup lifecycle", () => {
  it("runs once per Playwright invocation across projects and worker replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "zudo-composer-host-cold-start-lifecycle-"));
    try {
      const fixture = await writeLifecycleFixture(root, await availablePort());
      const first = await runPlaywrightSubprocess(fixture.configPath, fixture.markerPath, fixture.serverPidPath);
      expect(first.timedOut, `${first.stdout}\n${first.stderr}`).toBe(false);
      expect(first.code).not.toBe(0);
      expect(`${first.stdout}\n${first.stderr}`).toContain("intentional lifecycle failure");
      expect(`${first.stdout}\n${first.stderr}`).toContain("after worker replacement");
      const firstMarkers = (await readFile(fixture.markerPath, "utf8")).trim().split("\n").filter(Boolean);
      expect(firstMarkers).toHaveLength(1);
      expect(JSON.parse(firstMarkers[0]!).baseURL).toBe(fixture.baseURL);

      const second = await runPlaywrightSubprocess(fixture.configPath, fixture.markerPath, fixture.serverPidPath, ["--grep", "later test after worker replacement"]);
      expect(second.timedOut, `${second.stdout}\n${second.stderr}`).toBe(false);
      expect(second.code).toBe(0);
      const secondMarkers = (await readFile(fixture.markerPath, "utf8")).trim().split("\n").filter(Boolean);
      expect(secondMarkers).toHaveLength(2);
      expect(`${second.stdout}\n${second.stderr}`).toContain("later test after worker replacement");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("escalates timeout cleanup and stops a detached fixture webServer", async () => {
    const root = await mkdtemp(join(tmpdir(), "zudo-composer-host-cold-start-timeout-"));
    let serverPidPath: string | undefined;
    let subprocess: Promise<ProcessResult> | undefined;
    let serverPid: number | undefined;
    try {
      const fixture = await writeLifecycleFixture(root, await availablePort());
      serverPidPath = fixture.serverPidPath;
      subprocess = runPlaywrightSubprocess(fixture.configPath, fixture.markerPath, fixture.serverPidPath, [], {
        timeoutMs: 2_000,
        startupTimeoutMs: 20_000,
        timeoutReadyPath: fixture.hangMarkerPath,
        environment: { COLD_START_HANG: "1", COLD_START_HANG_MARKER: fixture.hangMarkerPath },
      });
      serverPid = await waitForFixturePid(fixture.serverPidPath);
      const result = await subprocess;
      expect(result.timedOut).toBe(true);
      expect(await waitForPidExit(serverPid, 2_000)).toBe(true);
      expect(pidIsAlive(serverPid)).toBe(false);
    } finally {
      if (serverPidPath) await terminateFixtureServer(serverPidPath);
      await subprocess?.catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 35_000);

  it("registers the real host config's setup module without changing its lane timeout policy", async () => {
    const config = await readFile(resolve(process.cwd(), "playwright.host.config.ts"), "utf8");
    expect(config).toContain('globalSetup: "./tests/host-cold-start.setup.ts"');
    expect(config).toContain('url: "http://127.0.0.1:4173/@vite/client"');
    expect(config).toContain("reuseExistingServer: false");
  });
});
