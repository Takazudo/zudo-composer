// Fake-CLI evidence only: these tests spawn scripts/fixtures/assistant/fake-claude-cli.mjs
// through the real CLI provider and process runner. They prove Composer's process
// protocol, restricted argv and error mapping, never model behavior or live inference.
import { afterEach, describe, expect, it } from "vitest";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseAssistant, type CliAssistantConfig } from "../../config/assistant";
import { CLAUDE_CLI_MIN_VERSION, CLAUDE_CLI_REQUIRED_FLAGS, claudeCliArgs, claudeCliProtocol } from "../claude-cli-provider";
import { createCliProvider } from "../cli-provider";
import { ProviderError, type ProviderRequest, type ToolSpec } from "../provider";
import { structuredTurnJsonSchema } from "../structured-turn";
import { loadHostContext } from "../../host-context.mjs";
import { initializeAuthoringWorkspace } from "../../edit/initialize-workspace";
import { createEditingService } from "../../edit/service";
import { captureHost } from "../../edit/inspect";
import { defineSite, node } from "../../../src/site-project/authoring";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import { openAssistantStore } from "../store";
import { createAssistantRunner } from "../runner";

const FAKE = resolve("scripts/fixtures/assistant/fake-claude-cli.mjs");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const scratchRoot = async () => { const root = await mkdtemp(join(tmpdir(), "claude-cli-test-")); roots.push(root); return root; };

const cliConfig = (overrides: Record<string, unknown> = {}) => parseAssistant({ provider: "claude-cli", executable: FAKE, timeoutMs: 20_000, ...overrides }) as CliAssistantConfig;
const providerFor = (mode = "success", env: Record<string, string> = {}, overrides: Record<string, unknown> = {}) =>
  createCliProvider(cliConfig(overrides), claudeCliProtocol, { ...process.env, FAKE_CLAUDE_MODE: mode, ...env });

