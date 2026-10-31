import type { AssistantConfig } from "../config/assistant";
import { createModelProvider } from "../assistant/provider-factory";
import { createFakeContentAiProposer, type ContentAiProposer } from "../../src/content/editorial/ai";
import { createModelContentAiProposer } from "./model-proposer";

/**
 * Content-AI uses the host's one configured Assistant provider. The fake
 * provider gets the deterministic Content-AI fake; a CLI or API provider is
 * used as configured, with the owner's own sign-in, and never replaced.
 */
export async function createContentAiProposer(config: AssistantConfig): Promise<ContentAiProposer> {
  if (config.provider === "fake") return createFakeContentAiProposer();
  const provider = createModelProvider(config);
  const status = await provider.status();
  return createModelContentAiProposer(provider, status.label);
}
