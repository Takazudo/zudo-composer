import { fireEvent, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContentEntryRecord, createContentModelRecord } from "../../content";
import { mountHostedContentEditor } from "../editor";
import type { HostedContentEditorHandle } from "../editor";
import type { HostedCommand, HostedPolicy, HostedResult, HostedState, HostedTransport } from "../types";
const entry = { providerId: "content", modelId: "lesson", recordId: "lesson-entry" };
const selection = { entry, fieldId: "title" };
const policy: HostedPolicy = { models: [{ providerId: "content", modelId: "lesson", entryIds: ["lesson-entry"], fields: [{ fieldId: "title", replace: true }] }], collections: [], assets: [] };
function fixture() {
  const stamp = "2026-01-01T00:00:00.000Z";
  const state: HostedState = { draftRevision: "r0", baseline: { gitSha: "g0", contentDigest: "c0" }, definition: "d0", integrationFence: 0, providers: [{ providerId: "content", models: [createContentModelRecord({ name: "Lesson", kind: "single", fields: [{ id: "title", key: "title", label: "講座名", required: true, kind: "text" }, { id: "slug", key: "slug", label: "Slug", required: true, kind: "slug" }] }, { id: "lesson", timestamp: stamp })], entries: [createContentEntryRecord("lesson", { title: "初期値", slug: "fixed-route" }, { id: "lesson-entry", timestamp: stamp })] }] };
  const requests: HostedCommand[] = [];
  const transport: HostedTransport = {
    readState: async () => structuredClone(state), readReceipt: async () => null,
    execute: async (request): Promise<HostedResult> => {
      requests.push(request);
      if (request.kind === "set-fields") { Object.assign(state.providers[0]!.entries[0]!.values, request.values); state.draftRevision = "r1"; }
      return { state: structuredClone(state) };
    },
    getPublication: async () => { throw new Error("not used"); },
  };
  return { transport, requests, state: () => state };
}
const handles: HostedContentEditorHandle[] = [];
afterEach(() => { handles.forEach((h) => h.dispose()); handles.length = 0; document.body.replaceChildren(); });
function mount(transport: HostedTransport, extra = {}) {
  const container = document.createElement("div"); document.body.append(container);
  let key = 0; const handle = mountHostedContentEditor(container, { transport, policy, selection, createOperationKey: () => `op${++key}`, ...extra }); handles.push(handle); return handle;
}
describe("thin hosted content mount", () => {
  it("loads an authoritative existing Input and changes only its permitted stable field", async () => {
    const backend = fixture(); const handle = mount(backend.transport, { labels: { save: "保存" } }); await handle.ready;
    const input = await screen.findByRole("textbox", { name: "講座名" });
    expect(input).toHaveClass("cms-input"); expect(input).toHaveValue("初期値");
    fireEvent.input(input, { target: { value: "日本語の講座" } }); fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(handle.state.dirty).toBe(false));
    expect(backend.requests).toHaveLength(1); expect(backend.requests[0]).toMatchObject({ kind: "set-fields", entry, values: { title: "日本語の講座" }, clear: [] });
    expect(backend.state().providers[0]!.entries[0]!.values.slug).toBe("fixed-route");
  });
  it("mounts no local/schema/Raw/reset/Assets tools even with forbidden routes and queries", async () => {
    window.history.replaceState(null, "", "/assets?raw=true&schema=true&reset=true");
    const handle = mount(fixture().transport); await handle.ready; await screen.findByRole("textbox", { name: "講座名" });
    expect(screen.queryByRole("link")).toBeNull(); expect(screen.queryByRole("button", { name: /raw|schema|reset|asset|mapping|sitemap/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Slug" })).toBeNull();
    await expect(handle.navigate({ entry, fieldId: "slug" })).rejects.toThrow("not permitted");
    window.history.replaceState(null, "", "/");
  });
  it("does not show editable fallback data after failed authoritative loading", async () => {
    const backend = fixture(); backend.transport.readState = async () => { throw new Error("offline"); };
    const handle = mount(backend.transport); await expect(handle.ready).rejects.toThrow("offline");
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull()); expect(handle.state.content).toBeNull();
  });
  it("blocks host navigation on failed flush and retains values after presentation disposal", async () => {
    const backend = fixture(); backend.transport.execute = async () => { throw new Error("network uncertain"); }; const navigate = vi.fn();
    const handle = mount(backend.transport, { onNavigate: navigate }); await handle.ready;
    fireEvent.input(await screen.findByRole("textbox", { name: "講座名" }), { target: { value: "残す値" } });
    await expect(handle.navigate(selection)).rejects.toThrow("network uncertain"); expect(navigate).not.toHaveBeenCalled();
    const pending = handle.state.pending!.request; handle.dispose();
    expect(screen.queryByRole("textbox")).toBeNull(); expect(handle.state.content!.providers[0]!.entries[0]!.values.title).toBe("残す値"); expect(handle.state.pending!.request).toEqual(pending);
  });
});
