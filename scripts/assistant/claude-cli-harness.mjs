#!/usr/bin/env node
// @ts-check
/**
 * Opt-in real-binary harness for the Claude Code CLI provider: real binary,
 * scripted model endpoint — not model inference. Never part of CI.
 *
 * It runs the INSTALLED `claude` through Composer's real provider code
 * (product argv profile, process runner and stream parser) against a loopback
 * scripted Anthropic Messages API, so every "model" reply is scripted here.
 * Harness-only additions, never used by the product:
 *   - a scrubbed environment built from nothing (the caller's environment,
 *     which may hold this machine's own Claude credentials, is never passed),
 *   - a temporary HOME (no personal login, settings, hooks or CLAUDE.md),
 *   - ANTHROPIC_BASE_URL at the scripted server and ANTHROPIC_API_KEY=test-key,
 *   - CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1,
 *   - HTTP(S)_PROXY at a loopback sink that refuses and records every proxied
 *     destination, with NO_PROXY=127.0.0.1,localhost.
 * The server refuses any credential other than test-key and never records a
 * credential value.
 *
 * Usage: tsx scripts/assistant/claude-cli-harness.mjs [--claude /abs/path/to/claude]
 * Writes verification/assistant/cli-harness/claude-cli-<version>.json.
 */
import { execFileSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createCliProvider } from "../../server/assistant/cli-provider.ts";
import { createCliScratch, removeCliScratch, runCliProcess, cliEnvironment } from "../../server/assistant/cli-process.ts";
import { CLAUDE_CLI_MIN_VERSION, CLAUDE_CLI_REQUIRED_FLAGS, CLAUDE_CLI_SYSTEM_PROMPT, claudeCliArgs, claudeCliProtocol } from "../../server/assistant/claude-cli-provider.ts";
import { ProviderError } from "../../server/assistant/provider.ts";
import { structuredTurnJsonSchema } from "../../server/assistant/structured-turn.ts";

const { AbortController } = globalThis;
const LABEL = "real binary, scripted model endpoint — not model inference";
const MARKER = "HARNESS-SITE-DATA-MARKER-3d9e";
const RUN_MARKER = `zc-claude-harness-${process.pid}-${Date.now()}`;

if (!["linux", "darwin"].includes(process.platform)) { console.error("The Claude Code CLI harness runs on Linux or macOS only."); process.exit(2); }
const argIndex = process.argv.indexOf("--claude");
const claude = argIndex > 0 ? process.argv[argIndex + 1] : findOnPath("claude");
if (!claude || !claude.startsWith("/") || !existsSync(claude)) { console.error("Pass the installed binary: --claude /absolute/path/to/claude (or put claude on PATH)."); process.exit(2); }

/** @param {string} name */
function findOnPath(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, name);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* next */ }
  }
  return undefined;
}

