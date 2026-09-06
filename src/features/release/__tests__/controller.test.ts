import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductionProviderIntegration } from "../../../app/provider-integration";
import { createWorkspaceSaveRegistry } from "../../../app/workspace-sessions";
import { project } from "../../../site-project/compiler/__tests__/fixtures";
import type { ReleasePlan, SiteProjectApiRequest, SiteProjectApiResponse, StagedRelease, SiteProjectActiveSelection } from "../../../site-project/api/types";
import { createReleaseController } from "../controller";
import type { ReleaseTransport } from "../transport";

function harness() {
  let working = project(), generation = 0, listener = () => {}, releaseListener = () => {};
  let staged: StagedRelease | null = null, active: SiteProjectActiveSelection | null = null, built = false;
  let fail: string | null = null, uncertain = false;
  const requests: SiteProjectApiRequest[] = [];
  const sessions = createWorkspaceSaveRegistry();
  const integration = { workspace: { id: "release-test" }, sessions, contentProviders: [],
    captureWorkspace: vi.fn(async () => ({ status: "ready", project: structuredClone(working), capture: { workspaceId: "release-test", sessionGeneration: generation, tokens: { workspace: generation }, values: {} } })),
    getCurrentSiteProject: async () => ({ status: "ready", project: working }),
    isCaptureCurrent: async (capture: { sessionGeneration: number }) => capture.sessionGeneration === generation,
    subscribeChanges: (next: () => void) => { listener = next; return () => {}; },
  } as unknown as ProductionProviderIntegration;
  let guard!: (payload: unknown) => Promise<unknown>;
  const transport: ReleaseTransport = { available: true, dispose: vi.fn(), subscribe(next) { releaseListener = next; return () => {}; }, async request(request, verify) {
    requests.push(request); if (verify) guard = verify;
    if (fail === request.operation) return { ok: false, error: { code: uncertain ? "commit-uncertain" : "conflict", message: "injected failure" } };
    let result: unknown;
    if (request.operation === "list") result = { projects: staged ? [{ projectId: staged.projectId, head: staged.revision, stages: [staged.buildId] }] : [], active, generation: staged ? 1 : 0, stageGenerations: staged ? { [staged.buildId]: 1 } : {} };
    if (request.operation === "get") result = { project: working };
    if (request.operation === "plan") result = { schemaVersion: 2, workingProject: structuredClone(working), workingPrecondition: request.workingPrecondition, candidate: structuredClone(working), selection: request.selection, expectedRevision: null, expectedActive: active, storeGeneration: 0, projectRevision: "a".repeat(64), buildId: "b".repeat(64), mediaLock: null, toolchain: { compiler: "test", componentPack: { packId: "test", packVersion: "1", contractVersion: 1 }, providerCommit: "a".repeat(40), providerTree: "b".repeat(40), installedProviderDigest: "c".repeat(64), contractDigest: "d".repeat(64) }, changes: [], checks: [{ severity: "info", code: "ready", message: "Ready", path: "$" }], affected: [], publication: [], planDigest: "c".repeat(64) } satisfies ReleasePlan;
    if (request.operation === "apply") { if (!await verify!({ kind: "current", project: request.plan.workingProject, precondition: request.plan.workingPrecondition })) return { ok: false, error: { code: "conflict", message: "stale" } }; const p = request.plan; staged = { schemaVersion: 2, projectId: p.candidate.id, revision: p.projectRevision, buildId: p.buildId, mediaLock: p.mediaLock, toolchain: p.toolchain, planDigest: p.planDigest, publication: p.publication }; result = { staged, stageGeneration: 1 }; }
    if (request.operation === "build" || request.operation === "completed") { if (request.operation === "completed" && !built) return { ok: false, error: { code: "not-found", message: "Not built" } }; built = true; result = { identity: { projectId: staged!.projectId, revision: staged!.revision, buildId: staged!.buildId }, stage: staged, files: {}, completionDigest: "d".repeat(64), build: {} }; }
    if (request.operation === "activate") { active = { projectId: request.projectId, revision: request.revision, buildId: request.buildId }; result = { active, reconciliation: "changed" }; }
    if (request.operation === "discard") { staged = null; result = { active }; }
    return { ok: true, result } as SiteProjectApiResponse;
  } };
  const controller = createReleaseController(integration, transport);
  const edit = () => { working = { ...working, name: "B" }; generation++; listener(); };
  const ready = async () => { await controller.inspect(); await controller.review(); controller.approve(); };
  return { controller, integration, transport, requests, ready, edit, guard: (payload: unknown) => guard(payload), releaseChanged: () => releaseListener(), fail(operation: string | null, unknown = false) { fail = operation; uncertain = unknown; }, working: () => working };
}
afterEach(() => localStorage.clear());
describe("review and release state machine", () => {
  it.each([["new", "publish"], ["changed", "publish"], ["deleted", "delete"], ["unpublish", "unpublish"]] as const)("sends explicit %s selection as %s without changing working lifecycle", async (kind, action) => { const h = harness(); await h.controller.inspect(); const before = structuredClone(h.working()); const ref = { providerId: "content-indexeddb", modelId: "articles", recordId: "entry" }; h.controller.select({ ref, kind }, true); await h.controller.review(); expect(h.requests.find(({ operation }) => operation === "plan")).toMatchObject({ selection: [{ ref, action }] }); expect(h.working()).toEqual(before); h.controller.dispose(); });
  it("invalidates unstaged approval for a working/provider change", async () => { const h = harness(); await h.ready(); h.edit(); await h.controller.apply(); expect(h.requests.some(({ operation }) => operation === "apply")).toBe(false); expect(h.controller.getSnapshot().phase).toBe("inspect"); h.controller.dispose(); });
  it("stages A then retains edited B through exact build/activation and reload inspection", async () => {
    const h = harness(); await h.ready(); await h.controller.apply(); const a = h.controller.getSnapshot().staged; h.edit();
    await h.controller.build(); await h.controller.activate(); expect(h.controller.getSnapshot()).toMatchObject({ phase: "activated", staged: a }); expect(h.working().name).toBe("B");
    h.controller.dispose(); const reloaded = createReleaseController(h.integration, h.transport); await reloaded.inspect(); expect(reloaded.getSnapshot()).toMatchObject({ phase: "activated", staged: a, working: { name: "B" } }); reloaded.dispose();
  });
  it("rejects cross-workspace and altered candidate challenges", async () => { const h = harness(); await h.ready(); const plan = h.controller.getSnapshot().plan!; expect(await h.guard({ kind: "current", project: plan.workingProject, precondition: { ...plan.workingPrecondition as object, workspaceId: "other" } })).toBe(false); expect(await h.guard({ kind: "current", project: { ...plan.workingProject, name: "changed" }, precondition: plan.workingPrecondition })).toBe(false); h.controller.dispose(); });
  it("blocks plan on save/capture failure", async () => { const h = harness(); vi.mocked(h.integration.captureWorkspace).mockResolvedValue({ status: "save-failed", failures: [{ feature: "Content", providerId: "db", error: new Error("disk full") }] }); await h.controller.review(); expect(h.controller.getSnapshot().error).toContain("disk full"); expect(h.requests).toHaveLength(0); h.controller.dispose(); });
  it("retains exact stage across build failure and forbids blind retry after uncertainty", async () => { const h = harness(); await h.ready(); await h.controller.apply(); h.fail("build", true); await h.controller.build(); expect(h.controller.getSnapshot().phase).toBe("uncertain"); h.fail(null); await h.controller.build(); expect(h.requests.filter(({ operation }) => operation === "build")).toHaveLength(1); await h.controller.inspect(); expect(h.controller.getSnapshot().phase).toBe("staged"); await h.controller.build(); expect(h.controller.getSnapshot().phase).toBe("built"); h.controller.dispose(); });
  it("discards with exact inspected stage incarnation and active precondition", async () => { const h = harness(); await h.ready(); await h.controller.apply(); await h.controller.discard(); expect(h.requests.at(-1)).toMatchObject({ operation: "discard", expectedStageGeneration: 1, expectedActive: null }); h.controller.dispose(); });
  it("recovers exact staged A even when newer B cannot be captured", async () => { const h = harness(); await h.ready(); await h.controller.apply(); h.controller.dispose(); vi.mocked(h.integration.captureWorkspace).mockResolvedValue({ status: "save-failed", failures: [{ feature: "Content", providerId: "db", error: new Error("invalid B") }] }); const reloaded = createReleaseController(h.integration, h.transport); await reloaded.inspect(); expect(reloaded.getSnapshot()).toMatchObject({ phase: "staged", error: "invalid B" }); await reloaded.build(); expect(reloaded.getSnapshot().phase).toBe("built"); reloaded.dispose(); });
  it("static mode inspects without pretending Media or write capability exists", async () => { const h = harness(); const transport = { ...h.transport, available: false, request: vi.fn(h.transport.request) }; const controller = createReleaseController(h.integration, transport); await controller.inspect(); await controller.review(); expect(controller.exportProject()).toContain(h.working().name); expect(transport.request).not.toHaveBeenCalled(); controller.dispose(); h.controller.dispose(); });
});
