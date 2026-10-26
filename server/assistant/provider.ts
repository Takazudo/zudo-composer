import type { AssistantProviderKind } from "../config/assistant";

/**
 * Provider-neutral model call surface. Each provider produces one model reply
 * per `turn`; only the runner executes tools, and only from its own allowlist.
 */
export type ProviderBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  /** Provider-owned block (e.g. thinking) replayed unchanged within one run, never persisted. */
  | { type: "opaque"; value: unknown };
export interface ProviderMessage { role: "user" | "assistant"; content: ProviderBlock[] }
export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ProviderTurn { content: ProviderBlock[]; stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other" }
export interface ProviderRequest {
  system: string; messages: ProviderMessage[]; tools: ToolSpec[]; signal: AbortSignal;
  /** Text deltas, only when the provider actually streams them. */
  onText(delta: string): void;
  /** Real provider progress (e.g. "Claude Code CLI started"); never synthesized token output. */
  onActivity?(activity: string): void;
}

/** What the browser and each run record show about the provider in use. */
export interface ProviderIdentity {
  provider: AssistantProviderKind;
  /** Human-readable destination, e.g. "Claude Code CLI (local login)". */
  label: string;
  /** Configured or reported model; `null` when the CLI default is used. */
  model: string | null;
  /** Installed CLI version when known. */
  version: string | null;
}
export type ProviderStatusCode = "not-configured" | "missing-credential" | "not-installed" | "not-logged-in" | "unsupported-version" | "unsupported-platform" | "probe-failed";
export type ProviderStatus =
  | ({ ok: true } & ProviderIdentity)
  | ({ ok: false; code: ProviderStatusCode; message: string } & ProviderIdentity);
export interface ModelProvider {
  /** Availability of the selected provider. Never falls back to another provider. */
  status(): ProviderStatus | Promise<ProviderStatus>;
  /** One model call. Implementations never execute tools themselves. */
  turn(request: ProviderRequest): Promise<ProviderTurn>;
}

export type ProviderErrorCode =
  | "auth" | "quota" | "overloaded" | "transport" | "timeout" | "invalid-request" | "malformed-output" | "aborted"
  | "not-installed" | "unsupported" | "refused" | "process-failed";
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string, readonly retryable: boolean) { super(message); }
}

/** What each model call can carry, shown under Context details for every provider. */
export const MODEL_CALL_SENDS = ["your message and recent conversation", "current page/selection ids and the blocks you ask it to inspect", "site Memory", "attached exact materials", "component definitions"] as const;