// ---- loopback scripted Messages API --------------------------------------------------------
/** @typedef {{ structured?: unknown, blocks?: { type: "text", text: string }[] | { type: "tool_use", name: string, input: unknown }[], status?: number, category?: string, hold?: boolean }} Turn */
/** @type {Turn[]} */
const queue = [];
/** @type {{ path: string, auth: string, model?: string, stream?: boolean, tools?: string[], systemHasMarker?: boolean, systemHasHarnessPrompt?: boolean, messagesHaveMarker?: boolean, bodyKeys?: string[], scenario: string }[]} */
const requests = [];
let scenario = "setup";
/** @type {(() => void) | undefined} */
let onHeld;
const api = createHttpServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const auth = req.headers["x-api-key"] === "test-key" ? "test-key" : (req.headers["x-api-key"] || req.headers.authorization) ? "other (refused, not recorded)" : "none";
  const path = (req.url ?? "").split("?")[0] ?? "";
  if (auth !== "test-key") {
    requests.push({ path, auth, scenario });
    res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "harness accepts only test-key" } })); return;
  }
  if (path !== "/v1/messages" || req.method !== "POST") { requests.push({ path, auth, scenario }); res.writeHead(404); res.end("{}"); return; }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const system = JSON.stringify(body.system ?? "");
  requests.push({ path, auth, scenario, model: body.model, stream: body.stream === true, tools: (body.tools ?? []).map((/** @type {{ name: string }} */ tool) => tool.name), systemHasMarker: system.includes(MARKER), systemHasHarnessPrompt: system.includes(CLAUDE_CLI_SYSTEM_PROMPT.slice(0, 60)), messagesHaveMarker: JSON.stringify(body.messages).includes(MARKER), bodyKeys: Object.keys(body).sort() });
  const turn = queue.shift() ?? { blocks: [{ type: "text", text: "(no scripted reply)" }] };
  if (turn.status) {
    res.writeHead(turn.status, { "content-type": "application/json", "retry-after": "0" });
    res.end(JSON.stringify({ type: "error", error: { type: turn.category ?? "api_error", message: "scripted failure" } })); return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (/** @type {string} */ event, /** @type {unknown} */ data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const id = `msg_harness_${requests.length}`;
  send("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  if (turn.hold) { onHeld?.(); await new Promise(resolve => req.socket.on("close", resolve)); return; }
  /** @type {any[]} */
  const blocks = turn.blocks ?? [{ type: "tool_use", name: "StructuredOutput", input: turn.structured }];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_harness_${requests.length}_${index}`, name: block.name, input: {} } });
      send("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    send("content_block_stop", { type: "content_block_stop", index });
  });
  send("message_delta", { type: "message_delta", delta: { stop_reason: blocks.some(block => block.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
  send("message_stop", { type: "message_stop" });
  res.end();
});
await new Promise(resolve => api.listen(0, "127.0.0.1", () => resolve(undefined)));
const apiPort = /** @type {import("node:net").AddressInfo} */ (api.address()).port;

// ---- proxy sink: refuses and records every destination the CLI tries to reach via proxy -----
/** @type {string[]} */
const proxied = [];
const sink = createNetServer(socket => {
  socket.once("data", data => { const line = data.toString("latin1").split("\r\n")[0] ?? ""; proxied.push(line.replace(/^(\w+) (https?:\/\/)?([^/ ]+).*$/, "$1 $3")); socket.destroy(); });
  socket.on("error", () => {});
});
await new Promise(resolve => sink.listen(0, "127.0.0.1", () => resolve(undefined)));
const sinkPort = /** @type {import("node:net").AddressInfo} */ (sink.address()).port;

// ---- scrubbed environment ------------------------------------------------------------------
const home = await mkdtemp(join(tmpdir(), "zc-claude-harness-home-"));
const outside = await mkdtemp(join(tmpdir(), "zc-claude-harness-target-"));
await writeFile(join(outside, "existing.txt"), "original\n");
/** @type {NodeJS.ProcessEnv} */
const env = {
  PATH: [dirname(process.execPath), dirname(claude), "/usr/bin", "/bin"].join(delimiter),
  HOME: home, TMPDIR: tmpdir(), LANG: "C.UTF-8",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${apiPort}`,
  ANTHROPIC_API_KEY: "test-key",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  HTTPS_PROXY: `http://127.0.0.1:${sinkPort}`, HTTP_PROXY: `http://127.0.0.1:${sinkPort}`,
  https_proxy: `http://127.0.0.1:${sinkPort}`, http_proxy: `http://127.0.0.1:${sinkPort}`,
  NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost",
  ZC_HARNESS_RUN: RUN_MARKER,
};

const config = /** @type {import("../../server/config/assistant").CliAssistantConfig} */ ({ provider: "claude-cli", executable: claude, model: null, effort: null, timeoutMs: 60_000, name: "Harness", permission: "propose" });
// Harness only: the scripted endpoint and test key travel in ANTHROPIC_* variables, which the product profile withholds.
const provider = createCliProvider(config, { ...claudeCliProtocol, excludedEnv: [] }, env);
/** @type {import("../../server/assistant/provider").ToolSpec[]} */
const tools = [
  { name: "inspect_page", description: "Inspect the current page.", inputSchema: { type: "object", properties: {} } },
  { name: "propose_changes", description: "Propose field changes.", inputSchema: { type: "object", properties: { operations: { type: "array" } } } },
];
/** @param {AbortSignal} [signal] @returns {import("../../server/assistant/provider").ProviderRequest} */
const request = signal => ({
  system: `You are the site assistant. Site Memory: ${MARKER}`,
  messages: [{ role: "user", content: [{ type: "text", text: `Rewrite the hero. Page text: ${MARKER}\n\n<turn_context>\nCurrent page: Home (sitemapId "main", pageId "home")\n</turn_context>` }] }],
  tools, signal: signal ?? new AbortController().signal, onText: () => {}, onActivity: () => {},
});

/** Processes still carrying this run's marker (the CLI and anything it started). */
function markedProcesses() {
  if (process.platform === "linux") {
    return readdirSync("/proc").filter(entry => /^\d+$/.test(entry)).filter(pid => {
      try {
        if (/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"))) return false;
        return readFileSync(`/proc/${pid}/environ`, "latin1").includes(RUN_MARKER);
      } catch { return false; }
    }).map(Number);
  }
  return execFileSync("ps", ["-axeww", "-o", "pid=,command="], { encoding: "utf8" }).split("\n").filter(line => line.includes(RUN_MARKER)).map(line => Number(line.trim().split(/\s+/)[0]));
}

/** @type {Record<string, unknown>[]} */
const scenarios = [];
/** @param {string} name @param {() => Promise<Record<string, unknown>>} body */
async function scenarioRun(name, body) {
  scenario = name;
  const before = requests.length;
  const started = Date.now();
  /** @type {Record<string, unknown>} */
  let outcome;
  try { outcome = await body(); } catch (error) { outcome = { pass: false, error: error instanceof Error ? error.message : String(error) }; }
  const own = requests.slice(before);
  /** @type {Record<string, unknown>} */
  const entry = { name, ...outcome, modelRequests: own.filter(item => item.path === "/v1/messages").length, ms: Date.now() - started };
  scenarios.push(entry);
  console.log(`${entry.pass ? "PASS" : "FAIL"} ${name}`, JSON.stringify(outcome));
  queue.length = 0;
}
/** @param {Promise<unknown>} promise */
const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, code: error instanceof ProviderError ? error.code : "thrown", message: error instanceof Error ? error.message : String(error) }));

