import type { CliAssistantConfig } from "../config/assistant";
import { probeCli, type CliExit } from "./cli-process";
import type { CliProbe, CliProtocol, CliStreamParser } from "./cli-provider";
import { ProviderError, type ProviderErrorCode } from "./provider";

/**
 * Claude Code CLI (`claude --print`) as a one-reply model provider.
 *
 * Composer never delegates its operations to the CLI's agent loop: the CLI
 * runs with no built-in tools, no MCP servers, no user/project settings,
 * hooks, CLAUDE.md, skills or plugins, one agentic turn, and a JSON Schema
 * that makes the model answer through Claude Code's own `StructuredOutput`
 * tool. Composer validates that reply itself and only its runner executes the
 * requested Composer tools. The CLI's normal sign-in is used; managed
 * (policy) settings still apply and are never bypassed.
 *
 * Profile verified against Claude Code 2.1.310 with a scripted loopback model
 * endpoint (scripts/assistant/claude-cli-harness.mjs). Flag semantics:
 * https://code.claude.com/docs/en/cli-reference and
 * https://code.claude.com/docs/en/headless.
 */

/** Oldest accepted version: `--permission-prompts` needs 2.1.259 (`--restricted` 2.1.248, strict `--json-schema` 2.1.205). */
export const CLAUDE_CLI_MIN_VERSION = "2.1.259";

/**
 * Options that must be listed by `claude --help` before Composer runs the CLI.
 * `--max-turns` is documented but hidden from `--help`; the version floor covers it.
 */
export const CLAUDE_CLI_REQUIRED_FLAGS = [
  "--print", "--output-format", "--verbose", "--json-schema", "--system-prompt",
  "--tools", "--disallowedTools", "--strict-mcp-config", "--mcp-config",
  "--permission-mode", "--permission-prompts", "--no-session-persistence",
  "--setting-sources", "--disable-slash-commands", "--safe-mode", "--restricted",
  "--model", "--effort",
] as const;

export const CLAUDE_CLI_LABEL = "Claude Code CLI (local login)";
/** The only tool the restricted session may offer the model: Claude Code's structured-output carrier. */
export const CLAUDE_CLI_STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/** Fixed, generic system prompt. Site data and Memory never travel in argv; they arrive on stdin. */
export const CLAUDE_CLI_SYSTEM_PROMPT = [
  "You produce exactly one reply for Zudo Composer's AI Assistant.",
  "The request arrives as the user message. Deliver your reply only by calling the StructuredOutput tool exactly once with an object that matches its schema; do not write the reply as plain text.",
  "You have no other tools in this session: do not try to read or write files, run commands, browse, or use any built-in or MCP tool.",
].join(" ");

/** argv for one reply. Every value comes from this module or trusted host config; never from prompts or model output. */
export function claudeCliArgs(config: Pick<CliAssistantConfig, "model" | "effort">, schema: Record<string, unknown>): string[] {
  return [
    // One non-interactive reply; the prompt and all context are read from stdin.
    "--print",
    "--output-format", "stream-json", "--verbose",
    // Nothing is written to the CLI's resumable session history.
    "--no-session-persistence",
    // No CLAUDE.md, skills, plugins, hooks, MCP servers, custom agents or auto memory; managed policy still applies.
    "--safe-mode",
    // No command/code tools or WebFetch, only managed settings load, bypassPermissions is refused.
    "--restricted",
    // Load no user, project or local settings files.
    "--setting-sources", "",
    // No built-in tools at all.
    "--tools", "",
    // Only an explicitly empty MCP set, and any MCP tool that still appears is removed.
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disallowedTools", "mcp__*",
    // Anything that would need approval is denied and nobody is asked.
    "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--disable-slash-commands",
    // Exactly one model request per invocation.
    "--max-turns", "1",
    "--system-prompt", CLAUDE_CLI_SYSTEM_PROMPT,
    // Derived from Composer's own tool names; Composer still validates the reply.
    "--json-schema", JSON.stringify(schema),
    ...(config.model ? ["--model", config.model] : []),
    ...(config.effort ? ["--effort", config.effort] : []),
  ];
}

const VERSION = /(\d+)\.(\d+)\.(\d+)/;
export function compareVersions(a: string, b: string): number {
  const x = VERSION.exec(a)!.slice(1).map(Number), y = VERSION.exec(b)!.slice(1).map(Number);
  for (let index = 0; index < 3; index++) if (x[index] !== y[index]) return x[index]! - y[index]!;
  return 0;
}
const hasFlag = (help: string, flag: string) => new RegExp(`(?:^|[\\s,])${flag}(?=[\\s,=]|$)`, "m").test(help);

