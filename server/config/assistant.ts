/**
 * Host opt-in for the AI Assistant. The host selects exactly one provider; a
 * provider that is unavailable is reported as such and never replaced by
 * another. The config never holds a secret and is never serialized to the
 * browser. CLI executables, models and timeouts come only from this trusted
 * host config, never from prompts or model output.
 */
export type AssistantProviderKind = "anthropic" | "fake" | "claude-cli" | "codex-cli";
export type AssistantEffort = "low" | "medium" | "high";

interface AssistantCommonConfig {
  /** Default display name; a site-scoped stored name may replace it. */
  name: string;
  /** `propose` permits conversation, drafts and review but never Apply. */
  permission: "apply" | "propose";
}

/** Anthropic Messages API through the pinned SDK. */
export interface AnthropicAssistantConfig extends AssistantCommonConfig {
  provider: "anthropic";
  /** Messages API model id. */
  model: string;
  /** Environment variable read by the local authoring server only. */
  apiKeyEnv: string;
  effort: AssistantEffort;
  /** Messages API origin: HTTPS (e.g. an organization gateway) or loopback HTTP for local proxies and tests. */
  baseUrl: string;
}

/** Deterministic, offline provider for local trials and automated tests. It never contacts a model. */
export interface FakeAssistantConfig extends AssistantCommonConfig {
  provider: "fake";
  model: "fake";
}

/**
 * A locally installed, already signed-in coding CLI used for one model reply
 * per call. Composer passes the prompt on stdin and runs the CLI with a fixed,
 * restricted profile; it never manages the CLI's credentials.
 */
export interface CliAssistantConfig extends AssistantCommonConfig {
  provider: "claude-cli" | "codex-cli";
  /** Executable name (looked up on PATH) or absolute path. Never a shell command line. */
  executable: string;
  /** Model passed to the CLI; `null` uses the CLI's own default. */
  model: string | null;
  /** Reasoning effort passed to the CLI when it supports one; `null` uses the CLI default. */
  effort: AssistantEffort | null;
  /** Upper bound for one CLI invocation (one model reply). */
  timeoutMs: number;
}

export type AssistantConfig = AnthropicAssistantConfig | FakeAssistantConfig | CliAssistantConfig;

export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5-5";
export const DEFAULT_CLI_TIMEOUT_MS = 180_000;
const DEFAULT_EXECUTABLES = { "claude-cli": "claude", "codex-cli": "codex" } as const;

const keysByProvider: Record<AssistantProviderKind, string[]> = {
  anthropic: ["provider", "model", "apiKeyEnv", "effort", "name", "permission", "baseUrl"],
  fake: ["provider", "name", "permission"],
  "claude-cli": ["provider", "executable", "model", "effort", "timeoutMs", "name", "permission"],
  "codex-cli": ["provider", "executable", "model", "effort", "timeoutMs", "name", "permission"],
};

export function parseAssistant(value: unknown): AssistantConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("assistant must be a plain object.");
  const input = value as Record<string, unknown>;
  const provider = input.provider ?? "anthropic";
  if (typeof provider !== "string" || !Object.hasOwn(keysByProvider, provider)) throw new Error('assistant.provider must be "anthropic", "fake", "claude-cli" or "codex-cli".');
  const kind = provider as AssistantProviderKind;
  for (const key of Object.keys(input)) if (!keysByProvider[kind].includes(key)) throw new Error(`assistant.${key} is not supported for provider "${kind}".`);
  const text = (key: string, fallback: string, pattern: RegExp) => {
    const raw = input[key] ?? fallback;
    if (typeof raw !== "string" || !pattern.test(raw)) throw new Error(`assistant.${key} is invalid.`);
    return raw;
  };
  const permission = input.permission ?? "apply";
  if (!["apply", "propose"].includes(permission as string)) throw new Error('assistant.permission must be "apply" or "propose".');
  const common: AssistantCommonConfig = {
    name: text("name", "AI Assistant", /^[^\n\r\t]{1,40}$/).trim() || "AI Assistant",
    permission: permission as AssistantCommonConfig["permission"],
  };
  const effortOf = (fallback: AssistantEffort | null) => {
    const effort = input.effort ?? fallback;
    if (effort !== null && !["low", "medium", "high"].includes(effort as string)) throw new Error('assistant.effort must be "low", "medium" or "high".');
    return effort as AssistantEffort | null;
  };
  if (kind === "fake") return { provider: "fake", model: "fake", ...common };
  if (kind === "anthropic") {
    return {
      provider: "anthropic",
      model: text("model", DEFAULT_ASSISTANT_MODEL, /^[a-z0-9][a-z0-9.-]{0,99}$/),
      apiKeyEnv: text("apiKeyEnv", "ANTHROPIC_API_KEY", /^[A-Z_][A-Z0-9_]{0,99}$/),
      effort: effortOf("medium") ?? "medium",
      baseUrl: parseBaseUrl(input.baseUrl),
      ...common,
    };
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 900_000) throw new Error("assistant.timeoutMs must be an integer between 5000 and 900000.");
  const model = input.model ?? null;
  if (model !== null && (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/.test(model))) throw new Error("assistant.model is invalid.");
  return {
    provider: kind,
    executable: parseExecutable(input.executable ?? DEFAULT_EXECUTABLES[kind]),
    model,
    effort: effortOf(null),
    timeoutMs,
    ...common,
  };
}

/** A bare command name or an absolute path; never arguments, shell syntax or a relative path. */
function parseExecutable(value: unknown): string {
  if (typeof value !== "string" || value.length > 1024 || /[\0\n\r]/.test(value)) throw new Error("assistant.executable is invalid.");
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)) return value;
  if (value.startsWith("/") && !/(^|\/)\.\.?(\/|$)/.test(value)) return value;
  throw new Error("assistant.executable must be a command name (looked up on PATH) or an absolute path.");
}

function parseBaseUrl(value: unknown): string {
  if (value === undefined) return "https://api.anthropic.com";
  let url: URL;
  try { url = new URL(String(value)); } catch { throw new Error("assistant.baseUrl must be an absolute URL."); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) throw new Error("assistant.baseUrl must be an https URL (or loopback http) without credentials, query or fragment.");
  return url.href.replace(/\/$/, "");
}
