import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import type { ProductionProviderIntegration } from "../../../app/provider-integration";
import { project } from "../../../site-project/compiler/__tests__/fixtures";
import { createReleaseController } from "../controller";
import { ReleaseRoute } from "../release-route";

afterEach(cleanup);
it("renders real static inspection and explanatory disabled release actions", async () => {
  const request = vi.fn();
  const controller = createReleaseController({ workspace: { id: "static" }, subscribeChanges: () => () => {}, getCurrentSiteProject: async () => ({ status: "ready", project: project() }) } as unknown as ProductionProviderIntegration, { available: false, request, subscribe: () => () => {}, dispose: () => {} });
  render(<ReleaseRoute controller={controller} href={() => null} />);
  expect(await screen.findByRole("heading", { name: "Review & release" })).toBeVisible();
  expect(screen.getByText(/Static read-only mode/)).toBeVisible();
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Export working JSON" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Run release checks" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Activate locally" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Working draft preview" })).toHaveAttribute("href", "/website-preview");
  expect(screen.getByRole("link", { name: "Activated website" })).toHaveAttribute("href", "/site");
  expect(request).not.toHaveBeenCalled(); controller.dispose();
});
