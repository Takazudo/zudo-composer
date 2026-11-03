/* global document, localStorage */
import { afterEach, expect, it, vi } from "vitest";
import { mountArticleAiPanel } from "../../fixtures/hosted-content-consumer/article-cms/ui/ai-panel.mjs";

const entry = { providerId: "articles", modelId: "article", recordId: "one" };
const pointerKey = "article-cms:content-ai:articles/article/one";
const proposal = { id: "proposal", candidateDigest: "digest", expiresAt: "2099-01-01T00:00:00Z", summary: "Title edit", differences: [] };
function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
    else if (key === "disabled") element.disabled = value;
    else element.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) if (child != null) element.append(child);
  return element;
}
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); document.body.replaceChildren(); });

it.each(["truncated", "unavailable", "malformed", "pending"])("recovers %s mutation answers without resending", async failure => {
  let committed = false, applyCalls = 0, reads = 0;
  const onCommitted = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url.startsWith("/api/ai/candidate")) return { ok: true, json: async () => ({ proposalId: proposal.id, candidateDigest: "digest", identity: "render", renderData: [] }) };
    const { operation } = JSON.parse(options.body);
    if (operation === "content-ai-status") return { json: async () => ({ ok: true, value: { configured: true, canApply: true, provider: "fake", inference: { state: "ready" } } }) };
    if (operation === "content-ai-read") { reads++; return { json: async () => ({ ok: true, value: { proposal, applied: committed ? {} : null, undone: null } }) }; }
    if (operation === "content-ai-apply") {
      applyCalls++; committed = failure !== "pending";
      if (failure === "truncated") return { json: async () => JSON.parse('{"ok":true,') };
      return { json: async () => failure === "malformed" ? {} : ({ ok: false, error: { code: "unavailable", message: "Storage outcome unknown" } }) };
    }
    throw new Error(operation);
  }));
  localStorage.setItem(pointerKey, JSON.stringify({ proposalId: proposal.id, pending: null }));
  const container = document.createElement("div"); document.body.append(container);
  const panel = mountArticleAiPanel(container, { h, entry, handle: () => ({ state: { dirty: false } }), frame: { clear() {}, async render() {} }, fieldLabel: x => x, onCommitted });
  await panel.ready;
  await vi.waitFor(() => expect(panel.state.phase).toBe("ready"));
  const beforeReads = reads;
  Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Apply proposal").click();
  await vi.waitFor(() => expect(reads).toBeGreaterThan(beforeReads));
  await vi.waitFor(() => expect(panel.state.phase).toBe(failure === "pending" ? "ready" : "applied"));
  expect(applyCalls).toBe(1);
  expect(JSON.parse(localStorage.getItem(pointerKey)).pending).toBe(failure === "pending" ? "apply" : null);
  expect(container.textContent).not.toContain("Not applied");
  if (failure === "pending") expect(container.textContent).toContain("Check again");
  else expect(onCommitted).toHaveBeenCalledOnce();
  panel.dispose();
});
