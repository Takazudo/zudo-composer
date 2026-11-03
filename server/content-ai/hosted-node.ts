// Node-only Content-AI providers for a host that runs inference itself. The
// host selects one provider at startup from its own trusted configuration;
// nothing here reads a request, a model reply or a browser value. CLI
// providers reuse the Assistant's restricted one-reply launcher and the
// owner's existing CLI sign-in, and are never replaced by another provider.
import { parseAssistant, type CliAssistantConfig } from "../config/assistant";
import { claudeCliProtocol } from "../assistant/claude-cli-provider";
import { createCliProvider } from "../assistant/cli-provider";
import { codexCliProtocol } from "../assistant/codex-cli-provider";
import { createFakeContentAiProvider, createModelContentAiProvider, type ContentAiProvider } from "./provider";

export type { ContentAiProvider } from "./provider";
export type { ContentAiInference } from "../../src/content/editorial/ai-operations";

export type ContentAiProviderConfig =
  | { provider: "fake" }
  | {
    provider: "claude-cli" | "codex-cli";
    /** Executable name looked up on PATH, or an absolute path. Never a command line. */
    executable?: string;
    /** `null` or omitted uses the CLI's own default model. */
    model?: string | null;
    effort?: "low" | "medium" | "high" | null;
    /** Upper bound for one model reply, 5000–900000 ms. */
    timeoutMs?: number;
  };

export interface ContentAiProviderOptions {
  /** The environment the CLI inherits; defaults to this process's. Composer's own ZUDO_ASSISTANT_* variables are always withheld. */
  env?: Record<string, string | undefined>;
}

/**
 * The one Content-AI provider a host selected. `fake` is the offline
 * deterministic proposer; `claude-cli` and `codex-cli` run the locally
 * installed, already signed-in CLI with Composer's restricted profile.
 */
export async function createContentAiProvider(config: ContentAiProviderConfig, options: ContentAiProviderOptions = {}): Promise<ContentAiProvider> {
  const kind = (config as { provider?: unknown } | null)?.provider;
  if (kind !== "fake" && kind !== "claude-cli" && kind !== "codex-cli") throw new Error('Content-AI provider must be "fake", "claude-cli" or "codex-cli".');
  if (kind === "fake") {
    if (Object.keys(config).length !== 1) throw new Error('The "fake" Content-AI provider takes no other settings.');
    return createFakeContentAiProvider();
  }
  // The Assistant's own validation: bare command name or absolute path, bounded timeout, safe model id.
  const parsed = parseAssistant({ ...config, name: "Content-AI", permission: "apply" }) as CliAssistantConfig;
  const env = (options.env ?? process.env) as NodeJS.ProcessEnv;
  return createModelContentAiProvider(kind, createCliProvider(parsed, kind === "claude-cli" ? claudeCliProtocol : codexCliProtocol, env));
}
