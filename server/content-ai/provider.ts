import type { AssistantProviderKind } from "../config/assistant";
import type { ModelProvider, ProviderStatus } from "../assistant/provider";
import { createFakeContentAiProposer, type ContentAiProposer } from "../../src/content/editorial/ai";
import type { ContentAiInference } from "../../src/content/editorial/ai-operations";
import { createModelContentAiProposer, redactLocalPaths } from "./model-proposer";

/** One selected Content-AI provider: the proposer and its own availability check. Never a fallback to another. */
export interface ContentAiProvider {
  readonly kind: AssistantProviderKind;
  readonly label: string;
  readonly proposer: ContentAiProposer;
  /** Re-checked on every call, so an install or sign-in shows up without a restart. Never calls a model. */
  inference(): Promise<ContentAiInference>;
}

/** A local check that passed is reported as such; an undeterminable one is never reported as signed in. */
export function contentAiInference(status: ProviderStatus): ContentAiInference {
  const identity = `${status.label}${status.version ? ` ${status.version}` : ""}`;
  if (status.ok) return { state: "ready", detail: `${identity}: the local check passed. No model call has been made yet.`, version: status.version };
  if (status.code === "probe-failed") return { state: "unknown", message: redactLocalPaths(status.message) };
  return { state: "unavailable", code: status.code, message: redactLocalPaths(status.message) };
}

export function createFakeContentAiProvider(): ContentAiProvider {
  const proposer = createFakeContentAiProposer();
  return { kind: "fake", label: proposer.label, proposer, inference: async () => ({ state: "ready", detail: "Offline deterministic fake: it never contacts a model, and its output is not evidence of model behavior." }) };
}

export async function createModelContentAiProvider(kind: Exclude<AssistantProviderKind, "fake">, model: ModelProvider): Promise<ContentAiProvider> {
  const label = (await model.status()).label;
  return { kind, label, proposer: createModelContentAiProposer(model, label), inference: async () => contentAiInference(await model.status()) };
}
