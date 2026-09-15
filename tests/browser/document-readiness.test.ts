import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { getByRole, within } from "@testing-library/dom";
import { createDocumentReady, finishReadiness, HOST_DOCUMENT_READY_TIMEOUT_MS, type DocumentReady,
  type Deadline, type DocumentReadyOptions, type ReadinessRecord } from "../document-readiness";
import { watchRuntimeFailures } from "../runtime-failures";

// Capture the actual fixture without loading Playwright's test declarations in Vitest.
const fixture = vi.hoisted(() => ({ definitions: {} as Record<string, unknown> }));
vi.mock("@playwright/test", () => ({
  test: { extend: (definitions: Record<string, unknown>) => { fixture.definitions = definitions; return {}; } },
  expect: (locator: { count: () => number }) => ({ toHaveCount: async (count: number) => {
    expect(locator.count()).toBe(count);
  } }),
}));

function harness() {
  let now = 0;
  const page = new EventEmitter();
  const failures = watchRuntimeFailures(page as unknown as Page);
  const records: ReadinessRecord[] = [];
  const report = vi.fn();
  const settleShell = vi.fn(async (_deadline: Deadline) => { void _deadline; now += 3; });
  const record = vi.fn(async (row: ReadinessRecord) => { records.push(row); });
  const run = createDocumentReady({ now: () => now, url: () => "/current", failures, settleShell, record, report });
  const options: DocumentReadyOptions<object> = { id: "same-id", kind: "goto", transition: async () => ({}), ready: async () => {}, settle: "shell" };
  return { run, options, page, failures, records, record, report, settleShell, advance: (ms: number) => { now += ms; } };
}

it("shares one decreasing deadline across operations, returns exact Response identity, then starts fresh", async () => {
  const h = harness(); const response = { status: 200 }; const remaining: number[] = [];
  const options = { ...h.options, transition: async ({ remainingMs }: Deadline) => {
    remaining.push(remainingMs()); h.advance(100); return response;
  }, ready: async ({ remainingMs }: Deadline) => {
    remaining.push(remainingMs()); h.advance(200); remaining.push(remainingMs()); h.advance(300);
  } };
  h.settleShell.mockImplementation(async ({ remainingMs }) => { remaining.push(remainingMs()); h.advance(3); });
  expect(await h.run(options)).toBe(response);
  // Original business work remains reachable after the helper succeeds.
  expect(response.status).toBe(200);
  expect(await h.run(options)).toBe(response);
  expect(remaining).toEqual([47000, 46900, 46700, 46400, 47000, 46900, 46700, 46400]);
  expect(h.records.map(({ ordinal }) => ordinal)).toEqual([1, 2]);
  expect(h.records[0]).toMatchObject({ transitionMs: 100, readyMs: 500, settleMs: 3, totalMs: 603, outcome: "passed" });
});

it.each(["before-operation", "after-transition", "after-ready", "after-settle"])("rejects exhaustion %s without zero timeout or retry", async (when) => {
  const h = harness(); const transition = vi.fn(async ({ remainingMs }) => {
    if (when === "before-operation") { h.advance(HOST_DOCUMENT_READY_TIMEOUT_MS); remainingMs(); }
    expect(remainingMs()).toBeGreaterThan(0);
    if (when === "after-transition") h.advance(HOST_DOCUMENT_READY_TIMEOUT_MS);
    return {};
  });
  const ready = vi.fn(async () => { if (when === "after-ready") h.advance(HOST_DOCUMENT_READY_TIMEOUT_MS); });
  if (when === "after-settle") h.settleShell.mockImplementation(async () => { h.advance(HOST_DOCUMENT_READY_TIMEOUT_MS); });
  await expect(h.run({ ...h.options, transition, ready })).rejects.toThrow("deadline exhausted");
  expect(transition).toHaveBeenCalledTimes(1);
  expect(h.records[0].outcome).toBe("failed");
  expect(h.records[0].settleMs).toBeNull();
  if (when.includes("transition") || when === "before-operation") {
    expect(ready).not.toHaveBeenCalled(); expect(h.records[0].transitionMs).toBeNull();
  }
});

it("keeps a failed semantic assertion, null incomplete duration, runtime detail and artifact error", async () => {
  const h = harness(); const original = new Error("wrong record");
  h.record.mockRejectedValue(new Error("disk full"));
  await expect(h.run({ ...h.options, ready: async () => {
    h.page.emit("pageerror", new Error("late application error")); throw original;
  } })).rejects.toBe(original);
  expect(h.record.mock.calls[0][0]).toMatchObject({ transitionMs: 0, readyMs: null, settleMs: null,
    phase: "ready", error: "Error: wrong record", runtimeFailures: ["page: late application error"] });
  expect(h.report).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  expect(h.settleShell).not.toHaveBeenCalled();
});

