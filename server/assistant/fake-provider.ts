import { FAKE_POLICY_VERSION, fakeDecide } from "./fake-decide.mjs";
import { ProviderError, type ModelProvider, type ProviderRequest } from "./provider";
import { parseStructuredTurn, structuredRequestDocument } from "./structured-turn";

/**
 * Offline deterministic provider. It answers through the same structured
 * reply contract and validation as the CLI providers and never contacts a
 * model or network service. Its replies are not evidence of model behavior.
 */
export function createFakeProvider(): ModelProvider {
  const identity = { provider: "fake" as const, label: "Fake provider (offline, deterministic)", model: "fake", version: FAKE_POLICY_VERSION };
  return {
    status: () => ({ ok: true, ...identity }),
    async turn(request: ProviderRequest) {
      if (request.signal.aborted) throw new ProviderError("aborted", "Stopped.", false);
      const decision = fakeDecide(structuredRequestDocument(request) as unknown as Parameters<typeof fakeDecide>[0]);
      if (decision.hang) {
        request.onActivity?.("Fake provider is waiting until stopped");
        await new Promise<never>((_, reject) => request.signal.addEventListener("abort", () => reject(new ProviderError("aborted", "Stopped.", false)), { once: true }));
      }
      const { hang: _hang, ...reply } = decision;
      void _hang;
      return parseStructuredTurn(reply, request);
    },
  };
}
