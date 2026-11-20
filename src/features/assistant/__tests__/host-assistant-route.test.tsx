import { cleanup, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { HostAssistantRoute } from "../host-assistant-route";
import { writeHostSelection } from "../host-selection";
const mocks = vi.hoisted(() => ({ workspace: { id: "one" }, request: vi.fn(), preview: vi.fn(), ready: vi.fn(async () => {}) }));
vi.mock("../../../app/workspace-context", () => ({ useWorkspace: () => ({ integration: { workspace: mocks.workspace } }) }));
vi.mock("../../native-editing/session", () => ({ assistantConfig: {}, assistantRequest: mocks.request, nativeEditRequest: mocks.preview, assistantEvents: vi.fn(), waitForNativeAuthoringReady: mocks.ready }));
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks(); mocks.workspace.id = "one"; });
it("never carries a former workspace selection into the next workspace", async () => {
  const selection = { revision: "a".repeat(64), pathname: "/", target: { renderedNodeId: "node", providerId: "files", recordId: "page", nodeId: "node" }, prop: "text" };
  writeHostSelection(sessionStorage, "one", selection);
  mocks.request.mockImplementation(async operation => operation === "status" ? { destination: { provider: "fake", model: "fake" }, provider: { ok: true }, botName: "Assistant" } : []);
  mocks.preview.mockResolvedValue({ documentUrl: "about:blank" });
  const view = render(<HostAssistantRoute />);
  expect(view.getByText(/Selected owner: files\/page\/node/)).toBeTruthy();
  await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
  mocks.workspace.id = "two"; view.rerender(<HostAssistantRoute />);
  expect(view.queryByText(/Selected owner:/)).toBeNull();
  expect(view.getByText(/A previous conversation never supplies implicit edit authority/)).toBeTruthy();
  expect(mocks.preview.mock.calls).toHaveLength(1);
});
it("discovers a retained Apply even when source capture prevents loading conversations", async () => {
  const rendered = { reviewId: "retained-review", candidateDigest: "candidate", baseDigest: "base", identity: { workspaceId: "one" }, frameId: "frame" };
  localStorage.setItem("zudo-host-review-apply:one:retained-review", JSON.stringify(rendered));
  localStorage.setItem("zudo-host-review-apply:other:foreign-review", JSON.stringify(rendered));
  mocks.request.mockImplementation(async (operation) => {
    if (operation === "hostReview") return { id: "retained-review", operation: { domain: "content" }, ownerLabel: "Course", summary: "Price", status: "applied", affectedUses: [], routes: [] };
    if (operation === "applyHostReview") return { recovered: true };
    throw new Error("Canonical source cannot capture");
  });
  const view = render(<HostAssistantRoute />);
  const recover = await view.findByRole("button", { name: "Recover retained Apply" });
  const { fireEvent } = await import("@testing-library/preact"); fireEvent.click(recover);
  await waitFor(() => expect(mocks.request.mock.calls.some(([operation, workspace, input]) => operation === "applyHostReview" && workspace === "one" && JSON.stringify(input) === JSON.stringify({ reviewId: "retained-review", rendered }))).toBe(true));
  expect(mocks.request.mock.calls.some(([, , input]) => input?.reviewId === "foreign-review")).toBe(false);
});
it("finishes initial preview reconciliation before Assistant reads and conversation creation", async () => {
  const { fireEvent, act } = await import("@testing-library/preact");
  writeHostSelection(sessionStorage, "one", { revision: "a".repeat(64), pathname: "/", target: { renderedNodeId: "node", providerId: "files", recordId: "page", nodeId: "node" } });
  let finish!: (value: { documentUrl: string }) => void;
  mocks.preview.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mocks.request.mockImplementation(async operation => operation === "status" ? { destination: { provider: "fake", model: "fake" }, provider: { ok: true }, botName: "Assistant" } : []);
  const view = render(<HostAssistantRoute />);
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  const create = view.getByRole("button", { name: "New conversation" }) as HTMLButtonElement;
  expect(create.disabled).toBe(true);
  fireEvent.click(create);
  expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => finish({ documentUrl: "about:blank" }));
  await waitFor(() => expect(create.disabled).toBe(false));
  expect(mocks.request.mock.calls.map(([operation]) => operation).sort()).toEqual(["conversations", "status"]);
});
it("retains a successfully created conversation when the follow-up read is busy without replaying creation", async () => {
  const { fireEvent } = await import("@testing-library/preact");
  writeHostSelection(sessionStorage, "one", { revision: "a".repeat(64), pathname: "/", target: { renderedNodeId: "node", providerId: "files", recordId: "page", nodeId: "node" } });
  mocks.preview.mockResolvedValue({ documentUrl: "about:blank" });
  let created = false;
  mocks.request.mockImplementation(async operation => {
    if (operation === "status") return { destination: { provider: "fake", model: "fake" }, provider: { ok: true }, botName: "Assistant" };
    if (operation === "createConversation") { created = true; return { id: "saved", title: "New conversation", createdAt: "now", updatedAt: "now", messages: [] }; }
    if (created) throw Object.assign(new Error("Authoring is reconciling. Input is retained."), { code: "authoring-busy" });
    return [];
  });
  const view = render(<HostAssistantRoute />);
  const create = view.getByRole("button", { name: "New conversation" }) as HTMLButtonElement;
  await waitFor(() => expect(create.disabled).toBe(false));
  fireEvent.click(create);
  await view.findByRole("alert");
  expect(sessionStorage.getItem("zudo-host-assistant:one:conversation")).toBe("saved");
  expect((view.getByLabelText("Conversation") as HTMLSelectElement).value).toBe("saved");
  fireEvent.input(view.getByLabelText("Request"), { target: { value: "Change this value" } });
  await waitFor(() => expect((view.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.request.mock.calls.filter(([operation]) => operation === "createConversation")).toHaveLength(1);
});
it("loads Assistant state and enables conversation creation after a failed saved preview", async () => {
  writeHostSelection(sessionStorage, "one", { revision: "a".repeat(64), pathname: "/", target: { renderedNodeId: "node", providerId: "files", recordId: "page", nodeId: "node" } });
  mocks.preview.mockRejectedValue(new Error("Saved preview unavailable"));
  mocks.request.mockImplementation(async operation => operation === "status" ? { destination: { provider: "fake", model: "fake" }, provider: { ok: true }, botName: "Assistant" } : []);
  const view = render(<HostAssistantRoute />);
  await waitFor(() => expect((view.getByRole("button", { name: "New conversation" }) as HTMLButtonElement).disabled).toBe(false));
  expect(view.getByRole("alert").textContent).toBe("Saved preview unavailable");
  expect(mocks.request.mock.calls.map(([operation]) => operation).sort()).toEqual(["conversations", "status"]);
});
it("waits for the initial conversation read even when provider status fails", async () => {
  const { act } = await import("@testing-library/preact");
  sessionStorage.setItem("zudo-host-assistant:one:conversation", "old");
  let finish!: (value: unknown) => void;
  mocks.request.mockImplementation(async operation => {
    if (operation === "status") throw new Error("Status unavailable");
    if (operation === "conversation") return new Promise(resolve => { finish = resolve; });
    return [];
  });
  const view = render(<HostAssistantRoute />);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  const create = view.getByRole("button", { name: "New conversation" }) as HTMLButtonElement;
  expect(create.disabled).toBe(true);
  await act(async () => finish({ id: "old", title: "Old conversation", messages: [] }));
  await waitFor(() => expect(create.disabled).toBe(false));
});
it("ignores a former workspace preview that settles after a workspace switch", async () => {
  const { act } = await import("@testing-library/preact");
  writeHostSelection(sessionStorage, "one", { revision: "a".repeat(64), pathname: "/", target: { renderedNodeId: "node", providerId: "files", recordId: "page", nodeId: "node" } });
  let finish!: (value: { documentUrl: string }) => void;
  mocks.preview.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mocks.request.mockImplementation(async operation => operation === "status" ? { destination: { provider: "fake", model: "fake" }, provider: { ok: true }, botName: "Assistant" } : []);
  const view = render(<HostAssistantRoute />);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  mocks.workspace.id = "two"; view.rerender(<HostAssistantRoute />);
  await waitFor(() => expect((view.getByRole("button", { name: "New conversation" }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => finish({ documentUrl: "/old-document" }));
  expect(view.queryByTitle("Saved host page")).toBeNull();
  expect(mocks.request.mock.calls.every(([, workspace]) => workspace === "two")).toBe(true);
});

it("waits for client resume after the preview HTTP response before reading Assistant state", async () => {
  const { act } = await import("@testing-library/preact");
  writeHostSelection(sessionStorage, "one", { revision: "a".repeat(64), pathname: "/", target: { renderedNodeId: "node", providerId: "files", recordId: "page", nodeId: "node" } });
  mocks.preview.mockResolvedValue({ documentUrl: "about:blank" });
  let resume!: () => void;
  mocks.ready.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
  mocks.request.mockImplementation(async operation => operation === "status" ? { destination: { provider: "fake", model: "fake" }, provider: { ok: true }, botName: "Assistant" } : []);
  const view = render(<HostAssistantRoute />);
  await waitFor(() => expect(resume).toBeTypeOf("function"));
  expect(mocks.request).not.toHaveBeenCalled();
  expect((view.getByRole("button", { name: "New conversation" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => resume());
  await waitFor(() => expect((view.getByRole("button", { name: "New conversation" }) as HTMLButtonElement).disabled).toBe(false));
});
it("cancels the readiness wait when leaving the workspace and sends no late reads", async () => {
  const { act } = await import("@testing-library/preact");
  let signal: AbortSignal | undefined;
  let finish!: () => void;
  mocks.ready.mockImplementationOnce((...args: unknown[]) => { signal = args[0] as AbortSignal; return new Promise<void>(resolve => { finish = resolve; }); });
  const view = render(<HostAssistantRoute />);
  await waitFor(() => expect(signal).toBeTruthy());
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish());
  expect(mocks.request).not.toHaveBeenCalled();
});
