/** Provider-neutral model call surface. Exactly one real implementation ships (Anthropic). */
export type ProviderBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  /** Provider-owned block (e.g. thinking) replayed unchanged within one run, never persisted. */
  | { type: "opaque"; value: unknown };
export interface ProviderMessage { role: "user" | "assistant"; content: ProviderBlock[] }
export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ProviderTurn { content: ProviderBlock[]; stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other" }
export interface ProviderRequest { system: string; messages: ProviderMessage[]; tools: ToolSpec[]; signal: AbortSignal; onText(delta: string): void }
export type ProviderStatus = { ok: true; provider: string; model: string } | { ok: false; code: "not-configured" | "missing-credential"; message: string; provider?: string; model?: string };
export interface ModelProvider {
  status(): ProviderStatus;
  /** One model call. Implementations never execute tools themselves. */
  turn(request: ProviderRequest): Promise<ProviderTurn>;
}

export type ProviderErrorCode = "auth" | "quota" | "overloaded" | "transport" | "timeout" | "invalid-request" | "malformed-output" | "aborted";
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string, readonly retryable: boolean) { super(message); }
}
