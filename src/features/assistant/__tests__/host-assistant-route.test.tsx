import { cleanup, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { HostAssistantRoute } from "../host-assistant-route";
import { writeHostSelection } from "../host-selection";
const mocks = vi.hoisted(() => ({ workspace: { id: "one" }, request: vi.fn(), preview: vi.fn() }));
vi.mock("../../../app/workspace-context", () => ({ useWorkspace: () => ({ integration: { workspace: mocks.workspace } }) }));
vi.mock("../../native-editing/session", () => ({ assistantConfig: {}, assistantRequest: mocks.request, nativeEditRequest: mocks.preview, assistantEvents: vi.fn() }));
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
