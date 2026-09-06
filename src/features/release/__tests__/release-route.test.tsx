import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import type { ProductionProviderIntegration } from "../../../app/provider-integration";
import { project } from "../../../site-project/compiler/__tests__/fixtures";
import { createReleaseController } from "../controller";
import { ReleaseRoute } from "../release-route";

afterEach(cleanup);
it("offers each retained server stage with its exact incarnation", () => {
  const base = createReleaseController({ workspace: { id: "chooser" }, subscribeChanges: () => () => {} } as unknown as ProductionProviderIntegration, { available: true, request: vi.fn(), subscribe: () => () => {}, dispose: () => {} });
  const retainedStages = [{ projectId: "first-project", buildId: "a".repeat(64), stageGeneration: 1 }, { projectId: "second-project", buildId: "b".repeat(64), stageGeneration: 9 }];
  const selectStage = vi.fn(), state = { ...base.getSnapshot(), working: project(), retainedStages };
  render(<ReleaseRoute controller={{ ...base, getSnapshot: () => state, selectStage }} href={() => null} />);
  fireEvent.click(screen.getByRole("button", { name: "Inspect stage bbbbbbbb" }));
  expect(selectStage).toHaveBeenCalledWith(retainedStages[1]); expect(screen.getByRole("button", { name: "Inspect stage aaaaaaaa" })).toBeEnabled(); base.dispose();
});
it("renders real static inspection and explanatory disabled release actions", async () => {
  const request = vi.fn();
  const controller = createReleaseController({ workspace: { id: "static" }, subscribeChanges: () => () => {}, getCurrentSiteProject: async () => ({ status: "ready", project: project() }) } as unknown as ProductionProviderIntegration, { available: false, request, subscribe: () => () => {}, dispose: () => {} });
  render(<ReleaseRoute controller={controller} href={() => null} />);
  expect(await screen.findByRole("heading", { name: "Review & release" })).toBeVisible();
  expect(screen.getByText(/Static read-only mode/)).toBeVisible();
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Export working JSON" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Run release checks" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Activate locally" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Live working preview" })).toHaveAttribute("href", "/website-preview");
  expect(screen.getByRole("link", { name: "Activated local website (not deployed)" })).toHaveAttribute("href", "/site");
  expect(request).not.toHaveBeenCalled(); controller.dispose();
});
