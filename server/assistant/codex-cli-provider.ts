import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CliAssistantConfig } from "../config/assistant";
import { probeCli, type CliExit } from "./cli-process";
import type { CliProbe, CliProtocol, CliStreamParser } from "./cli-provider";
import { ProviderError } from "./provider";

export const CODEX_CLI_LABEL = "Codex CLI (local login)";
/** Oldest `codex` release whose flags, feature names and config keys the fixed profile was verified against. */
export const CODEX_CLI_MIN_VERSION = "0.164.0";
/** Verified on Linux; macOS uses the same flags with Codex's Seatbelt sandbox. Windows is not supported. */
export const CODEX_CLI_PLATFORMS: readonly NodeJS.Platform[] = ["linux", "darwin"];
export const CODEX_SCHEMA_FILE = "composer-reply.schema.json";

/**
 * Fixed `codex exec` profile for one model reply. `--strict-config` makes the
 * CLI reject any override key this version does not know, and an unknown
 * feature name is always an error, so a release that drops one of these
 * restrictions fails closed instead of running with a looser profile.
 *
 * `--json` and `--output-schema` only shape output. The write boundary is the
 * read-only sandbox with approval policy `never`; the disabled tools reduce
 * what the model is offered. Tools a model's own metadata enables
 * (`apply_patch`, code-mode `exec`) cannot be switched off by flags; the
 * sandbox refuses their writes and code mode fails closed without its host.
 * The read-only sandbox does not limit reading.
 */
export const CODEX_CLI_PROFILE: readonly string[] = Object.freeze([
  "exec", "--json", "--color", "never",
  // No Git trust check, no session files, no personal config.toml, no execpolicy .rules.
  "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config",
  // Write boundary: read-only sandbox; nothing can be approved interactively.
  "--sandbox", "read-only", "-c", 'approval_policy="never"',
  // Tools Composer never wants Codex to run itself.
  "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "shell_snapshot", "-c", "allow_login_shell=false",
  "-c", 'web_search="disabled"',
  "--disable", "multi_agent", "-c", "agents.enabled=false",
  "--disable", "goals", "--disable", "view_image", "--disable", "image_generation",
  "--disable", "apps", "--disable", "plugins", "--disable", "tool_suggest", "--disable", "skill_search",
  "--disable", "hooks", "--disable", "memories", "--disable", "browser_use", "--disable", "computer_use",
  "--disable", "sleep_tool", "--disable", "code_mode", "--disable", "code_mode_host",
  "-c", "tools.experimental_request_user_input.enabled=false", "-c", "tools.update_plan.enabled=false",
  // Instructions Composer does not supply: skills, AGENTS.md project docs, environment details.
  "-c", "skills.include_instructions=false", "-c", "skills.bundled.enabled=false",
  "-c", "project_doc_max_bytes=0", "-c", "include_environment_context=false",
  // Bounded failure without network, and no side channels.
  "--disable", "unbounded_connection_retries",
  "-c", 'history.persistence="none"', "-c", "check_for_update_on_startup=false",
  "-c", "analytics.enabled=false", "-c", "feedback.enabled=false", "-c", "notify=[]",
]);

/** Codex items that mean the model used one of Codex's own tools; Composer stops the reply. */
const TOOL_ITEM_TYPES = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search", "collab_tool_call"]);

