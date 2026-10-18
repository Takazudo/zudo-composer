import Anthropic from "@anthropic-ai/sdk";
import type { AssistantConfig } from "../config/assistant";
import { ProviderError, type ModelProvider, type ProviderBlock, type ProviderRequest, type ProviderTurn } from "./provider";

const MAX_OUTPUT_TOKENS = 16_000;
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Anthropic Messages API adapter. The credential is read from the configured
 * server-side environment variable at call time and never leaves this module.
 */
export function createAnthropicProvider(config: AssistantConfig, env: NodeJS.ProcessEnv = process.env): ModelProvider {
  let client: Anthropic | undefined, clientKey: string | undefined;
  const credential = () => env[config.apiKeyEnv]?.trim() || undefined;
  const connect = () => {
    const key = credential();
    if (!key) throw new ProviderError("auth", `Set ${config.apiKeyEnv} for the authoring server process to enable the Assistant.`, false);
    // The SDK would otherwise also consult ANTHROPIC_BASE_URL/AUTH_TOKEN; this adapter uses only the configured key and origin.
    if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key, authToken: null, baseURL: config.baseUrl, maxRetries: 2, timeout: REQUEST_TIMEOUT_MS }); clientKey = key; }
    return client;
  };
  const toParam = (block: ProviderBlock): Anthropic.Beta.BetaContentBlockParam => {
    switch (block.type) {
      case "text": return { type: "text", text: block.text };
      case "tool_use": return { type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> };
      case "tool_result": return { type: "tool_result", tool_use_id: block.toolUseId, content: block.content, ...(block.isError ? { is_error: true } : {}) };
      case "opaque": return block.value as Anthropic.Beta.BetaContentBlockParam;
    }
  };
  const mapError = (error: unknown): ProviderError => {
    if (error instanceof ProviderError) return error;
    if (error instanceof Anthropic.APIUserAbortError) return new ProviderError("aborted", "Stopped.", false);
    if (error instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", "The model provider timed out.", true);
    if (error instanceof Anthropic.APIConnectionError) return new ProviderError("transport", "The model provider could not be reached.", true);
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new ProviderError("auth", `The model provider rejected the credential in ${config.apiKeyEnv}.`, false);
    if (error instanceof Anthropic.RateLimitError) return new ProviderError("quota", "The model provider's rate limit or quota was reached. Try again later.", true);
    if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError || error instanceof Anthropic.UnprocessableEntityError) return new ProviderError("invalid-request", `The model provider refused the request (${error.status}). Check the configured model "${config.model}".`, false);
    if (error instanceof Anthropic.APIError) return new ProviderError(error.status === 529 ? "overloaded" : "transport", error.status === 529 ? "The model provider is overloaded. Try again shortly." : `The model provider returned an error (${error.status ?? "unknown"}).`, true);
    // The SDK raises a plain error when eager tool input cannot be parsed at all.
    return new ProviderError("malformed-output", "The model returned output that could not be parsed.", true);
  };
  return {
    status() {
      if (!credential()) return { ok: false, code: "missing-credential", message: `The Assistant is configured for Anthropic (${config.model}), but ${config.apiKeyEnv} is not set for the authoring server.`, provider: "anthropic", model: config.model };
      return { ok: true, provider: "anthropic", model: config.model };
    },
    async turn(request: ProviderRequest): Promise<ProviderTurn> {
      try {
        const stream = connect().beta.messages.stream({
          model: config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: request.system,
          messages: request.messages.map(message => ({ role: message.role, content: message.content.map(toParam) })),
          tools: request.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema, eager_input_streaming: true })),
          tool_choice: { type: "auto" },
          thinking: { type: "adaptive" },
          output_config: { effort: config.effort },
          // Refusal fallback routed server-side by category; no model list to maintain.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        }, { signal: request.signal });
        stream.on("text", delta => request.onText(delta));
        const message = await stream.finalMessage();
        const content: ProviderBlock[] = message.content.flatMap((block): ProviderBlock[] => {
          if (block.type === "text") return [{ type: "text", text: block.text }];
          if (block.type === "tool_use") return [{ type: "tool_use", id: block.id, name: block.name, input: block.input }];
          // Thinking and fallback blocks are replayed unchanged within this run only.
          return [{ type: "opaque", value: block }];
        });
        const stop = message.stop_reason;
        return { content, stopReason: stop === "end_turn" || stop === "tool_use" || stop === "max_tokens" || stop === "refusal" ? stop : "other" };
      } catch (error) { throw mapError(error); }
    },
  };
}
