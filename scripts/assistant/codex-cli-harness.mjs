#!/usr/bin/env node
// @ts-check
/**
 * Opt-in real-binary harness for the Codex CLI provider. Never part of CI and
 * never model inference: it runs the INSTALLED `codex` with Composer's product
 * profile against a loopback scripted Responses API, so every "model" reply is
 * scripted here. Harness-only additions, never used by the product:
 *   - a temporary HOME/CODEX_HOME (no personal login, config or AGENTS.md),
 *   - a custom model provider pointing at the scripted loopback server,
 *   - a dummy key in the environment,
 *   - HTTP(S)_PROXY/ALL_PROXY at a loopback sink that refuses and records
 *     every proxied destination, with NO_PROXY=127.0.0.1,localhost.
 *
 * Usage: tsx scripts/assistant/codex-cli-harness.mjs --codex /abs/path/to/codex
 * Writes verification/assistant/cli-harness/codex-cli-<version>.json.
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startScriptedResponsesApi, responseEvents as E } from "../fixtures/assistant/scripted-responses-api.mjs";
import { createCliProvider } from "../../server/assistant/cli-provider.ts";
import { CODEX_CLI_MIN_VERSION, CODEX_CLI_PROFILE, codexCliProtocol, codexExecArgs } from "../../server/assistant/codex-cli-provider.ts";
import { ProviderError } from "../../server/assistant/provider.ts";

const argIndex = process.argv.indexOf("--codex");
const codex = argIndex > 0 ? process.argv[argIndex + 1] : process.env.CODEX_HARNESS_EXECUTABLE;
if (!codex || !codex.startsWith("/") || !existsSync(codex)) {
  console.error("Pass the installed binary: --codex /absolute/path/to/codex (or CODEX_HARNESS_EXECUTABLE).");
  process.exit(2);
}
if (!["linux", "darwin"].includes(process.platform)) { console.error("The Codex CLI harness runs on Linux or macOS only."); process.exit(2); }

const DUMMY_KEY = "harness-dummy-key-not-a-secret";
const MARKER = "HARNESS-PROMPT-MARKER-5c1e";
const AGENTS_MARKER = "HARNESS-GLOBAL-AGENTS-MARKER-91b2";
const PROJECT_AGENTS_MARKER = "HARNESS-PROJECT-AGENTS-MARKER-77d0";
const MODELS = ["gpt-5.5", "gpt-6-sol"];
const tools = [
  { name: "suggest_wording", description: "Offer wording.", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "inspect_page", description: "Inspect.", inputSchema: { type: "object", properties: {} } },
];
const goodReply = JSON.stringify({ text: "", tool_calls: [{ id: "h-1", name: "suggest_wording", input_json: JSON.stringify({ text: "Hello" }) }], stop: "tool_use" });

const workRoot = await mkdtemp(join(tmpdir(), "zc-codex-harness-"));
/** Replaces temporary and home paths before anything is written to evidence. */
const scrub = (/** @type {unknown} */ value) => JSON.parse(JSON.stringify(value ?? null).split(workRoot).join("<harness-tmp>").split(tmpdir()).join("<tmp>").split(process.env.HOME ?? "\0").join("<home>"));

