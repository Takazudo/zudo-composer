import type { AssistantConfig } from "../config/assistant";
import { createModelProvider } from "../assistant/provider-factory";
import { createFakeContentAiProvider, createModelContentAiProvider, type ContentAiProvider } from "./provider";

/**
 * Content-AI uses the host's one configured Assistant provider. The fake
 * provider gets the deterministic Content-AI fake; a CLI or API provider is
 * used as configured, with the owner's own sign-in, and never replaced.
 */
export async function createHostContentAiProvider(config: AssistantConfig): Promise<ContentAiProvider> {
  if (config.provider === "fake") return createFakeContentAiProvider();
  return createModelContentAiProvider(config.provider, createModelProvider(config));
}
