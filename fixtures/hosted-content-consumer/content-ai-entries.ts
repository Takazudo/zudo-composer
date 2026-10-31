// Type smoke for the advertised Content-AI imports, resolved through the installed package's exports.
import { CONTENT_AI_FIELD_KEYS, EditorialError, contentAiCandidateDigest, createContentAiService, createFakeContentAiProposer, createHostedContentEditorial,
  createMemoryContentAiProposalStore, runContentAiOperation } from "zudo-composer/hosted-content";
import type { ContentAiOperationHost, ContentAiProposalStore, ContentAiStatus, ContentAiWireOperation, ContentAiWireResult } from "zudo-composer/hosted-content";
import { createRemoteContentAi, type RemoteContentAi } from "zudo-composer/hosted-content/editor";
import { createContentAiProvider, type ContentAiInference, type ContentAiProvider, type ContentAiProviderConfig } from "zudo-composer/hosted-content/node";
import "zudo-composer/hosted-content/editor.css";

export const portable = { CONTENT_AI_FIELD_KEYS, EditorialError, contentAiCandidateDigest, createContentAiService, createFakeContentAiProposer, createHostedContentEditorial,
  createMemoryContentAiProposalStore, runContentAiOperation };
export const store: () => ContentAiProposalStore = createMemoryContentAiProposalStore;
export const operation: ContentAiWireOperation = "content-ai-status";
export async function host(provider: ContentAiProvider | null, service: ContentAiOperationHost["service"]): Promise<ContentAiWireResult> {
  const off: ContentAiInference = { state: "unavailable", code: "off", message: "off" };
  const status = async (): Promise<ContentAiStatus> => ({ configured: true, provider: provider?.label ?? "Off", canApply: true, inference: provider ? await provider.inference() : off });
  return runContentAiOperation({ status, service }, operation, {});
}
export const remote: RemoteContentAi = createRemoteContentAi(async (name, payload) => ({ ok: true, value: { name, payload } }));
const config: ContentAiProviderConfig = { provider: "codex-cli", executable: "codex", timeoutMs: 60_000 };
export const provider: Promise<ContentAiProvider> = createContentAiProvider(config);
// @ts-expect-error The browser client is exported from /editor only; /browser is not a package entry.
import type { createRemoteContentAi as NotExported } from "zudo-composer/hosted-content/browser";
export type Unused = typeof NotExported;
