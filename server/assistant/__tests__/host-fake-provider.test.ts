import { expect, it } from "vitest";
import { createFakeProvider } from "../fake-provider";
import type { ProviderRequest } from "../provider";
it("uses the actual fake provider ownership response for canonical Content values", async () => {
  const provider = createFakeProvider();
  const base: ProviderRequest = { system: "rules", tools: ["inspect_owner", "propose_content", "propose_changes"].map(name => ({ name, description: "", inputSchema: {} })), signal: new AbortController().signal, onText() {}, messages: [{ role: "user", content: [{ type: "text", text: 'replace "100" with "120"\n\n<turn_context>\n</turn_context>' }] }] };
  const first = await provider.turn(base);
  expect(first.content).toEqual([{ type: "tool_use", id: "fake-0-0", name: "inspect_owner", input: {} }]);
  const second = await provider.turn({ ...base, messages: [...base.messages, { role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", toolUseId: "fake-0-0", content: JSON.stringify({ capabilityId: "cap", owner: { domain: "content", fieldIds: ["price-id"] }, field: { current: "100", prop: "text" } }) }] }] });
  expect(second.content).toEqual([{ type: "tool_use", id: "fake-1-0", name: "propose_content", input: { capabilityId: "cap", values: { "price-id": "120" }, summary: "Requested replacement in shared Content" } }]);
});
