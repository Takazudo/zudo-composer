#!/usr/bin/env node
// @ts-check
// Test-only stand-in for the `claude` executable. It answers `--version`,
// `--help` and `auth status`, and for a print run reads the stdin prompt,
// decides with the shared fake policy and writes `--output-format stream-json`
// events in the shape Claude Code 2.1.310 emits (captured by
// scripts/assistant/claude-cli-harness.mjs). It never contacts a model or any
// network service; its replies are not evidence of model behavior.
//
// FAKE_CLAUDE_MODE selects a failure mode:
//   success (default) | logged-out | auth | auth-retry | quota | overloaded | crash-nonzero |
//   success-then-nonzero | no-result | garbage-line | huge-line | split-utf8 | hang |
//   grandchild | late-output | old-version | missing-flag | extra-tools | max-turns | text-only
// FAKE_CLAUDE_REPLY       JSON reply to emit instead of the fake policy's decision.
// FAKE_CLAUDE_RECORD      file that receives {argv, cwd, stdinBytes, envKeys} for the print run.
// FAKE_CLAUDE_PIDFILE     file that receives the grandchild pid (mode grandchild).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fakeDecide } from "../../../server/assistant/fake-decide.mjs";

const VERSION = "2.1.310";
const mode = process.env.FAKE_CLAUDE_MODE || "success";
const argv = process.argv.slice(2);
const out = (/** @type {unknown} */ event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const session_id = randomUUID();
const hang = () => { const tick = () => { setTimeout(tick, 60_000); }; tick(); };
const exitAfterFlush = (/** @type {number} */ code) => process.stdout.write("", () => process.exit(code));

const FLAGS = ["--add-dir", "--allowedTools, --allowed-tools <tools...>", "--disable-slash-commands", "--disallowedTools, --disallowed-tools <tools...>", "--effort <level>", "--json-schema <schema>", "--mcp-config <configs...>", "--model <model>", "--no-session-persistence", "--output-format <format>", "--permission-mode <mode>        (choices: \"acceptEdits\", \"auto\", \"bypassPermissions\", \"manual\", \"dontAsk\", \"plan\")", "--permission-prompts <target>", "-p, --print", "--restricted", "--safe-mode", "--setting-sources <sources>", "--strict-mcp-config", "--system-prompt <prompt>", "--tools <tools...>", "--verbose", "-v, --version"];

if (argv[0] === "--version" || argv[0] === "-v") {
  process.stdout.write(`${mode === "old-version" ? "2.1.100" : VERSION} (Claude Code)\n`);
  process.exit(0);
}
if (argv[0] === "--help" || argv[0] === "-h") {
  const flags = mode === "missing-flag" ? FLAGS.filter(flag => !flag.startsWith("--safe-mode") && !flag.startsWith("--permission-prompts")) : FLAGS;
  process.stdout.write(`Usage: claude [options] [command] [prompt]\n\nOptions:\n${flags.map(flag => `  ${flag}`).join("\n")}\n`);
  process.exit(0);
}
if (argv[0] === "auth" && argv[1] === "status") {
  const loggedIn = mode !== "logged-out";
  process.stdout.write(`${JSON.stringify({ loggedIn, authMethod: loggedIn ? "claude.ai" : "none", apiProvider: "firstParty" }, null, 2)}\n`);
  process.exit(loggedIn ? 0 : 1);
}
if (!argv.includes("--print") && !argv.includes("-p")) { process.stderr.write("fake claude: only --print runs are supported\n"); process.exit(2); }
const schemaIndex = argv.indexOf("--json-schema");
if (schemaIndex < 0) { process.stderr.write("fake claude: --json-schema is required\n"); process.exit(2); }
try { JSON.parse(argv[schemaIndex + 1] ?? ""); } catch { process.stderr.write("Error: --json-schema is not a valid JSON Schema\n"); process.exit(1); }

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString("utf8");
if (process.env.FAKE_CLAUDE_RECORD) writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ argv, cwd: process.cwd(), stdinBytes: Buffer.byteLength(prompt), envKeys: Object.keys(process.env).filter(key => /^(ANTHROPIC_|ZUDO_ASSISTANT_|CLAUDE_CODE_USE_BEDROCK$|CLAUDE_CODE_USE_VERTEX$)/.test(key)).sort() }));

const usage = { input_tokens: 1, output_tokens: 1 };
if (mode !== "no-init") out({ type: "system", subtype: "init", cwd: process.cwd(), session_id, tools: mode === "extra-tools" ? ["Bash", "StructuredOutput"] : ["StructuredOutput"], mcp_servers: [], model: "claude-opus-5-5", permissionMode: "dontAsk", slash_commands: [], apiKeySource: "none", claude_code_version: VERSION, uuid: randomUUID() });

