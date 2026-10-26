#!/usr/bin/env node
// @ts-check
/**
 * Fake `codex` executable for process-protocol tests. It answers the probes
 * Composer runs (`--version`, `--help`, `login status`) and `exec`, reading
 * the prompt from stdin and replying through the shared fakeDecide policy
 * with the JSONL event shapes `codex exec --json` 0.164.0 emits (captured
 * with scripts/assistant/codex-cli-harness.mjs). It never contacts a model.
 *
 * FAKE_CODEX_MODE selects a failure: auth, quota, rate-limit, crash-nonzero,
 * success-then-nonzero, no-terminal-event, no-message, garbage-line,
 * huge-line, split-utf8, hang, spawn-grandchild-then-hang, old-version,
 * not-logged-in, sandbox-refusal, reasoning, reconnect, config-rejected,
 * raw-reply (reply text from FAKE_CODEX_REPLY or the file FAKE_CODEX_REPLY_FILE).
 * FAKE_CODEX_RECORD names a file that receives argv, cwd and stdin facts.
 * FAKE_CODEX_PID_FILE receives the grandchild pid in spawn-grandchild-then-hang.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fakeDecide } from "../../../server/assistant/fake-decide.mjs";

const mode = process.env.FAKE_CODEX_MODE ?? "";
const argv = process.argv.slice(2);
const out = (/** @type {object} */ event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const hangForever = () => { globalThis.setInterval(() => {}, 60_000); };
const exit = (/** @type {number} */ code) => process.stdout.write("", () => process.exit(code));

if (argv[0] === "--version" || argv[0] === "-V") {
  process.stdout.write(`codex-cli ${mode === "old-version" ? "0.150.0" : "0.164.0"}\n`);
  process.exit(0);
}
if (argv[0] === "--help" || argv[0] === "help") {
  process.stdout.write("Codex CLI (fake)\n\nUsage: codex [OPTIONS] <COMMAND>\n\nCommands:\n  exec   Run Codex non-interactively\n  login  Manage login\n");
  process.exit(0);
}
if (argv[0] === "login" && argv[1] === "status") {
  if (mode === "not-logged-in") { process.stderr.write("Not logged in\n"); process.exit(1); }
  process.stderr.write("Logged in using ChatGPT\n");
  process.exit(0);
}
if (argv[0] !== "exec") { process.stderr.write("fake codex: unsupported command\n"); process.exit(2); }

if (mode === "config-rejected") {
  process.stderr.write("Error loading config.toml: unknown configuration field `skills.bundled` in -c/--config override\n");
  process.exit(1);
}

const chunks = /** @type {Buffer[]} */ ([]);
process.stdin.on("data", chunk => chunks.push(chunk));
process.stdin.on("end", () => { run(Buffer.concat(chunks).toString("utf8")); });

/** @param {string} prompt */
function run(prompt) {
  const cdIndex = argv.indexOf("-C");
  const schemaIndex = argv.indexOf("--output-schema");
  if (process.env.FAKE_CODEX_RECORD) {
    writeFileSync(process.env.FAKE_CODEX_RECORD, JSON.stringify({ argv, cwd: process.cwd(), cd: argv[cdIndex + 1] ?? null, schemaExists: schemaIndex >= 0 && existsSync(argv[schemaIndex + 1]), stdinBytes: Buffer.byteLength(prompt) }));
  }
  out({ type: "thread.started", thread_id: "01a179ce-0000-7000-8000-000000000000" });
  if (mode === "crash-nonzero") { process.stderr.write("fake codex crashed\n"); exit(3); return; }
  out({ type: "turn.started" });
  if (mode === "auth") return fail("unexpected status 401 Unauthorized: Incorrect API key, url: https://api.openai.com/v1/responses");
  if (mode === "quota") return fail("You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 22nd, 2029 12:00 AM.");
  if (mode === "rate-limit") return fail("exceeded retry limit, last status: 429 Too Many Requests");
  if (mode === "hang") { hangForever(); return; }
  if (mode === "spawn-grandchild-then-hang") {
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore" });
    if (process.env.FAKE_CODEX_PID_FILE) writeFileSync(process.env.FAKE_CODEX_PID_FILE, String(grandchild.pid));
    hangForever();
    return;
  }
  if (mode === "garbage-line") { process.stdout.write("this is not JSON\n"); }
  if (mode === "huge-line") { process.stdout.write(`{"type":"item.completed","item":{"id":"x","type":"reasoning","text":"${"x".repeat(3 * 1024 * 1024)}"}}\n`); }
  if (mode === "sandbox-refusal") {
    const item = { id: "item_0", type: "command_execution", command: "/bin/bash -lc 'echo x > /tmp/outside.txt'", aggregated_output: "", exit_code: null, status: "in_progress" };
    out({ type: "item.started", item });
    out({ type: "item.completed", item: { ...item, aggregated_output: "/bin/bash: line 1: /tmp/outside.txt: Read-only file system\n", exit_code: 1, status: "completed" } });
  }
  if (mode === "reasoning") out({ type: "item.completed", item: { id: "item_r", type: "reasoning", text: "Thinking about the request" } });
  if (mode === "reconnect") {
    out({ type: "item.completed", item: { id: "item_p", type: "agent_message", text: "{\"text\":\"partial" } });
    out({ type: "error", message: "Reconnecting... 1/5 (stream disconnected before completion: stream closed before response.completed)" });
  }

  let text;
  if (mode === "raw-reply") text = process.env.FAKE_CODEX_REPLY_FILE ? readFileSync(process.env.FAKE_CODEX_REPLY_FILE, "utf8") : process.env.FAKE_CODEX_REPLY ?? "";
  else {
    const match = /^<request_json>([\s\S]*?)<\/request_json>$/m.exec(prompt);
    if (!match) return fail("fake codex: no request_json block in prompt");
    const decision = fakeDecide(JSON.parse(match[1]));
    if (decision.hang) { hangForever(); return; }
    const { hang: _hang, ...reply } = decision;
    void _hang;
    text = JSON.stringify(reply);
  }
  if (mode === "no-message") { out({ type: "turn.completed", usage: usage() }); exit(0); return; }
  const message = JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text } }) + "\n";
  if (mode === "split-utf8") {
    // Write the message in pieces that cut through multi-byte characters.
    const bytes = Buffer.from(message, "utf8");
    const cuts = [];
    for (let index = 1; index < bytes.length; index++) if ((bytes[index] & 0xc0) === 0x80 && (bytes[index - 1] & 0xc0) !== 0x80) cuts.push(index);
    let start = 0;
    const pieces = [];
    for (const cut of cuts) { pieces.push(bytes.subarray(start, cut)); start = cut; }
    pieces.push(bytes.subarray(start));
    const writeNext = () => {
      const piece = pieces.shift();
      if (!piece) { finishTurn(); return; }
      process.stdout.write(piece, () => setTimeout(writeNext, 5));
    };
    writeNext();
    return;
  }
  process.stdout.write(message);
  finishTurn();
}

function usage() { return { input_tokens: 10, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 }; }

function finishTurn() {
  if (mode === "no-terminal-event") { exit(0); return; }
  out({ type: "turn.completed", usage: usage() });
  exit(mode === "success-then-nonzero" ? 1 : 0);
}

/** @param {string} message */
function fail(message) {
  out({ type: "error", message });
  out({ type: "turn.failed", error: { message } });
  exit(1);
}