const TOOLS: ToolSpec[] = [
  { name: "inspect_page", description: "Inspect a page", inputSchema: { type: "object" } },
  { name: "propose_changes", description: "Propose changes", inputSchema: { type: "object" } },
];
function request(text: string, options: { signal?: AbortSignal; system?: string } = {}) {
  const activity: string[] = [];
  const value: ProviderRequest = {
    system: options.system ?? "You are the site assistant.",
    messages: [{ role: "user", content: [{ type: "text", text: `${text}\n\n<turn_context>\nCurrent page: Home (sitemapId "main", pageId "home")\n</turn_context>` }] }],
    tools: TOOLS, signal: options.signal ?? new AbortController().signal,
    onText: () => { throw new Error("CLI providers never stream text"); },
    onActivity: label => activity.push(label),
  };
  return { value, activity };
}
const reply = (value: unknown) => ({ FAKE_CLAUDE_REPLY: JSON.stringify(value) });
async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(() => { throw new Error("expected a ProviderError"); }, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}
/** Linux reports reaped-but-unwaited processes as zombies; treat those as gone. */
function alive(pid: number) {
  try { process.kill(pid, 0); } catch { return false; }
  if (process.platform === "linux") { try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return false; } }
  return true;
}
async function waitFor<T>(probe: () => Promise<T | undefined>, ms = 5_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

describe("Claude Code CLI provider: status probe", () => {
  it("reports the installed version and its label when the CLI is current and signed in", async () => {
    expect(await providerFor().status()).toEqual({ ok: true, provider: "claude-cli", label: "Claude Code CLI (local login)", model: null, version: "2.1.310" });
  });

  it("reports not-installed for a nonexistent absolute path, without the path in the message", async () => {
    const status = await createCliProvider(cliConfig({ executable: "/nonexistent-zc/bin/claude" }), claudeCliProtocol).status();
    expect(status).toMatchObject({ ok: false, code: "not-installed" });
    expect(!status.ok && status.message).not.toContain("/nonexistent-zc");
    await expect(createCliProvider(cliConfig({ executable: "/nonexistent-zc/bin/claude" }), claudeCliProtocol).turn(request("hello").value)).rejects.toMatchObject({ code: "not-installed" });
  });

  it("refuses an old version and a CLI that lacks a required flag, naming what is missing", async () => {
    const old = await providerFor("old-version").status();
    expect(old).toMatchObject({ ok: false, code: "unsupported-version", version: "2.1.100" });
    expect(!old.ok && old.message).toContain(CLAUDE_CLI_MIN_VERSION);
    const missing = await providerFor("missing-flag").status();
    expect(missing).toMatchObject({ ok: false, code: "unsupported-version", version: "2.1.310" });
    expect(!missing.ok && missing.message).toContain("--safe-mode");
    expect(!missing.ok && missing.message).toContain("--permission-prompts");
    await expect(providerFor("missing-flag").turn(request("hello").value)).rejects.toMatchObject({ code: "unsupported" });
    expect(CLAUDE_CLI_REQUIRED_FLAGS).toContain("--restricted");
  });

  it("detects a signed-out CLI from its local auth status, before any model call", async () => {
    const record = join(await scratchRoot(), "argv.json");
    const provider = providerFor("logged-out", { FAKE_CLAUDE_RECORD: record });
    expect(await provider.status()).toMatchObject({ ok: false, code: "not-logged-in" });
    await expect(provider.turn(request("hello").value)).rejects.toMatchObject({ code: "auth" });
    await expect(access(record)).rejects.toThrow();
  });
});

describe("Claude Code CLI provider: one reply per invocation", () => {
  it("returns a text reply, reporting real progress only", async () => {
    const { value, activity } = request("hello");
    const turn = await providerFor("success", reply({ text: "Hi there.", tool_calls: [], stop: "end_turn" })).turn(value);
    expect(turn).toEqual({ content: [{ type: "text", text: "Hi there." }], stopReason: "end_turn" });
    expect(activity).toEqual(["Claude Code CLI (local login) started", "Claude Code CLI session ready", "Claude Code CLI received the model reply"]);
  });

  it("maps requested Composer tools to a tool_use turn, using the shared fake policy", async () => {
    const turn = await providerFor().turn(request('replace "A" with "B"').value);
    expect(turn).toEqual({ content: [{ type: "tool_use", id: "fake-0-0", name: "inspect_page", input: {} }], stopReason: "tool_use" });
  });

  it("decodes multi-byte characters split across separate writes", async () => {
    const text = "日本語のテキスト 🎉 café — ok";
    const turn = await providerFor("split-utf8", reply({ text, tool_calls: [], stop: "end_turn" })).turn(request("hello").value);
    expect(turn.content).toEqual([{ type: "text", text }]);
  });

  it.each([
    ["an unknown tool", { text: "", tool_calls: [{ id: "c1", name: "apply_draft", input_json: "{}" }], stop: "tool_use" }, "unknown tool"],
    ["a malformed call id", { text: "", tool_calls: [{ id: "bad id!", name: "inspect_page", input_json: "{}" }], stop: "tool_use" }, "tool_calls.0.id"],
    ["tool input that is not JSON", { text: "", tool_calls: [{ id: "c1", name: "inspect_page", input_json: "{nope" }], stop: "tool_use" }, "not JSON"],
    ["oversized reply text", { text: "x".repeat(100_001), tool_calls: [], stop: "end_turn" }, "text"],
    ["extra reply fields", { text: "", tool_calls: [], stop: "end_turn", apply: true }, "reply"],
  ])("Composer rejects %s even when the CLI accepted it", async (_label, value, detail) => {
    const error = await failure(providerFor("success", reply(value)).turn(request("hello").value));
    expect(error.code).toBe("malformed-output");
    expect(error.message).toContain(detail);
  });

  it.each([
    ["auth", "auth"],
    ["auth-retry", "auth"],
    ["quota", "quota"],
    ["overloaded", "overloaded"],
    ["crash-nonzero", "process-failed"],
    ["success-then-nonzero", "process-failed"],
    ["no-result", "malformed-output"],
    ["garbage-line", "malformed-output"],
    ["huge-line", "malformed-output"],
    ["max-turns", "malformed-output"],
    ["text-only", "malformed-output"],
    ["extra-tools", "unsupported"],
  ])("maps CLI mode %s to %s with short operator text", async (mode, code) => {
    const started = Date.now();
    const error = await failure(providerFor(mode).turn(request("hello").value));
    expect(error.code).toBe(code);
    // Fast failure: no mode waits for the invocation timeout.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(error.message.length).toBeLessThan(200);
    expect(error.message).not.toMatch(/\/home|\/tmp|Invalid API key|rate limited|not json|xxxx/);
  });
});

describe("Claude Code CLI provider: process boundary", () => {
  it("passes the prompt only on stdin, runs in a scratch directory outside the host, and uses the fixed restricted profile", async () => {
    const record = join(await scratchRoot(), "argv.json");
    const marker = "SITE-DATA-MARKER-7f3a";
    await providerFor("success", { FAKE_CLAUDE_RECORD: record, ...reply({ text: "ok", tool_calls: [], stop: "end_turn" }) }, { model: "claude-sonnet-5", effort: "low" })
      .turn(request(`Please edit ${marker}`, { system: `Memory: ${marker}` }).value);
    const seen = JSON.parse(await readFile(record, "utf8")) as { argv: string[]; cwd: string; stdinBytes: number };
    expect(seen.argv.join("\u0000")).not.toContain(marker);
    expect(seen.argv.join("\u0000")).not.toContain("Please edit");
    expect(seen.stdinBytes).toBeGreaterThan(marker.length);
    expect(seen.argv).toEqual(claudeCliArgs({ model: "claude-sonnet-5", effort: "low" }, structuredTurnJsonSchema(TOOLS)));
    for (const flag of ["--print", "--safe-mode", "--restricted", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"]) expect(seen.argv).toContain(flag);
    const pair = (flag: string) => seen.argv[seen.argv.indexOf(flag) + 1];
    expect([pair("--tools"), pair("--setting-sources"), pair("--permission-mode"), pair("--permission-prompts"), pair("--max-turns"), pair("--model"), pair("--effort")]).toEqual(["", "", "dontAsk", "none", "1", "claude-sonnet-5", "low"]);
    expect(seen.argv).not.toContain("--bare");
    expect(seen.argv.some(arg => /dangerously|bypassPermissions/.test(arg))).toBe(false);
    expect(seen.cwd.startsWith(await realpath(tmpdir()))).toBe(true);
    expect(seen.cwd).toMatch(/zudo-assistant-cli-/);
    expect(seen.cwd.startsWith(process.cwd())).toBe(false);
    await expect(access(seen.cwd)).rejects.toThrow();
  });

  it("withholds the API provider's Anthropic variables and Composer's own variables from the CLI", async () => {
    const record = join(await scratchRoot(), "env.json");
    await providerFor("success", { FAKE_CLAUDE_RECORD: record, ANTHROPIC_API_KEY: "api-provider-key", ANTHROPIC_AUTH_TOKEN: "token", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ZUDO_ASSISTANT_LIVE_API_KEY: "live", ...reply({ text: "ok", tool_calls: [], stop: "end_turn" }) })
      .turn(request("Hello").value);
    expect((JSON.parse(await readFile(record, "utf8")) as { envKeys: string[] }).envKeys).toEqual([]);
  });

  it("omits --model and --effort when the CLI defaults are used", () => {
    const args = claudeCliArgs({ model: null, effort: null }, structuredTurnJsonSchema(TOOLS));
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--effort");
  });

  it("Stop kills the whole process tree and ignores late output", async () => {
    const pidfile = join(await scratchRoot(), "grandchild.pid");
    const controller = new AbortController();
    const pending = providerFor("grandchild", { FAKE_CLAUDE_PIDFILE: pidfile }).turn(request("hello", { signal: controller.signal }).value);
    const pid = await waitFor(async () => Number(await readFile(pidfile, "utf8")) || undefined);
    expect(alive(pid)).toBe(true);
    controller.abort();
    expect((await failure(pending)).code).toBe("aborted");
    await waitFor(async () => (alive(pid) ? undefined : true), 2_000);

    const late = new AbortController();
    const latePending = providerFor("late-output").turn(request("hello", { signal: late.signal }).value);
    await new Promise(resolve => setTimeout(resolve, 400));
    late.abort();
    expect((await failure(latePending)).code).toBe("aborted");
  });

  it("the fake policy's wait request hangs until stopped", async () => {
    const controller = new AbortController();
    const pending = providerFor().turn(request("wait", { signal: controller.signal }).value);
    const outcome = await Promise.race([pending.then(() => "settled", () => "settled"), new Promise(resolve => setTimeout(() => resolve("waiting"), 800))]);
    expect(outcome).toBe("waiting");
    controller.abort();
    expect((await failure(pending)).code).toBe("aborted");
  });

  it("a timeout kills the whole process tree", async () => {
    const pidfile = join(await scratchRoot(), "grandchild.pid");
    const pending = providerFor("grandchild", { FAKE_CLAUDE_PIDFILE: pidfile }, { timeoutMs: 5_000 }).turn(request("hello").value);
    const pid = await waitFor(async () => Number(await readFile(pidfile, "utf8")) || undefined);
    expect((await failure(pending)).code).toBe("timeout");
    await waitFor(async () => (alive(pid) ? undefined : true), 2_000);
  }, 30_000);
});

describe("Claude Code CLI provider through the Assistant runner", () => {
  it('performs replace "A" with "B" through the fake CLI: inspect, propose, and the draft holds the change', async () => {
    const root = await scratchRoot();
    await cp(resolve("fixtures/edit-host"), root, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "native-edit-host", version: "1.0.0", type: "module", exports: { "./components": "./components/pack.mjs" }, dependencies: { preact: "10.27.2", "@zudo-composer/component-contract": "workspace:*" } }));
    await mkdir(join(root, "node_modules/@zudo-composer"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules/zudo-composer"), "dir");
    await symlink(resolve("node_modules/preact"), join(root, "node_modules/preact"), "dir");
    await symlink(resolve("node_modules/@zudo-composer/component-contract"), join(root, "node_modules/@zudo-composer/component-contract"), "dir");
    const host = await loadHostContext({ workspaceRoot: root });
    const options = { config: host.composerConfig, pack: host.pack, packIdentity: host.packIdentity };
    const site = defineSite({ id: "cli-proof", name: "CLI Proof", componentPack: host.pack });
    const home = site.page({ id: "home", name: "Home", root: [node("native.paragraph", { text: "Plan A starts today." }, {}, "paragraph")] });
    site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page: home } });
    await initializeAuthoringWorkspace({ composerConfig: host.composerConfig, pack: host.pack, project: site.toSiteProject(), workspaceId: "proof" });
    await createFilesystemAssetStore({ assetsStoreRoot: host.composerConfig.paths.assets });
    const service = createEditingService(options);
    const store = await openAssistantStore(host.composerConfig.paths.data);
    const config = cliConfig({ name: "CLI Bot" });
    const provider = createCliProvider(config, claudeCliProtocol, { ...process.env, FAKE_CLAUDE_MODE: "success" });
    const runner = createAssistantRunner({ store, service, provider, config, lease: { execute: action => action() }, capture: () => captureHost(options), siteName: capture => capture.workspace.metadata.name });
    const scope = { host: await realpath(root), workspaceId: "proof" };
    const homeJson = join(host.composerConfig.paths.compositions, "workspace-v1-proof", "composition-home.composition.json");
    const before = await readFile(homeJson, "utf8");
    const conversation = await store.createConversation(scope);
    const started = await runner.start("proof", { conversationId: conversation.id, clientTurnId: crypto.randomUUID(), text: 'replace "A" with "B"', context: { page: { sitemapId: "main", pageId: "home", title: "Home" }, selection: null, payloadIds: [] } });
    await runner.settled(started.runId);
    const run = await runner.run("proof", started.runId);
    expect(run.status).toBe("completed");
    const draft = await service.drafts.draft({ workspaceId: "proof" });
    expect(draft.draft?.operations).toHaveLength(1);
    expect(JSON.stringify(draft.draft?.changes)).toContain("Plan B starts today.");
    expect(await readFile(homeJson, "utf8")).toBe(before);
    const last = (await store.conversation(scope, conversation.id)).messages.at(-1)!;
    expect(last).toMatchObject({ role: "assistant", outcome: "completed" });
    expect(last.text).toContain("Proposed replacing");
  });
});
