// Codex CLI adapter against a fake `codex` executable that is really spawned
// (process-protocol evidence, never model inference).
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CliAssistantConfig } from "../../config/assistant";
import { createCliProvider } from "../cli-provider";
import { CODEX_CLI_PROFILE, CODEX_SCHEMA_FILE, codexCliProtocol, codexExecArgs, codexFailure, createCodexCliProtocol } from "../codex-cli-provider";
import { ProviderError, type ProviderRequest } from "../provider";
import { MAX_REPLY_JSON } from "../structured-turn";

const fake = resolve("scripts/fixtures/assistant/fake-codex-cli.mjs");
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const tempDir = async () => { const dir = await mkdtemp(join(tmpdir(), "codex-cli-test-")); dirs.push(dir); return dir; };

const config = (overrides: Partial<CliAssistantConfig> = {}): CliAssistantConfig => ({ provider: "codex-cli", executable: fake, model: null, effort: null, timeoutMs: 20_000, name: "AI Assistant", permission: "apply", ...overrides });
const provider = (env: Record<string, string> = {}, overrides: Partial<CliAssistantConfig> = {}) => createCliProvider(config(overrides), codexCliProtocol, { ...process.env, ...env });
const tools = [
  { name: "suggest_wording", description: "Offer wording.", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "inspect_page", description: "Inspect.", inputSchema: { type: "object", properties: {} } },
];
const request = (text: string, extra: Partial<ProviderRequest> = {}) => {
  const activity: string[] = [];
  const value: ProviderRequest = {
    system: "system rules",
    messages: [{ role: "user", content: [{ type: "text", text: `${text}\n\n<turn_context>\nCurrent page: Home (sitemapId "main", pageId "home")\n</turn_context>` }] }],
    tools, signal: new AbortController().signal, onText: () => {}, onActivity: label => activity.push(label), ...extra,
  };
  return { value, activity };
};
const failure = async (promise: Promise<unknown>) => {
  try { await promise; } catch (error) { if (error instanceof ProviderError) return error; throw error; }
  throw new Error("expected a ProviderError");
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (check: () => boolean | Promise<boolean>, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await check())) { if (Date.now() > end) throw new Error("timed out waiting"); await new Promise(r => setTimeout(r, 25)); }
};

