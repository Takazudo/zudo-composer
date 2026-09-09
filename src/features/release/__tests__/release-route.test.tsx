import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import type { ProductionProviderIntegration } from "../../../app/provider-integration";
import { project } from "../../../site-project/compiler/__tests__/fixtures";
import { createReleaseController } from "../controller";
import type { ReleaseController, ReleaseState } from "../controller";
import type { ReleasePlan } from "../../../site-project/api/types";
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

function stubController(overrides: Partial<ReleaseState> = {}): ReleaseController {
  const state: ReleaseState = {
    busy: false, phase: "inspect", message: "Inspect the working workspace before review.",
    error: null, changed: false, plan: null, working: null, choices: [], selection: [],
    active: null, staged: null, stageGeneration: null, completed: null, retainedStages: [], gateBlocked: false,
    ...overrides,
  };
  return {
    available: true, getSnapshot: () => state, subscribe: () => () => {},
    inspect: vi.fn(async () => {}), selectStage: vi.fn(async () => {}), select: vi.fn(),
    review: vi.fn(async () => {}), approve: vi.fn(), apply: vi.fn(async () => {}),
    build: vi.fn(async () => {}), activate: vi.fn(async () => {}), reconcile: vi.fn(async () => {}),
    discard: vi.fn(async () => {}), newReview: vi.fn(), exportProject: vi.fn(() => null), dispose: vi.fn(),
  } satisfies ReleaseController;
}

const originalLabels = [
  "Inspect current state", "Export working JSON", "Run release checks", "Approve reviewed candidate",
  "Apply / stage exact candidate", "Build staged candidate", "Activate locally", "Retry publication reconciliation",
  "Discard unbuilt stage", "Review remaining working changes",
];

it("renders the empty snapshot in the library shell with bounded cards and grouped actions", () => {
  const { container } = render(<ReleaseRoute controller={stubController()} href={() => null} />);
  expect(container.querySelector(".cms-library__title")).toHaveTextContent("Review & release");
  expect(container.querySelector(".cms-pane__header")).toBeNull();
  expect(container.querySelectorAll(".cms-release__card").length).toBeGreaterThanOrEqual(2);
  for (const name of originalLabels) expect(screen.getByRole("button", { name })).toBeVisible();
  expect(screen.getByRole("group", { name: "Release pipeline" }).querySelectorAll("button")).toHaveLength(8);
  expect(screen.getByRole("button", { name: "Discard unbuilt stage" })).toHaveClass("cms-btn--danger");
});

function populatedPlan(): ReleasePlan {
  return {
    schemaVersion: 2, workingProject: project(), workingPrecondition: {}, candidate: project(), selection: [],
    expectedRevision: null, expectedActive: null, storeGeneration: 0, projectRevision: "a".repeat(64), buildId: "b".repeat(64),
    assetLock: null, toolchain: { compiler: "test", componentPack: { packId: "test", packVersion: "1", contractVersion: 1 }, packSpecifier: "@fixture/pack/composer-pack", packSource: "workspace:*", installedPackDigest: "c".repeat(64), contractDigest: "d".repeat(64) },
    changes: [{ kind: "changed", domain: "content", providerId: "local", recordId: "entry" }],
    checks: [{ severity: "blocking", code: "missing", message: "Missing linked record", path: "content/" + "a".repeat(64) }],
    affected: [{ kind: "route", identity: "/site/" + "b".repeat(64), reason: "Content changed" }],
    publication: [], planDigest: "c".repeat(64),
  };
}

it("renders populated review cards, error and blocking check without losing identities or labels", () => {
  const plan = populatedPlan();
  const { container } = render(<ReleaseRoute controller={stubController({
    working: project(), plan, phase: "reviewed", error: "Release failed", changed: true, gateBlocked: true,
    active: { projectId: "local", revision: "d".repeat(64), buildId: "e".repeat(64) },
    staged: { schemaVersion: 2, projectId: "local", revision: plan.projectRevision, buildId: plan.buildId, assetLock: null, toolchain: plan.toolchain, planDigest: plan.planDigest, publication: [] },
    retainedStages: [{ projectId: "first", buildId: "a".repeat(64), stageGeneration: 1 }, { projectId: "second", buildId: "b".repeat(64), stageGeneration: 2 }],
  })} href={() => "/content"} />);
  expect(container.querySelector(".cms-library__title")).toHaveTextContent("Review & release");
  expect(container.querySelectorAll(".cms-release__card").length).toBeGreaterThanOrEqual(5);
  expect(container.querySelector(".cms-pane__header")).toBeNull();
  for (const name of [...originalLabels, "Inspect stage aaaaaaaa", "Inspect stage bbbbbbbb"]) expect(screen.getByRole("button", { name })).toBeVisible();
  expect(screen.getByRole("alert")).toHaveClass("cms-banner--err");
  expect(screen.getByRole("alert")).toHaveTextContent("Release failed");
  expect(screen.getByText("blocking")).toHaveClass("cms-chip--err");
  expect(container.querySelectorAll(".cms-banner--warn")).toHaveLength(2);
  expect(container.querySelector(".cms-release__digest code")?.textContent).toBe(plan.planDigest);
  expect(container.querySelector(".cms-release__digest wbr")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Approve reviewed candidate" })).toBeDisabled();
});

const phaseActions = [
  ["inspect", "Run release checks"], ["reviewed", "Approve reviewed candidate"],
  ["approved", "Apply / stage exact candidate"], ["staged", "Build staged candidate"],
  ["built", "Activate locally"], ["activated", "Review remaining working changes"],
  ["uncertain", "Review remaining working changes"],
] as const;

it.each(phaseActions)("keeps exactly one phase action primary in %s, even when unavailable", (phase, label) => {
  for (const mode of ["ready", "busy", "gate", "static"] as const) {
    const controller = stubController({ phase, busy: mode === "busy", gateBlocked: mode === "gate" });
    controller.available = mode !== "static";
    const { container, unmount } = render(<ReleaseRoute controller={controller} href={() => null} />);
    expect(container.querySelectorAll(".cms-btn--primary")).toHaveLength(1);
    expect(screen.getByRole("button", { name: label })).toHaveClass("cms-btn--primary");
    if (mode === "busy" || mode === "gate" || phase === "uncertain" || (mode === "static" && phase !== "activated")) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    unmount();
  }
});