type Version = [number, number, number];
const parseVersion = (text: string): Version | null => {
  const match = /\bcodex-cli\s+(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};
const atLeast = (version: Version, minimum: Version) => {
  for (let index = 0; index < 3; index++) if (version[index] !== minimum[index]) return version[index] > minimum[index];
  return true;
};

export function createCodexCliProtocol(options: { platform?: NodeJS.Platform } = {}): CliProtocol {
  const platform = options.platform ?? process.platform;
  return {
    provider: "codex-cli",
    label: CODEX_CLI_LABEL,
    async probe(config, env): Promise<CliProbe> {
      if (!CODEX_CLI_PLATFORMS.includes(platform)) return { ok: false, code: "unsupported-platform", message: `${CODEX_CLI_LABEL} is supported on macOS and Linux only.`, version: null };
      let versionOutput;
      try { versionOutput = await probeCli(config.executable, ["--version"], { env }); } catch (error) {
        if (error instanceof ProviderError && error.code === "not-installed") return { ok: false, code: "not-installed", message: error.message, version: null };
        throw error;
      }
      const parsed = versionOutput.code === 0 ? parseVersion(versionOutput.output) : null;
      if (!parsed) return { ok: false, code: "probe-failed", message: `Composer could not read the version of "${config.executable}". Run "${config.executable} --version" in a terminal.`, version: null };
      const version = parsed.join(".");
      if (!atLeast(parsed, CODEX_CLI_MIN_VERSION.split(".").map(Number) as Version)) return { ok: false, code: "unsupported-version", message: `Codex CLI ${version} is older than ${CODEX_CLI_MIN_VERSION}, the oldest version Composer can restrict. Update Codex CLI.`, version };
      // Reads the local credential store only; it never contacts a model. Its output is never shown.
      const login = await probeCli(config.executable, ["login", "status"], { env });
      if (login.code === 0) return { ok: true, version };
      if (/\bNot logged in\b/.test(login.output)) {
        // `codex exec` also accepts CODEX_API_KEY from its environment, which `login status` does not report.
        if (env.CODEX_API_KEY) return { ok: true, version };
        return { ok: false, code: "not-logged-in", message: `Codex CLI is not signed in. Run "${config.executable} login" in a terminal, then try again.`, version };
      }
      return { ok: false, code: "probe-failed", message: `Composer could not check the Codex CLI sign-in. Run "${config.executable} login status" in a terminal.`, version };
    },
    async prepare({ config, scratch, schema }) {
      const schemaPath = join(scratch, CODEX_SCHEMA_FILE);
      await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
      return { args: codexExecArgs(config, scratch, schemaPath) };
    },
    createParser: createCodexStreamParser,
  };
}

export const codexCliProtocol: CliProtocol = createCodexCliProtocol();

/** Complete argv after the executable: trusted config and Composer-owned paths only; the prompt goes to stdin. */
export function codexExecArgs(config: Pick<CliAssistantConfig, "model" | "effort">, scratch: string, schemaPath: string): string[] {
  return [
    ...CODEX_CLI_PROFILE,
    "-C", scratch, "--output-schema", schemaPath,
    ...(config.model ? ["-m", config.model] : []),
    ...(config.effort ? ["-c", `model_reasoning_effort="${config.effort}"`] : []),
    "-",
  ];
}

/** Maps a Codex error message to a ProviderError without repeating it (messages may carry URLs or account details). */
export function codexFailure(message: string): ProviderError {
  if (/usage limit|quota|upgrade to (plus|pro)|purchase more credits/i.test(message)) return new ProviderError("quota", "Your Codex usage limit or quota is used up. Try again later or check your plan.", false);
  if (/\b429\b|too many requests|rate limit/i.test(message)) return new ProviderError("quota", "Codex is rate limited right now. Wait a moment and retry.", true);
  if (/\b401\b|\b403\b|unauthorized|forbidden|not logged in|log ?in again|sign in|api key|access token|refresh token/i.test(message)) return new ProviderError("auth", 'Codex CLI could not authenticate. Run "codex login" in a terminal, then retry.', false);
  if (/at capacity|high demand|overloaded|\b50[23]\b|flex capacity/i.test(message)) return new ProviderError("overloaded", "The Codex model service is busy. Retry in a moment.", true);
  if (/context window|\b400\b|bad request|invalid_request|invalid schema|unsupported model|model .*not (found|supported)/i.test(message)) return new ProviderError("invalid-request", "Codex rejected the request (check assistant.model and assistant.effort).", false);
  if (/sandbox|policy|content_filter|refus/i.test(message)) return new ProviderError("refused", "Codex declined or blocked this reply.", false);
  if (/stream disconnected|connection|error sending request|timed out|network|dns/i.test(message)) return new ProviderError("transport", "Codex CLI could not reach its model service. Check the network and retry.", true);
  return new ProviderError("process-failed", "Codex CLI reported an error and produced no reply.", true);
}

const configRejected = (stderr: string) => /unknown configuration field|Unknown feature flag|Error loading config|error parsing -c overrides|unexpected argument|invalid value .* for '--/i.test(stderr);
const unreadable = () => new ProviderError("malformed-output", "Codex CLI produced output Composer could not read.", true);

/**
 * Reads `codex exec --json` events. The reply is the last `agent_message` of a
 * turn that ended with `turn.completed`, and only when the process exited 0.
 * Unknown events are ignored; nothing from stdout is surfaced raw.
 */
export function createCodexStreamParser(): CliStreamParser {
  let completed = false;
  let failedMessage: string | null = null;
  let reply: string | null = null;
  let lastActivity = "";
  return {
    line(text, activity) {
      if (!text.trim()) return;
      let event: unknown;
      try { event = JSON.parse(text); } catch { throw unreadable(); }
      if (!event || typeof event !== "object" || Array.isArray(event)) throw unreadable();
      if (completed || failedMessage !== null) return;
      const report = (label: string) => { if (label !== lastActivity) { lastActivity = label; activity(label); } };
      const value = event as { type?: unknown; item?: { type?: unknown; text?: unknown }; message?: unknown; error?: { message?: unknown } };
      switch (value.type) {
        case "turn.started": report("Codex turn started"); return;
        case "turn.completed": completed = true; return;
        case "turn.failed": failedMessage = typeof value.error?.message === "string" ? value.error.message : ""; return;
        case "error":
          // Transient: Codex retries the model request; a message from the abandoned attempt never counts.
          if (typeof value.message === "string" && /^Reconnecting\b/.test(value.message)) { reply = null; report("Codex is retrying the model connection"); }
          return;
        case "item.started": case "item.updated": case "item.completed": {
          const itemType = value.item?.type;
          if (typeof itemType === "string" && TOOL_ITEM_TYPES.has(itemType)) throw new ProviderError("refused", "Codex tried to use one of its own tools, which Composer does not allow. The reply was stopped; retry the turn.", true);
          if (itemType === "reasoning") report("Codex is reasoning");
          if (itemType === "agent_message" && value.type === "item.completed") {
            if (typeof value.item?.text !== "string") throw unreadable();
            reply = value.item.text;
            report("Codex produced a reply");
          }
          return;
        }
        default: return;
      }
    },
    finish(exit: CliExit) {
      if (failedMessage !== null) throw codexFailure(failedMessage);
      if (exit.code !== 0 || exit.signal) {
        if (configRejected(exit.stderrTail)) throw new ProviderError("unsupported", "This Codex CLI version does not accept Composer's restricted profile. Use a supported Codex CLI version.", false);
        if (/\bNot logged in\b/i.test(exit.stderrTail)) throw codexFailure("not logged in");
        throw new ProviderError("process-failed", completed ? "Codex CLI exited with an error after replying, so the reply was discarded." : "Codex CLI exited with an error and produced no reply.", true);
      }
      if (!completed) throw new ProviderError("malformed-output", "Codex CLI ended without a final result. Retry this turn.", true);
      if (reply === null) throw new ProviderError("malformed-output", "Codex CLI finished without a reply. Retry this turn.", true);
      return reply;
    },
  };
}