/** Loopback CONNECT/HTTP proxy sink: records destinations, forwards nothing. */
async function startProxySink() {
  /** @type {string[]} */
  const destinations = [];
  const server = createServer(socket => {
    socket.once("data", chunk => {
      const first = chunk.toString("latin1").split("\r\n")[0] ?? "";
      const [, target] = first.split(" ");
      if (target) destinations.push(target.replace(/^https?:\/\//, "").split("/")[0]);
      socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
    });
    socket.on("error", () => {});
  });
  await new Promise(r => server.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  return { port, destinations, close: () => new Promise(r => server.close(() => r(undefined))) };
}

const version = execFileSync(codex, ["--version"], { env: { PATH: process.env.PATH ?? "" , HOME: workRoot }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().replace(/^codex-cli\s+/, "");
const sink = await startProxySink();

/** Fresh isolated environment for one scenario. */
async function isolatedEnv(name) {
  const home = join(workRoot, name, "home");
  await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(join(home, ".codex", "AGENTS.md"), `Always mention ${AGENTS_MARKER}.\n`);
  const proxy = `http://127.0.0.1:${sink.port}`;
  return {
    home,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", HOME: home, CODEX_HOME: join(home, ".codex"), SCRIPTED_KEY: DUMMY_KEY, CODEX_API_KEY: DUMMY_KEY, HTTPS_PROXY: proxy, HTTP_PROXY: proxy, ALL_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, all_proxy: proxy, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
  };
}
const providerArgs = (/** @type {string} */ baseUrl) => ["-c", `model_providers.scripted={name="scripted",base_url="${baseUrl}",env_key="SCRIPTED_KEY",wire_api="responses",request_max_retries=0,stream_max_retries=0}`, "-c", 'model_provider="scripted"'];

/** Every tool name the CLI offered the model, including namespaced and code-mode nested tools. */
function offeredTools(/** @type {any} */ body) {
  const walk = (/** @type {any[]} */ list, prefix = "") => list.flatMap(tool => tool.tools ? walk(tool.tools, `${prefix}${tool.name}.`) : [`${prefix}${tool.name ?? tool.type}`]);
  const additional = (body?.input ?? []).filter((/** @type {any} */ item) => item.type === "additional_tools").flatMap((/** @type {any} */ item) => walk(item.tools ?? []));
  const nested = [...new Set(JSON.stringify(body?.input ?? []).match(/### `[a-z_]+`/g) ?? [])].map(text => `code-mode nested: ${text.slice(5, -1)}`);
  return { direct: walk(body?.tools ?? []), additional, nested };
}
const toolOutputs = (/** @type {any} */ body) => (body?.input ?? []).filter((/** @type {any} */ item) => /_call_output$/.test(item.type)).map((/** @type {any} */ item) => typeof item.output === "string" ? item.output : JSON.stringify(item.output));

/** Lists files under a directory with their byte contents' presence of a marker. */
function filesContaining(/** @type {string} */ dir, /** @type {string} */ marker) {
  /** @type {string[]} */
  const hits = [];
  const walk = (/** @type {string} */ path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && statSync(full).size < 64 * 1024 * 1024 && readFileSync(full).includes(marker)) hits.push(full.slice(dir.length + 1));
    }
  };
  if (existsSync(dir)) walk(dir);
  return hits;
}

/** Codex processes still running for a given scratch directory (matched on their argv). */
function processesFor(/** @type {string} */ needle) {
  const out = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return out.split("\n").filter(line => line.includes(needle) && !line.includes("ps -axo")).map(line => Number(line.trim().split(/\s+/)[0])).filter(Boolean);
}

/**
 * One product-path turn: Composer's real codexCliProtocol, plus only the
 * harness provider override inserted before the final "-" argument.
 */
async function productTurn({ name, model, respond, text = `suggest "${MARKER}"`, extraArgs = /** @type {string[]} */ ([]), plantScratch = async (/** @type {string} */ dir) => { void dir; }, onStart = (/** @type {string} */ scratch) => { void scratch; }, signal = new globalThis.AbortController().signal }) {
  const api = await startScriptedResponsesApi({ dummyKey: DUMMY_KEY, respond });
  const { env, home } = await isolatedEnv(name);
  /** @type {string[]} */
  let scratchAfter = [];
  let scratchPath = "";
  const protocol = {
    ...codexCliProtocol,
    async prepare(/** @type {any} */ context) {
      const prepared = await codexCliProtocol.prepare(context);
      scratchPath = context.scratch;
      await plantScratch(context.scratch);
      onStart(context.scratch);
      const args = [...prepared.args];
      args.splice(args.length - 1, 0, ...providerArgs(api.baseUrl), ...extraArgs);
      return { ...prepared, args };
    },
    createParser() {
      const parser = codexCliProtocol.createParser();
      return { line: parser.line, finish(/** @type {any} */ exit) { scratchAfter = existsSync(scratchPath) ? readdirSync(scratchPath).sort() : []; return parser.finish(exit); } };
    },
  };
  const config = { provider: /** @type {const} */ ("codex-cli"), executable: codex, model, effort: /** @type {const} */ ("low"), timeoutMs: 90_000, name: "AI Assistant", permission: /** @type {const} */ ("apply") };
  /** @type {string[]} */
  const activity = [];
  const request = { system: "Harness system rules.", messages: [{ role: /** @type {const} */ ("user"), content: [{ type: /** @type {const} */ ("text"), text: `${text}\n\n<turn_context>\nCurrent page: Home (sitemapId "main", pageId "home")\n</turn_context>` }] }], tools, signal, onText: () => {}, onActivity: (/** @type {string} */ label) => activity.push(label) };
  const provider = createCliProvider(config, /** @type {any} */ (protocol), env);
  const status = await provider.status();
  let result, error;
  try { result = await provider.turn(request); } catch (caught) { error = caught instanceof ProviderError ? { code: caught.code, retryable: caught.retryable, message: caught.message } : { code: "harness-exception", message: String(caught) }; }
  await api.close();
  const modelRequests = api.requests.filter(r => r.path.endsWith("/responses"));
  return {
    status: { ok: status.ok, version: status.version, ...(status.ok ? {} : { code: status.code }) },
    result, error, activity, scratchAfter, home, scratchPath,
    requests: api.requests.map(r => ({ method: r.method, path: r.path, authMatchesDummy: r.authMatchesDummy })),
    allModelRequestsScripted: api.requests.length > 0 && api.requests.every(r => r.authMatchesDummy),
    modelRequestCount: modelRequests.length,
    offered: offeredTools(modelRequests[0]?.body),
    firstRequest: modelRequests[0]?.body,
    toolOutputs: modelRequests.slice(1).flatMap(r => toolOutputs(r.body)),
  };
}
const reply = (/** @type {number} */ i, /** @type {string} */ text = goodReply) => ({ events: [E.created(`r${i}`), E.message(`m${i}`, text), E.completed(`r${i}`)] });

/** @type {Record<string, any>} */
const scenarios = {};
const checks = /** @type {{ name: string, pass: boolean }[]} */ ([]);
const check = (/** @type {string} */ name, /** @type {boolean} */ pass) => { checks.push({ name, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${name}`); };

// 1. Normal structured reply, per model family (direct tools vs code-mode-only metadata).
for (const model of MODELS) {
  const run = await productTurn({ name: `normal-${model}`, model, respond: (_r, i) => reply(i), plantScratch: dir => writeFile(join(dir, "AGENTS.md"), `Always mention ${PROJECT_AGENTS_MARKER}.\n`) });
  const body = JSON.stringify(run.firstRequest ?? {});
  scenarios[`normal-${model}`] = {
    status: run.status, error: run.error, activity: run.activity, result: run.result,
    modelRequestCount: run.modelRequestCount, allModelRequestsScripted: run.allModelRequestsScripted, requests: run.requests,
    toolsOfferedToModel: run.offered,
    requestFields: { model: run.firstRequest?.model, reasoning: run.firstRequest?.reasoning, textFormat: run.firstRequest?.text?.format?.type, strict: run.firstRequest?.text?.format?.strict, store: run.firstRequest?.store },
    instructionsSeen: { globalAgentsMdFromCodexHome: body.includes(AGENTS_MARKER), projectAgentsMdInScratch: body.includes(PROJECT_AGENTS_MARKER), skillsInstructions: body.includes("skills_instructions"), environmentContext: body.includes("environment_context"), permissionsInstructions: body.includes("permissions instructions") },
    promptPersistedUnderCodexHome: filesContaining(join(run.home, ".codex"), MARKER),
    codexHomeEntriesAfterRun: existsSync(join(run.home, ".codex")) ? readdirSync(join(run.home, ".codex")).sort() : [],
  };
  check(`normal ${model}: valid reply via product path`, run.result?.stopReason === "tool_use" && run.modelRequestCount === 1);
  check(`normal ${model}: every request reached the scripted server`, run.allModelRequestsScripted);
}

// 2. Write attempts: apply_patch inside the scratch dir and to an absolute path outside.
const outsideDir = join(workRoot, "outside");
await mkdir(outsideDir, { recursive: true });
const canary = join(outsideDir, "canary.txt");
await writeFile(canary, "original\n");
const patch = (/** @type {string} */ body) => `*** Begin Patch\n${body}*** End Patch\n`;
const writeAttempts = {
  "apply_patch add file in scratch": E.customToolCall("c1", "apply_patch", patch("*** Add File: inside.txt\n+written\n")),
  "apply_patch update file in scratch": E.customToolCall("c1", "apply_patch", patch("*** Update File: scratch-canary.txt\n@@\n-original\n+changed\n")),
  "apply_patch add file outside (absolute)": E.customToolCall("c1", "apply_patch", patch(`*** Add File: ${join(outsideDir, "added.txt")}\n+written\n`)),
  "apply_patch update file outside (absolute)": E.customToolCall("c1", "apply_patch", patch(`*** Update File: ${canary}\n@@\n-original\n+changed\n`)),
  "shell write outside (exec_command)": E.functionCall("c1", "exec_command", JSON.stringify({ cmd: `echo written > ${join(outsideDir, "shell.txt")}` })),
  "shell write outside (shell_command)": E.functionCall("c1", "shell_command", JSON.stringify({ command: `echo written > ${join(outsideDir, "shell2.txt")}` })),
  "code-mode exec calling apply_patch": E.customToolCall("c1", "exec", `await tools.apply_patch(${JSON.stringify(patch(`*** Update File: ${canary}\n@@\n-original\n+changed\n`))});`),
};
for (const model of MODELS) {
  for (const [label, call] of Object.entries(writeAttempts)) {
    const run = await productTurn({ name: `write-${model}-${label.replace(/\W+/g, "-")}`, model, respond: (_r, i) => i === 0 ? { events: [E.created("r0"), call, E.completed("r0")] } : reply(i), plantScratch: dir => writeFile(join(dir, "scratch-canary.txt"), "original\n") });
    const unchanged = readFileSync(canary, "utf8") === "original\n" && !existsSync(join(outsideDir, "added.txt")) && !existsSync(join(outsideDir, "shell.txt")) && !existsSync(join(outsideDir, "shell2.txt"));
    const scratchClean = !run.scratchAfter.includes("inside.txt");
    scenarios[`write ${model}: ${label}`] = { error: run.error, resultStop: run.result?.stopReason, modelRequestCount: run.modelRequestCount, toolOutputReturnedToModel: run.toolOutputs, scratchAfter: run.scratchAfter, outsideUnchanged: unchanged, allModelRequestsScripted: run.allModelRequestsScripted };
    check(`write ${model}: ${label} → no file changed`, unchanged && scratchClean);
  }
}
const scratchCanaryUnchanged = Object.entries(scenarios).filter(([key]) => key.includes("update file in scratch")).every(([, value]) => !String(value.toolOutputReturnedToModel).includes("Success"));
check("apply_patch update in scratch never reported success", scratchCanaryUnchanged);

// 3. Shell read attempt with the product profile, then a sandbox-only variant (shell re-enabled, harness only).
for (const model of MODELS) {
  const run = await productTurn({ name: `read-${model}`, model, respond: (_r, i) => i === 0 ? { events: [E.created("r0"), E.functionCall("c1", "exec_command", JSON.stringify({ cmd: `cat ${canary}` })), E.completed("r0")] } : reply(i) });
  scenarios[`shell read ${model}`] = { error: run.error, resultStop: run.result?.stopReason, toolOutputReturnedToModel: run.toolOutputs, canaryContentReachedModel: run.toolOutputs.some(text => text.includes("original")) };
}
{
  // Defense in depth: the same profile minus the shell restrictions, spawned raw, to show what the read-only sandbox itself does.
  const api = await startScriptedResponsesApi({ dummyKey: DUMMY_KEY, respond: (_r, i) => i === 0 ? { events: [E.created("r0"), E.functionCall("c1", "exec_command", JSON.stringify({ cmd: `echo written > ${join(outsideDir, "sandbox.txt")}; echo written > inside-sandbox.txt; cat ${canary}` })), E.completed("r0")] } : reply(i) });
  const { env } = await isolatedEnv("sandbox-variant");
  const scratch = await mkdtemp(join(workRoot, "sandbox-scratch-"));
  await writeFile(join(scratch, "schema.json"), JSON.stringify({ type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } }));
  const args = codexExecArgs({ model: "gpt-5.5", effort: null }, scratch, join(scratch, "schema.json"));
  const variant = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === "--disable" && ["shell_tool", "unified_exec"].includes(args[i + 1])) { i++; continue; } variant.push(args[i]); }
  variant.splice(variant.length - 1, 0, ...providerArgs(api.baseUrl));
  const child = spawn(codex, variant, { cwd: scratch, env, stdio: ["pipe", "pipe", "ignore"] });
  let stdout = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stdin.end("Harness sandbox probe.");
  const code = await new Promise(r => child.on("close", c => r(c)));
  await api.close();
  const events = stdout.split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return { unparsable: true }; } });
  const command = events.find(event => event.item?.type === "command_execution" && event.type === "item.completed")?.item;
  scenarios["sandbox-only variant (shell re-enabled, harness only)"] = {
    exitCode: code, eventTypes: events.map(event => event.item ? `${event.type}:${event.item.type}` : event.type),
    commandOutput: command?.aggregated_output, outsideWritten: existsSync(join(outsideDir, "sandbox.txt")), scratchWritten: existsSync(join(scratch, "inside-sandbox.txt")),
    readSucceeded: String(command?.aggregated_output ?? "").includes("original"),
    productParserWouldRefuse: events.some(event => event.item?.type === "command_execution"),
  };
  check("sandbox variant: read-only sandbox blocked both writes", !existsSync(join(outsideDir, "sandbox.txt")) && !existsSync(join(scratch, "inside-sandbox.txt")));
}

// 4. Errors mapped through the product path.
const errorScripts = {
  "401 persistent": () => ({ status: 401, body: { error: { message: "Incorrect API key", code: "invalid_api_key" } } }),
  "429 usage limit": () => ({ status: 429, body: { error: { type: "usage_limit_reached", message: "The usage limit has been reached", plan_type: "plus", resets_at: 1890000000 } } }),
  "429 insufficient quota": () => ({ status: 429, body: { error: { type: "insufficient_quota", code: "insufficient_quota", message: "You exceeded your current quota" } } }),
  "400 invalid request": () => ({ status: 400, body: { error: { type: "invalid_request_error", message: "Invalid schema for response_format" } } }),
};
const expectedCodes = { "401 persistent": "auth", "429 usage limit": "quota", "429 insufficient quota": "quota", "400 invalid request": "invalid-request" };
for (const [label, respond] of Object.entries(errorScripts)) {
  const run = await productTurn({ name: `error-${label.replace(/\W+/g, "-")}`, model: "gpt-5.5", respond });
  scenarios[`error ${label}`] = { error: run.error, modelRequestCount: run.modelRequestCount, allModelRequestsScripted: run.allModelRequestsScripted };
  check(`error ${label} → ${expectedCodes[/** @type {keyof typeof expectedCodes} */ (label)]}`, run.error?.code === expectedCodes[/** @type {keyof typeof expectedCodes} */ (label)]);
}
{
  const run = await productTurn({ name: "config-rejected", model: "gpt-5.5", respond: (_r, i) => reply(i), extraArgs: ["-c", "harness_unknown_key=1"] });
  scenarios["unknown override key under --strict-config"] = { error: run.error, modelRequestCount: run.modelRequestCount };
  check("unknown override key → unsupported, no model request", run.error?.code === "unsupported" && run.modelRequestCount === 0);
}

// 5. Abort mid-stream: the scripted model holds the stream open; Stop must end the whole process tree.
{
  const controller = new globalThis.AbortController();
  let scratch = "";
  let firstRequest = /** @type {(value?: unknown) => void} */ (() => {});
  const requested = new Promise(r => { firstRequest = r; });
  const pending = productTurn({ name: "abort", model: "gpt-5.5", signal: controller.signal, onStart: dir => { scratch = dir; }, respond: () => { firstRequest(); return { hang: true }; } });
  await requested;
  const before = processesFor(scratch);
  controller.abort();
  const run = await pending;
  await new Promise(r => setTimeout(r, 500));
  const after = processesFor(scratch);
  scenarios["abort mid-stream"] = { error: run.error, processesBeforeStop: before.length, processesAfterStop: after.length };
  check("abort → aborted and no codex process left", run.error?.code === "aborted" && before.length > 0 && after.length === 0);
}

await sink.close();
const evidence = scrub({
  label: "real binary, scripted model endpoint — not model inference",
  codexVersion: version, minimumSupportedVersion: CODEX_CLI_MIN_VERSION,
  platform: `${process.platform}-${process.arch}`,
  generatedBy: "scripts/assistant/codex-cli-harness.mjs",
  productProfile: CODEX_CLI_PROFILE,
  harnessOnlyAdditions: ["temporary HOME and CODEX_HOME (with an AGENTS.md marker)", "-c model_providers.scripted={... base_url=loopback, env_key=SCRIPTED_KEY, retries 0} and -c model_provider=\"scripted\"", "dummy SCRIPTED_KEY/CODEX_API_KEY", "HTTP(S)_PROXY/ALL_PROXY at a refusing loopback sink, NO_PROXY=127.0.0.1,localhost", "sandbox-only variant drops --disable shell_tool/unified_exec"],
  proxiedDestinationsAttempted: [...new Set(sink.destinations)].sort(),
  checks, scenarios,
});
const outDir = resolve("verification/assistant/cli-harness");
await mkdir(outDir, { recursive: true });
const outFile = join(outDir, `codex-cli-${version}.json`);
await writeFile(outFile, `${JSON.stringify(evidence, null, 2)}\n`);
await rm(workRoot, { recursive: true, force: true });
const failed = checks.filter(entry => !entry.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Evidence: ${outFile.slice(process.cwd().length + 1)}`);
process.exit(failed.length ? 1 : 0);