it("fails successful work on artifact failure and omits shell settlement only explicitly", async () => {
  const h = harness(); h.record.mockRejectedValue(new Error("disk full"));
  await expect(h.run({ ...h.options, settle: "none" })).rejects.toThrow("disk full");
  expect(h.settleShell).not.toHaveBeenCalled();
});

const emitters = {
  console: (page: EventEmitter) => page.emit("console", { type: () => "error", text: () => "console failure" }),
  pageerror: (page: EventEmitter) => page.emit("pageerror", new Error("page failure")),
  requestfailed: (page: EventEmitter) => page.emit("requestfailed", { failure: () => ({ errorText: "net::ERR_FAILED" }), url: () => "/asset.js" }),
};
for (const [event, emit] of Object.entries(emitters)) {
  it.each(["transition", "ready", "settle"])(`rejects unchanged ${event} collector errors during %s`, async (phase) => {
    const h = harness();
    const operation = async () => { emit(h.page); return {}; };
    if (phase === "settle") h.settleShell.mockImplementation(async () => { emit(h.page); });
    await expect(h.run({ ...h.options, ...(phase === "settle" ? {} : { [phase]: operation }) })).rejects.toThrow("Host runtime failures");
    expect(h.records[0].phase).toBe(phase);
    expect(h.records[0].runtimeFailures).toHaveLength(1);
  });
}
it("exempts only canonical ERR_ABORTED requests", async () => {
  const h = harness(); const request = (errorText: string) => ({ failure: () => ({ errorText }), url: () => "/asset" });
  h.page.emit("requestfailed", request("net::ERR_ABORTED"));
  await h.run(h.options);
  h.page.emit("requestfailed", request("ERR_ABORTED"));
  await expect(h.run(h.options)).rejects.toThrow("Host runtime failures");
});

describe("controlled semantic documents", () => {
  it("does not accept a stale deep record before its exact value resolves", async () => {
    document.body.innerHTML = '<label>Heading<input value="Previous record"></label>';
    const h = harness();
    const ready = async () => { expect((getByRole(document.body, "textbox", { name: "Heading" }) as HTMLInputElement).value).toBe("Start with the question"); };
    await expect(h.run({ ...h.options, ready })).rejects.toThrow();
    (document.querySelector("input")!).value = "Start with the question";
    await h.run({ ...h.options, ready });
  });
  it("a same-named creation dialog cannot satisfy editor readiness", async () => {
    document.body.innerHTML = '<div role="dialog"><label>Sitemap name<input value="Mapping journey"></label></div><div class="cms-editor__toolbar"><label>Sitemap name<input value="Previous sitemap"></label></div>';
    const h = harness();
    const toolbar = document.querySelector<HTMLElement>(".cms-editor__toolbar")!;
    const ready = async () => { expect((within(toolbar).getByRole("textbox", { name: "Sitemap name" }) as HTMLInputElement).value).toBe("Mapping journey"); };
    await expect(h.run({ ...h.options, ready })).rejects.toThrow();
    toolbar.querySelector("input")!.value = "Mapping journey";
    await h.run({ ...h.options, ready });
  });
  it("parent-ready with an attached waiting iframe does not satisfy Hero content", async () => {
    document.body.innerHTML = '<main><h1>Compositions</h1><iframe title="Composer preview canvas"></iframe></main>';
    const frame = document.querySelector("iframe")!.contentDocument!;
    const h = harness();
    const ready = async () => {
      const hero = getByRole(frame.body, "region", { name: "Hero" });
      expect(within(hero).getAllByRole("link").map((link) => link.textContent)).toEqual([expect.stringMatching(/^Contact us/), expect.stringMatching(/^Read docs/)]);
    };
    await expect(h.run({ ...h.options, ready })).rejects.toThrow();
    frame.body.innerHTML = '<section role="region" aria-label="Hero"><a href="/contact">Contact us</a><a href="/docs">Read docs</a></section>';
    await h.run({ ...h.options, ready });
  });
});

it.each([false, true])("finalization reports runtime plus write/attach failures, preserves primary=%s", async (primary) => {
  const report = vi.fn(); const attach = vi.fn(async () => { throw new Error("attachment failed"); });
  const run = finishReadiness({ failures: ["page: late"], hasPrimaryError: () => primary,
    persist: async () => { throw new Error("write failed"); }, attach, report });
  if (primary) await run; else await expect(run).rejects.toThrow("Host runtime failures");
  expect(attach).toHaveBeenCalledOnce(); expect(report).toHaveBeenCalledTimes(3);
});