/** @param {number} status @param {string} category @param {string} text */
const apiError = (status, category, text) => {
  out({ type: "assistant", message: { id: randomUUID(), model: "<synthetic>", role: "assistant", type: "message", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id, error: category, is_api_error_message: true, api_error_status: status });
  out({ type: "result", subtype: "success", is_error: true, num_turns: 1, terminal_reason: "api_error", result: text, api_error_status: status, session_id, permission_denials: [] });
  exitAfterFlush(1);
};
/** @param {number} attempt @param {number} status @param {string} category */
const retry = (attempt, status, category) => out({ type: "system", subtype: "api_retry", attempt, max_retries: 10, retry_delay_ms: 500, error_status: status, error: category, session_id, uuid: randomUUID() });

switch (mode) {
  case "auth": apiError(401, "authentication_failed", "Invalid API key · Fix external API key"); break;
  case "auth-retry": retry(1, 401, "authentication_failed"); hang(); break;
  case "quota": retry(1, 429, "rate_limit"); apiError(429, "rate_limit", "API Error: Request rejected (429) · rate limited"); break;
  case "overloaded": retry(1, 529, "overloaded"); retry(2, 529, "overloaded"); apiError(529, "overloaded", "API Error: Repeated 529 Overloaded errors."); break;
  case "crash-nonzero": process.stderr.write("fake claude: internal error at /home/someone/.claude/x\n"); exitAfterFlush(3); break;
  case "no-result": out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "partial" }] }, session_id }); exitAfterFlush(0); break;
  case "garbage-line": process.stdout.write("this is not json\n"); hang(); break;
  case "huge-line": process.stdout.write(`{"type":"assistant","pad":"${"x".repeat(3 * 1024 * 1024)}"}\n`); hang(); break;
  case "hang": hang(); break;
  case "grandchild": {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore" });
    if (process.env.FAKE_CLAUDE_PIDFILE) writeFileSync(process.env.FAKE_CLAUDE_PIDFILE, String(child.pid));
    hang();
    break;
  }
  case "late-output":
    process.on("SIGTERM", () => { emitReply({ text: "late", tool_calls: [], stop: "end_turn" }); exitAfterFlush(0); });
    hang();
    break;
  case "max-turns":
    out({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 2, terminal_reason: "max_turns", errors: ["Reached maximum number of turns (1)"], session_id, permission_denials: [] });
    exitAfterFlush(1);
    break;
  case "text-only":
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Here you go." }] }, session_id });
    out({ type: "result", subtype: "success", is_error: false, num_turns: 1, terminal_reason: "completed", result: "Here you go.", session_id, permission_denials: [] });
    exitAfterFlush(0);
    break;
  default: {
    let reply;
    if (process.env.FAKE_CLAUDE_REPLY) reply = JSON.parse(process.env.FAKE_CLAUDE_REPLY);
    else {
      // Same line-anchored extraction as readStructuredPrompt in server/assistant/structured-turn.ts.
      const match = /^<request_json>([\s\S]*?)<\/request_json>$/m.exec(prompt);
      if (!match) { process.stderr.write("fake claude: no request_json in prompt\n"); process.exit(4); }
      const decision = fakeDecide(JSON.parse(match[1]));
      if (decision.hang) { hang(); break; }
      const { hang: _hang, ...rest } = decision;
      void _hang;
      reply = rest;
    }
    emitReply(reply, mode === "split-utf8");
    if (mode !== "split-utf8") exitAfterFlush(mode === "success-then-nonzero" ? 1 : 0);
  }
}

/** Real 2.1.310 shape: the model calls StructuredOutput, the CLI echoes the tool result, then the result carries structured_output. */
function emitReply(/** @type {unknown} */ reply, split = false) {
  const id = `toolu_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  out({ type: "assistant", message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id, name: "StructuredOutput", input: reply }], stop_reason: null, usage }, parent_tool_use_id: null, session_id, uuid: randomUUID() });
  out({ type: "user", message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content: "Structured output provided successfully" }] }, parent_tool_use_id: null, session_id, uuid: randomUUID() });
  const result = `${JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 2, terminal_reason: "completed", stop_reason: "tool_use", result: JSON.stringify(reply), structured_output: reply, session_id, permission_denials: [], uuid: randomUUID() })}\n`;
  if (!split) { process.stdout.write(result); return; }
  // Write the final line in pieces that split every multi-byte character across separate writes.
  const bytes = Buffer.from(result, "utf8");
  const cuts = [];
  for (let index = 1; index < bytes.length; index++) if ((bytes[index] & 0xc0) === 0x80 && (bytes[index - 1] & 0xc0) !== 0x80) cuts.push(index);
  let start = 0, delay = 0;
  for (const cut of [...cuts, bytes.length]) {
    const piece = bytes.subarray(start, cut);
    setTimeout(() => process.stdout.write(piece), delay += 5);
    start = cut;
  }
  setTimeout(() => exitAfterFlush(0), delay + 20);
}
