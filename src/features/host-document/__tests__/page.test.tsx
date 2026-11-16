import { cleanup, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { HostDocumentPage } from "../page";
const mocks = vi.hoisted(() => ({ request: vi.fn(), integration: { workspace: { id: "proof" }, subscribeChanges: () => () => {} } }));
vi.mock("../../native-editing/session", () => ({ nativeEditRequest: mocks.request }));
vi.mock("../../../app/workspace-context", () => ({ useWorkspace: () => ({ integration: mocks.integration }) }));
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); });
it("does not enroll an empty, unresponsive iframe before the saved document arrives", async () => {
  let finish!: (value: unknown) => void;
  mocks.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { container, getByRole } = render(<HostDocumentPage />);
  await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  expect(container.querySelector("iframe")).toBeNull();
  expect(getByRole("status").textContent).toBe("Opening saved page…");
  finish({ identity: { workspaceId: "proof", pathname: "/", revision: "a".repeat(64), packId: "proof", packVersion: "1", rendererId: "proof", rendererVersion: "1", rendererDigest: "b".repeat(64) }, frameId: "frame", documentUrl: "/__zudo-host-document/token", html: "<html><body>Saved</body></html>", routes: [], targets: [] });
  await waitFor(() => expect(container.querySelector("iframe")?.getAttribute("src")).toBe("/__zudo-host-document/token"));
});