async function probe(config: CliAssistantConfig, env: NodeJS.ProcessEnv): Promise<CliProbe> {
  if (process.platform !== "darwin" && process.platform !== "linux") return { ok: false, code: "unsupported-platform", message: `${CLAUDE_CLI_LABEL} is supported on macOS and Linux (including WSL) only.`, version: null };
  const run = async (args: string[]) => {
    try { return await probeCli(config.executable, args, { env }); } catch (error) {
      if (error instanceof ProviderError && error.code === "not-installed") return null;
      throw error;
    }
  };
  const notInstalled: CliProbe = { ok: false, code: "not-installed", message: "Claude Code CLI was not found. Install Claude Code, or set assistant.executable to its location.", version: null };
  const versionRun = await run(["--version"]);
  if (!versionRun) return notInstalled;
  const match = VERSION.exec(versionRun.output);
  if (versionRun.code !== 0 || !match || !/Claude Code/.test(versionRun.output)) return { ok: false, code: "probe-failed", message: "The configured executable did not report a Claude Code version. Check assistant.executable.", version: null };
  const version = match[0];
  if (compareVersions(version, CLAUDE_CLI_MIN_VERSION) < 0) return { ok: false, code: "unsupported-version", message: `Claude Code ${version} is too old for Composer; ${CLAUDE_CLI_MIN_VERSION} or later is required. Update Claude Code.`, version };
  const helpRun = await run(["--help"]);
  if (!helpRun) return notInstalled;
  const missing: string[] = CLAUDE_CLI_REQUIRED_FLAGS.filter(flag => !hasFlag(helpRun.output, flag));
  if (!missing.includes("--permission-mode") && !/\bdontAsk\b/.test(helpRun.output)) missing.push("--permission-mode dontAsk");
  if (missing.length) return { ok: false, code: "unsupported-version", message: `Claude Code ${version} lacks options Composer requires (${missing.join(", ")}). Update Claude Code.`, version };
  // Local check: reads the CLI's own sign-in state without a model request (documented exit 0 = signed in, 1 = not).
  const authRun = await run(["auth", "status", "--json"]);
  if (!authRun) return notInstalled;
  let loggedIn: unknown;
  try { loggedIn = (JSON.parse(authRun.output.slice(authRun.output.indexOf("{"), authRun.output.lastIndexOf("}") + 1)) as { loggedIn?: unknown }).loggedIn; } catch { loggedIn = undefined; }
  if (authRun.code === 0 && loggedIn === true) return { ok: true, version };
  if (authRun.code === 1 || loggedIn === false) return { ok: false, code: "not-logged-in", message: "Claude Code is not signed in. Run \"claude auth login\" in a terminal, then try again.", version };
  return { ok: false, code: "probe-failed", message: "Claude Code's sign-in state could not be read. Run \"claude auth status\" in a terminal.", version };
}

