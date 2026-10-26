import type { AssistantConfig } from "../config/assistant";
import { createAnthropicProvider } from "./anthropic-provider";
import { claudeCliProtocol } from "./claude-cli-provider";
import { createCliProvider } from "./cli-provider";
import { codexCliProtocol } from "./codex-cli-provider";
import { createFakeProvider } from "./fake-provider";
import type { ModelProvider } from "./provider";

/** The one provider the host selected. There is no fallback between providers. */
export function createModelProvider(config: AssistantConfig, env: NodeJS.ProcessEnv = process.env): ModelProvider {
  switch (config.provider) {
    case "anthropic": return createAnthropicProvider(config, env);
    case "fake": return createFakeProvider();
    case "claude-cli": return createCliProvider(config, claudeCliProtocol, env);
    case "codex-cli": return createCliProvider(config, codexCliProtocol, env);
  }
}