const status = await provider.status();
const version = status.version ?? "unknown";
console.log(`${LABEL}\nClaude Code ${version}; status ${status.ok ? "ok" : `${status.code}`}`);

await scenarioRun("status probe (version, help flags, local auth status)", async () => ({ pass: status.ok && status.version !== null, status: status.ok ? "ok" : status.code }));

await scenarioRun("argv carries no prompt or site data", async () => {
  const { args } = await claudeCliProtocol.prepare({ config, scratch: "/unused", schema: structuredTurnJsonSchema(tools), version });
  return { pass: !args.join("\u0000").includes(MARKER) && !args.includes("--bare") && args.includes("--safe-mode") && args.includes("--restricted") };
});

await scenarioRun("init event: what the restricted session exposes", async () => {
  queue.push({ structured: { text: "ok", tool_calls: [], stop: "end_turn" } });
  const scratch = await createCliScratch();
  /** @type {Record<string, unknown> | undefined} */
  let init;
  try {
    await runCliProcess({ executable: claude, args: claudeCliArgs(config, structuredTurnJsonSchema(tools)), env: cliEnvironment({}, env), cwd: scratch, stdin: "Reply ok.", timeoutMs: 60_000, signal: new AbortController().signal, onLine: line => { try { const event = JSON.parse(line); if (event.type === "system" && event.subtype === "init") init = event; } catch { /* ignored */ } } });
  } finally { await removeCliScratch(scratch); }
  if (!init) return { pass: false };
  const summary = {
    tools: init.tools, mcp_servers: init.mcp_servers, permissionMode: init.permissionMode, slash_commands: init.slash_commands, skills: init.skills,
    apiKeySource: init.apiKeySource, plugins: Array.isArray(init.plugins) ? init.plugins.map((/** @type {{ name: string }} */ plugin) => plugin.name) : init.plugins,
    agents: init.agents, claude_code_version: init.claude_code_version,
  };
  return { pass: JSON.stringify(init.tools) === JSON.stringify(["StructuredOutput"]) && Array.isArray(init.mcp_servers) && init.mcp_servers.length === 0 && init.apiKeySource === "ANTHROPIC_API_KEY", init: summary };
});

await scenarioRun("normal structured reply", async () => {
  queue.push({ structured: { text: "Hello from the scripted model.", tool_calls: [], stop: "end_turn" } });
  const result = await settle(provider.turn(request()));
  const sent = requests.at(-1);
  return {
    pass: result.ok && JSON.stringify(/** @type {any} */ (result).value) === JSON.stringify({ content: [{ type: "text", text: "Hello from the scripted model." }], stopReason: "end_turn" }) && sent?.systemHasMarker === false && sent?.messagesHaveMarker === true,
    result, toolsOfferedToModel: sent?.tools, systemPromptHasSiteData: sent?.systemHasMarker, systemPromptIsComposerFixedText: sent?.systemHasHarnessPrompt, siteDataInUserMessage: sent?.messagesHaveMarker, requestBodyKeys: sent?.bodyKeys,
  };
});

await scenarioRun("reply requesting Composer tools", async () => {
  queue.push({ structured: { text: "", tool_calls: [{ id: "call_1", name: "inspect_page", input_json: "{}" }], stop: "tool_use" } });
  const result = await settle(provider.turn(request()));
  return { pass: result.ok && JSON.stringify(/** @type {any} */ (result).value) === JSON.stringify({ content: [{ type: "tool_use", id: "call_1", name: "inspect_page", input: {} }], stopReason: "tool_use" }), result };
});