const AUTH_CATEGORIES = new Set(["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "cloud_credential_error"]);
const fail = (code: ProviderErrorCode, message: string, retryable: boolean) => new ProviderError(code, message, retryable);
const authError = () => fail("auth", "Claude Code is not signed in or its sign-in was rejected. Run \"claude auth login\" in a terminal, then retry.", false);
const quotaError = () => fail("quota", "Claude Code reached a rate or usage limit. Try again later.", true);
const unreadable = () => fail("malformed-output", "Claude Code CLI produced output Composer could not read.", true);
const notInFormat = () => fail("malformed-output", "The model did not answer in Composer's reply format within one reply. Retry this turn.", true);

/** Map an API failure the CLI reported (HTTP status and/or its error category) to Composer's codes. */
function apiFailure(status: number | null, category: string | null): ProviderError {
  if (status === 401 || status === 403 || (category !== null && AUTH_CATEGORIES.has(category))) return authError();
  if (status === 429 || category === "rate_limit" || category === "billing_error") return quotaError();
  if (status === 529 || category === "overloaded") return fail("overloaded", "The model service behind Claude Code is overloaded. Try again shortly.", true);
  if (status === 400 || status === 404 || status === 413 || category === "invalid_request" || category === "model_not_found") return fail("invalid-request", "The model service refused the request from Claude Code. Check the configured model.", false);
  return fail("transport", "Claude Code could not get a reply from the model service.", true);
}

interface ResultEvent { subtype?: unknown; is_error?: unknown; structured_output?: unknown; api_error_status?: unknown; stop_reason?: unknown; terminal_reason?: unknown; result?: unknown; permission_denials?: unknown }

/** Reads `--output-format stream-json` events; the reply comes only from the terminal `result` event. */
function createParser(): CliStreamParser {
  let result: ResultEvent | undefined;
  let lastCategory: string | null = null, lastStatus: number | null = null;
  let replied = false;
  return {
    line(text, activity) {
      if (!text.trim()) return;
      let event: unknown;
      try { event = JSON.parse(text); } catch { throw unreadable(); }
      if (!event || typeof event !== "object" || Array.isArray(event)) throw unreadable();
      if (result) throw fail("malformed-output", "Claude Code CLI kept writing after its final result.", true);
      const value = event as Record<string, unknown>;
      if (value.type === "system" && value.subtype === "init") {
        // Fail closed when the restricted profile did not take effect (e.g. a managed setting added tools).
        const tools = Array.isArray(value.tools) ? value.tools.filter((tool): tool is string => typeof tool === "string") : [];
        const extra = tools.filter(tool => tool !== CLAUDE_CLI_STRUCTURED_OUTPUT_TOOL);
        if (!tools.includes(CLAUDE_CLI_STRUCTURED_OUTPUT_TOOL) || extra.length) throw fail("unsupported", `Claude Code CLI started with tools Composer does not allow${extra.length ? ` (${extra.slice(0, 5).map(name => name.slice(0, 40)).join(", ")})` : ""}. Check managed settings or update Claude Code.`, false);
        activity("Claude Code CLI session ready");
      } else if (value.type === "system" && value.subtype === "api_retry") {
        const category = typeof value.error === "string" ? value.error : null;
        const status = typeof value.error_status === "number" ? value.error_status : null;
        const attempt = typeof value.attempt === "number" ? value.attempt : 1;
        // Sign-in problems do not fix themselves; repeated rate limits are reported instead of waiting out the CLI's backoff.
        if (status === 401 || status === 403 || (category !== null && AUTH_CATEGORIES.has(category))) throw authError();
        if (category === "billing_error") throw quotaError();
        if ((status === 429 || category === "rate_limit") && attempt >= 2) throw quotaError();
        activity(`Claude Code CLI is retrying the model request (attempt ${attempt})`);
      } else if (value.type === "assistant") {
        if (value.error !== undefined || value.is_api_error_message === true) {
          if (typeof value.error === "string") lastCategory = value.error;
          if (typeof value.api_error_status === "number") lastStatus = value.api_error_status;
        } else if (!replied) { replied = true; activity("Claude Code CLI received the model reply"); }
      } else if (value.type === "result") {
        result = value as ResultEvent;
      }
      // Unknown and informational events (tool_result echoes, stream events, hook events) are ignored.
    },
    finish(exit: CliExit) {
      if (!result) {
        if (exit.code === 0) throw fail("malformed-output", "Claude Code CLI ended without a result.", true);
        throw fail("process-failed", exit.signal ? "Claude Code CLI was terminated before it finished." : `Claude Code CLI exited with status ${exit.code} before producing a result.`, true);
      }
      if (result.is_error === false && result.subtype === "success") {
        if (exit.code !== 0) throw fail("process-failed", `Claude Code CLI reported success but exited with status ${exit.code}.`, true);
        const output = result.structured_output;
        if (output && typeof output === "object" && !Array.isArray(output)) return output;
        if (result.stop_reason === "refusal") throw fail("refused", "The model declined this request.", false);
        throw notInFormat();
      }
      if (result.subtype === "error_max_turns" || result.subtype === "error_max_structured_output_retries") throw notInFormat();
      if (result.stop_reason === "refusal") throw fail("refused", "The model declined this request.", false);
      const status = typeof result.api_error_status === "number" ? result.api_error_status : lastStatus;
      if (status !== null || lastCategory !== null || result.terminal_reason === "api_error") throw apiFailure(status, lastCategory);
      // A failure reported only as text (e.g. no sign-in). Only fixed operator text is surfaced, never the CLI's words.
      const message = typeof result.result === "string" ? result.result : "";
      if (/not logged in|\/login|invalid api key|authenticat/i.test(message)) throw authError();
      if (/usage limit|rate limit|hit your limit/i.test(message)) throw quotaError();
      if (/policy|not allowed/i.test(message) || (Array.isArray(result.permission_denials) && result.permission_denials.length)) throw fail("refused", "Claude Code refused this request under its configured policy.", false);
      throw fail("process-failed", "Claude Code CLI reported an error and produced no reply.", true);
    },
  };
}

export const claudeCliProtocol: CliProtocol = {
  provider: "claude-cli",
  label: CLAUDE_CLI_LABEL,
  // Claude Code would prefer these over the user's subscription login; a key held for the API provider is never reused.
  excludedEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"],
  probe,
  prepare: async ({ config, schema }) => ({ args: claudeCliArgs(config, schema) }),
  createParser,
};