describe("Codex CLI provider (fake executable)", () => {
  it("returns one validated reply with tool calls mapped, and reports only real progress", async () => {
    const { value, activity } = request('suggest "Hello there"');
    const turn = await provider().turn(value);
    expect(turn).toEqual({ stopReason: "tool_use", content: [{ type: "tool_use", id: "fake-0-0", name: "suggest_wording", input: { text: "Hello there" } }] });
    expect(activity).toEqual(["Codex CLI (local login) started", "Codex turn started", "Codex produced a reply"]);
  });

  it("passes the prompt only on stdin, runs in a fresh scratch cwd, and removes it afterwards", async () => {
    const dir = await tempDir();
    const record = join(dir, "record.json");
    const marker = "UNIQUE-USER-TEXT-7f3a";
    await provider({ FAKE_CODEX_RECORD: record }, { model: "gpt-5.5", effort: "high" }).turn(request(`suggest "${marker}"`).value);
    const seen = JSON.parse(await readFile(record, "utf8")) as { argv: string[]; cwd: string; cd: string; schemaExists: boolean; stdinBytes: number };
    expect(seen.argv.join(" ")).not.toContain(marker);
    expect(seen.argv.join(" ")).not.toContain("system rules");
    expect(seen.argv).toEqual(codexExecArgs({ model: "gpt-5.5", effort: "high" }, seen.cd, join(seen.cd, CODEX_SCHEMA_FILE)));
    expect(seen.argv.slice(0, CODEX_CLI_PROFILE.length)).toEqual([...CODEX_CLI_PROFILE]);
    expect(seen.argv).toEqual(expect.arrayContaining(["--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "--strict-config", "-m", "gpt-5.5", 'model_reasoning_effort="high"']));
    expect(seen.argv.at(-1)).toBe("-");
    expect(seen.cwd).toBe(seen.cd);
    expect(seen.cwd.startsWith(join(tmpdir(), "zudo-assistant-cli-"))).toBe(true);
    expect(seen.schemaExists).toBe(true);
    expect(seen.stdinBytes).toBeGreaterThan(0);
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it("omits -m and the effort override when the CLI defaults are used", () => {
    const args = codexExecArgs({ model: null, effort: null }, "/tmp/s", "/tmp/s/schema.json");
    expect(args).not.toContain("-m");
    expect(args.join(" ")).not.toContain("model_reasoning_effort");
  });

  it("keeps multi-byte text intact when a write splits a character", async () => {
    const turn = await provider({ FAKE_CODEX_MODE: "split-utf8" }).turn(request('suggest "日本語のテキスト “quoted” 🎉"').value);
    expect(turn.content).toEqual([expect.objectContaining({ type: "tool_use", input: { text: "日本語のテキスト “quoted” 🎉" } })]);
  });

  it("discards a message from an attempt Codex retried", async () => {
    const { value, activity } = request('suggest "after retry"');
    const turn = await provider({ FAKE_CODEX_MODE: "reconnect" }).turn(value);
    expect(turn.content).toEqual([expect.objectContaining({ input: { text: "after retry" } })]);
    expect(activity).toContain("Codex is retrying the model connection");
  });

  it("reports reasoning only when Codex emits a reasoning item", async () => {
    const { value, activity } = request('suggest "x"');
    await provider({ FAKE_CODEX_MODE: "reasoning" }).turn(value);
    expect(activity).toContain("Codex is reasoning");
  });

  describe("Composer validates every reply", () => {
    it("rejects a tool that is not offered", async () => {
      expect((await failure(provider().turn(request("try to apply").value))).code).toBe("malformed-output");
    });
    it("rejects a reused tool call id", async () => {
      const reply = JSON.stringify({ text: "", tool_calls: [{ id: "used-1", name: "inspect_page", input_json: "{}" }], stop: "tool_use" });
      const { value } = request("hi");
      value.messages.push({ role: "assistant", content: [{ type: "tool_use", id: "used-1", name: "inspect_page", input: {} }] }, { role: "user", content: [{ type: "tool_result", toolUseId: "used-1", content: "{}" }] });
      const error = await failure(provider({ FAKE_CODEX_MODE: "raw-reply", FAKE_CODEX_REPLY: reply }).turn(value));
      expect([error.code, error.message]).toEqual(["malformed-output", expect.stringContaining("duplicate tool call id")]);
    });
    it("rejects a reply that is not JSON or has invalid tool input JSON", async () => {
      expect((await failure(provider({ FAKE_CODEX_MODE: "raw-reply", FAKE_CODEX_REPLY: "Sure! Here you go." }).turn(request("hi").value))).code).toBe("malformed-output");
      const bad = JSON.stringify({ text: "", tool_calls: [{ id: "a1", name: "inspect_page", input_json: "{not json" }], stop: "tool_use" });
      expect((await failure(provider({ FAKE_CODEX_MODE: "raw-reply", FAKE_CODEX_REPLY: bad }).turn(request("hi").value))).message).toContain("not JSON");
    });
    it("rejects an oversized reply and an oversized output line", async () => {
      const big = JSON.stringify({ text: "x".repeat(MAX_REPLY_JSON), tool_calls: [], stop: "end_turn" });
      const file = join(await tempDir(), "reply.json");
      await writeFile(file, big);
      expect((await failure(provider({ FAKE_CODEX_MODE: "raw-reply", FAKE_CODEX_REPLY_FILE: file }).turn(request("hi").value))).message).toContain("too large");
      expect((await failure(provider({ FAKE_CODEX_MODE: "huge-line" }).turn(request("hi").value))).code).toBe("malformed-output");
    });
  });

  describe("failure modes", () => {
    const cases: [string, string, boolean | undefined][] = [
      ["auth", "auth", false],
      ["quota", "quota", false],
      ["rate-limit", "quota", true],
      ["crash-nonzero", "process-failed", undefined],
      ["success-then-nonzero", "process-failed", undefined],
      ["no-terminal-event", "malformed-output", undefined],
      ["no-message", "malformed-output", undefined],
      ["garbage-line", "malformed-output", undefined],
      ["sandbox-refusal", "refused", undefined],
      ["config-rejected", "unsupported", false],
    ];
    for (const [mode, code, retryable] of cases) {
      it(`${mode} → ${code}`, async () => {
        const error = await failure(provider({ FAKE_CODEX_MODE: mode }).turn(request('suggest "x"').value));
        expect(error.code).toBe(code);
        if (retryable !== undefined) expect(error.retryable).toBe(retryable);
        // Raw CLI output (URLs, account hints) never reaches the message.
        expect(error.message).not.toMatch(/https?:\/\/|Read-only file system|fake codex/);
      });
    }

    it("maps Codex's real error texts", () => {
      expect(codexFailure("Quota exceeded. Check your plan and billing details.").code).toBe("quota");
      expect(codexFailure("Selected model is at capacity. Please try a different model.").code).toBe("overloaded");
      expect(codexFailure("stream disconnected before completion: stream closed before response.completed").code).toBe("transport");
      expect(codexFailure("Connection failed: error sending request").code).toBe("transport");
      expect(codexFailure('{"error":{"type":"invalid_request_error","message":"Invalid schema for response_format"}}').code).toBe("invalid-request");
      expect(codexFailure("Codex ran out of room in the model's context window.").code).toBe("invalid-request");
      expect(codexFailure("something unexpected").code).toBe("process-failed");
    });
  });

  describe("Stop and timeout end the whole process tree", () => {
    it("Stop kills the CLI and its grandchild and reports aborted", async () => {
      const dir = await tempDir();
      const pidFile = join(dir, "grandchild.pid");
      const controller = new AbortController();
      const pending = provider({ FAKE_CODEX_MODE: "spawn-grandchild-then-hang", FAKE_CODEX_PID_FILE: pidFile }).turn(request('suggest "x"', { signal: controller.signal }).value);
      await waitFor(() => existsSync(pidFile));
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(alive(pid)).toBe(true);
      controller.abort();
      expect((await failure(pending)).code).toBe("aborted");
      await waitFor(() => !alive(pid), 5_000);
    });

    it("timeout kills the tree and never returns late output", async () => {
      const dir = await tempDir();
      const pidFile = join(dir, "grandchild.pid");
      const started = Date.now();
      const error = await failure(provider({ FAKE_CODEX_MODE: "spawn-grandchild-then-hang", FAKE_CODEX_PID_FILE: pidFile }, { timeoutMs: 1_500 }).turn(request('suggest "x"').value));
      expect(error.code).toBe("timeout");
      expect(Date.now() - started).toBeLessThan(8_000);
      const pid = Number(await readFile(pidFile, "utf8"));
      await waitFor(() => !alive(pid), 5_000);
    });

    it("a policy reply that hangs (fakeDecide wait) stops on abort", async () => {
      const controller = new AbortController();
      const pending = provider().turn(request("wait", { signal: controller.signal }).value);
      setTimeout(() => controller.abort(), 500);
      expect((await failure(pending)).code).toBe("aborted");
    });
  });

  describe("probe", () => {
    it("reports the installed version when signed in", async () => {
      expect(await provider().status()).toMatchObject({ ok: true, provider: "codex-cli", label: "Codex CLI (local login)", version: "0.164.0", model: null });
    });
    it("reports a missing executable path as not-installed", async () => {
      expect(await provider({}, { executable: "/nonexistent/bin/codex" }).status()).toMatchObject({ ok: false, code: "not-installed" });
      const error = await failure(provider({}, { executable: "/nonexistent/bin/codex" }).turn(request("hi").value));
      expect(error.code).toBe("not-installed");
    });
    it("reports an old version as unsupported-version and never runs exec", async () => {
      expect(await provider({ FAKE_CODEX_MODE: "old-version" }).status()).toMatchObject({ ok: false, code: "unsupported-version", version: "0.150.0" });
      expect((await failure(provider({ FAKE_CODEX_MODE: "old-version" }).turn(request("hi").value))).code).toBe("unsupported");
    });
    it("reports not-logged-in, unless CODEX_API_KEY is present for exec", async () => {
      expect(await provider({ FAKE_CODEX_MODE: "not-logged-in", CODEX_API_KEY: "" }).status()).toMatchObject({ ok: false, code: "not-logged-in" });
      expect((await failure(provider({ FAKE_CODEX_MODE: "not-logged-in", CODEX_API_KEY: "" }).turn(request("hi").value))).code).toBe("auth");
      expect(await provider({ FAKE_CODEX_MODE: "not-logged-in", CODEX_API_KEY: "present" }).status()).toMatchObject({ ok: true });
    });
    it("refuses unsupported platforms without running the CLI", async () => {
      const protocol = createCodexCliProtocol({ platform: "win32" });
      expect(await createCliProvider(config({ executable: "/nonexistent/codex" }), protocol).status()).toMatchObject({ ok: false, code: "unsupported-platform" });
    });
  });
});
