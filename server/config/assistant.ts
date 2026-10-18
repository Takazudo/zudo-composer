/**
 * Host opt-in for the AI Assistant. The config names a provider/model and the
 * server-side environment variable that holds the credential; it never holds
 * a secret itself and is never serialized to the browser.
 */
export interface AssistantConfig {
  provider: "anthropic";
  /** Messages API model id. */
  model: string;
  /** Environment variable read by the local authoring server only. */
  apiKeyEnv: string;
  effort: "low" | "medium" | "high";
  /** Default display name; a site-scoped stored name may replace it. */
  name: string;
  /** `propose` permits conversation, drafts and review but never Apply. */
  permission: "apply" | "propose";
}

export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5-5";

export function parseAssistant(value: unknown): AssistantConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("assistant must be a plain object.");
  const input = value as Record<string, unknown>;
  const keys = ["provider", "model", "apiKeyEnv", "effort", "name", "permission"];
  for (const key of Object.keys(input)) if (!keys.includes(key)) throw new Error(`assistant.${key} is not supported.`);
  const text = (key: string, fallback: string, pattern: RegExp) => {
    const raw = input[key] ?? fallback;
    if (typeof raw !== "string" || !pattern.test(raw)) throw new Error(`assistant.${key} is invalid.`);
    return raw;
  };
  if ((input.provider ?? "anthropic") !== "anthropic") throw new Error('assistant.provider must be "anthropic".');
  const effort = input.effort ?? "medium";
  if (!["low", "medium", "high"].includes(effort as string)) throw new Error('assistant.effort must be "low", "medium" or "high".');
  const permission = input.permission ?? "apply";
  if (!["apply", "propose"].includes(permission as string)) throw new Error('assistant.permission must be "apply" or "propose".');
  return {
    provider: "anthropic",
    model: text("model", DEFAULT_ASSISTANT_MODEL, /^[a-z0-9][a-z0-9.-]{0,99}$/),
    apiKeyEnv: text("apiKeyEnv", "ANTHROPIC_API_KEY", /^[A-Z_][A-Z0-9_]{0,99}$/),
    effort: effort as AssistantConfig["effort"],
    name: text("name", "AI Assistant", /^[^\n\r\t]{1,40}$/).trim() || "AI Assistant",
    permission: permission as AssistantConfig["permission"],
  };
}