const builtins = () => [
  { type: /** @type {const} */ ("tool_use"), name: "Write", input: { file_path: join(outside, "written.txt"), content: "pwned" } },
  { type: /** @type {const} */ ("tool_use"), name: "Edit", input: { file_path: join(outside, "existing.txt"), old_string: "original", new_string: "pwned" } },
  { type: /** @type {const} */ ("tool_use"), name: "Bash", input: { command: `touch ${join(outside, "bash.txt")}` } },
];
const untouched = async () => !existsSync(join(outside, "written.txt")) && !existsSync(join(outside, "bash.txt")) && (await readFile(join(outside, "existing.txt"), "utf8")) === "original\n";

await scenarioRun("model attempts built-in Write/Edit/Bash only", async () => {
  queue.push({ blocks: builtins() }, { structured: { text: "second request must not happen", tool_calls: [], stop: "end_turn" } });
  const result = await settle(provider.turn(request()));
  const clean = await untouched();
  return { pass: !result.ok && clean && queue.length === 1, result, filesystemUntouched: clean, secondModelRequest: queue.length === 0 };
});

await scenarioRun("model attempts built-in tools alongside StructuredOutput", async () => {
  queue.push({ blocks: [...builtins(), { type: "tool_use", name: "StructuredOutput", input: { text: "done", tool_calls: [], stop: "end_turn" } }] });
  const result = await settle(provider.turn(request()));
  const clean = await untouched();
  return { pass: clean, result, filesystemUntouched: clean };
});

await scenarioRun("model answers in plain text instead of the schema", async () => {
  queue.push({ blocks: [{ type: "text", text: '{"text":"plain","tool_calls":[],"stop":"end_turn"}' }] });
  const result = await settle(provider.turn(request()));
  return { pass: !result.ok && /** @type {any} */ (result).code === "malformed-output", result };
});

for (const [status, category, expected] of /** @type {const} */ ([[401, "authentication_error", "auth"], [429, "rate_limit_error", "quota"], [529, "overloaded_error", "overloaded"]])) {
  await scenarioRun(`HTTP ${status} → ${expected}`, async () => {
    for (let index = 0; index < 12; index++) queue.push({ status, category });
    const result = await settle(provider.turn(request()));
    return { pass: !result.ok && /** @type {any} */ (result).code === expected, result };
  });
}

await scenarioRun("Stop mid-stream terminates the process tree", async () => {
  queue.push({ hold: true });
  const controller = new AbortController();
  const held = new Promise(resolve => { onHeld = () => resolve(undefined); });
  const pending = settle(provider.turn(request(controller.signal)));
  await held;
  const during = markedProcesses().length;
  controller.abort();
  const result = await pending;
  await new Promise(resolve => setTimeout(resolve, 300));
  const after = markedProcesses();
  return { pass: !result.ok && /** @type {any} */ (result).code === "aborted" && during > 0 && after.length === 0, result, processesWhileRunning: during, processesAfterStop: after.length };
});

const otherAuth = requests.filter(item => item.auth !== "test-key");
const nonModel = requests.filter(item => item.path !== "/v1/messages");
const evidence = {
  label: LABEL,
  generatedAt: new Date().toISOString(),
  claudeCodeVersion: version,
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  provider: { label: claudeCliProtocol.label, minVersion: CLAUDE_CLI_MIN_VERSION, requiredHelpFlags: CLAUDE_CLI_REQUIRED_FLAGS },
  productArgv: claudeCliArgs(config, { "$comment": "structuredTurnJsonSchema(tools)" }).map(arg => (arg.startsWith("{\"$comment\"") ? "<structuredTurnJsonSchema(request.tools)>" : arg)),
  harnessEnvironmentKeys: Object.keys(env).sort(),
  scenarios,
  network: {
    modelRequestsAtScriptedServer: requests.filter(item => item.path === "/v1/messages").length,
    requestsWithOtherCredentials: otherAuth.length,
    nonModelRequestsAtScriptedServer: nonModel.map(item => `${item.path} (${item.scenario})`),
    proxiedDestinationsRefused: proxied,
  },
  pass: scenarios.every(item => item.pass) && otherAuth.length === 0,
};
const out = resolve("verification/assistant/cli-harness", `claude-cli-${version}.json`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(evidence, null, 2).split(home).join("<harness-home>").split(outside).join("<harness-target>")}\n`);
console.log(`${evidence.pass ? "PASS" : "FAIL"}: evidence written to verification/assistant/cli-harness/claude-cli-${version}.json`);
await rm(home, { recursive: true, force: true });
await rm(outside, { recursive: true, force: true });
api.closeAllConnections(); api.close(); sink.close();
process.exit(evidence.pass ? 0 : 1);