it.each(["console", "pageerror", "requestfailed"] as const)("actual automatic fixture retains late %s through cleanup, owns append-only artifacts and attaches in finally", async (event) => {
  await import("./host-test");
  type RuntimeFixture = (args: { page: Page }, use: (ready: DocumentReady) => Promise<void>, info: TestInfo) => Promise<void>;
  const [run, config] = fixture.definitions.hostRuntime as [RuntimeFixture, { auto: boolean }];
  expect(config.auto).toBe(true);
  const root = await mkdtemp(join(tmpdir(), "document-readiness-"));
  const sentinel = join(root, "sentinel"); await writeFile(sentinel, "keep");
  const output = join(root, "project", "test", "document-readiness.jsonl");
  const page = Object.assign(new EventEmitter(), { url: () => "/current", locator: () => ({ count: () => 0 }) });
  const attach = vi.fn(async () => {});
  const info = { outputPath: () => output, testId: "id", title: "test", file: "spec", project: { name: "desktop" }, retry: 0, workerIndex: 0, errors: [], status: "passed", attach } as unknown as TestInfo;
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(run({ page: page as unknown as Page }, async (ready) => {
      const response = {}; const options: DocumentReadyOptions<object> = { id: "same", kind: "goto", transition: async () => response, ready: async () => {}, settle: "shell" };
      expect(await ready(options)).toBe(response); expect(await ready(options)).toBe(response);
      emitters[event](page); // Dependent fixture/test cleanup, after the last readiness call.
    }, info)).rejects.toThrow("Host runtime failures");
    const rows = (await readFile(output, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.map((row) => row.ordinal)).toEqual([1, 2, undefined]);
    expect(rows.every((row) => row.project === "desktop" && row.testId === "id")).toBe(true);
    expect(rows[2].runtimeFailures).toHaveLength(1);
    expect(attach).toHaveBeenCalledWith("document-readiness", { path: output, contentType: "application/jsonl" });
    expect(await readFile(sentinel, "utf8")).toBe("keep");
  } finally { logs.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

it.each(["persist", "attach"])("detects runtime errors arriving while awaiting final %s", async (phase) => {
  const page = new EventEmitter(); const failures = watchRuntimeFailures(page as unknown as Page);
  const report = vi.fn();
  await expect(finishReadiness({ failures, hasPrimaryError: () => false, report,
    persist: async () => { if (phase === "persist") { await Promise.resolve(); emitters.pageerror(page); } },
    attach: async () => { if (phase === "attach") { await Promise.resolve(); emitters.console(page); } },
  })).rejects.toThrow("Host runtime failures");
  expect(report).toHaveBeenCalledWith(expect.stringContaining("Host runtime failures"));
});

it("refuses to start a subsequent callback when time expires between phase checks", async () => {
  let reads = 0; const ready = vi.fn(); const records: ReadinessRecord[] = [];
  const run = createDocumentReady({ now: () => ++reads >= 6 ? HOST_DOCUMENT_READY_TIMEOUT_MS : 0,
    url: () => "/", failures: [], settleShell: async () => {}, report: () => {}, record: async (row) => { records.push(row); } });
  await expect(run({ id: "between", kind: "reload", transition: async () => null, ready, settle: "none" })).rejects.toThrow("during ready");
  expect(ready).not.toHaveBeenCalled(); expect(records[0]).toMatchObject({ transitionMs: 0, readyMs: null, phase: "ready" });
});

it("the actual automatic fixture preserves a thrown body assertion with late failures", async () => {
  await import("./host-test");
  type RuntimeFixture = (args: { page: Page }, use: (ready: DocumentReady) => Promise<void>, info: TestInfo) => Promise<void>;
  const [run] = fixture.definitions.hostRuntime as [RuntimeFixture];
  const root = await mkdtemp(join(tmpdir(), "document-readiness-primary-"));
  const page = Object.assign(new EventEmitter(), { url: () => "/", locator: () => ({ count: () => 0 }) });
  const original = new Error("business assertion");
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const info = { outputPath: () => join(root, "document-readiness.jsonl"), project: { name: "coarse" }, errors: [],
      attach: async () => { throw new Error("attachment unavailable"); } } as unknown as TestInfo;
    await expect(run({ page: page as unknown as Page }, async () => {
      emitters.pageerror(page); throw original;
    }, info)).rejects.toBe(original);
    expect(logs).toHaveBeenCalledWith(expect.stringContaining("Host runtime failures"));
    expect(logs).toHaveBeenCalledWith(expect.stringContaining("attachment unavailable"));
  } finally { logs.mockRestore(); await rm(root, { recursive: true, force: true }); }
});
