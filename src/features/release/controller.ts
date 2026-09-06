import type { JsonValue } from "@zudo-composer/component-contract";
import { getContentPublicationChanges, type ContentPublicationChange, type ContentPublicationSelection } from "../../content";
import type { ProductionProviderIntegration, WorkspaceProjectCaptureOutcome } from "../../app/provider-integration";
import type { CompletedRelease, ReleasePlan, SiteProjectActiveSelection, SiteProjectApiRequest, StagedRelease } from "../../site-project/api/types";
import { reconcileActivatedPublication } from "../../site-project/api/reconciliation";
import { validateStagedRelease } from "../../site-project/api/validation";
import { canonicalStringifyJson, serializeSiteProject } from "../../site-project/model/canonical";
import type { SiteProject } from "../../site-project/model";
import type { ReleaseTransport } from "./transport";
import { recordReleaseApproval, recordReleaseStage, releaseReceipts, subscribeReleaseJournal } from "./journal";

const json = (value: unknown) => canonicalStringifyJson(value as JsonValue);
const snapshots = (project: SiteProject) => project.providers.content.map((provider) => ({ providerId: provider.id, schemaVersion: 2 as const, mutationToken: 0, models: provider.models, entries: provider.entries }));
type Captured = Extract<WorkspaceProjectCaptureOutcome, { status: "ready" }>;
interface Catalog { projects: { projectId: string; head: string; stages: string[] }[]; active: SiteProjectActiveSelection | null; generation: number; stageGenerations: Record<string, number> }
export interface RetainedStage { projectId: string; buildId: string; stageGeneration: number }
export interface ReleaseState {
  busy: boolean; phase: "inspect" | "reviewed" | "approved" | "staged" | "built" | "activated" | "uncertain";
  message: string; error: string | null; changed: boolean; plan: ReleasePlan | null;
  working: SiteProject | null; choices: ContentPublicationChange[]; selection: ContentPublicationSelection[];
  active: SiteProjectActiveSelection | null; staged: StagedRelease | null; stageGeneration: number | null; completed: CompletedRelease | null;
  retainedStages: RetainedStage[];
}
/** Application-lifetime release session: unmount never cancels a staged mutation. */
export function createReleaseController(integration: ProductionProviderIntegration, transport: ReleaseTransport) {
  let state: ReleaseState = { busy: false, phase: "inspect", message: "Inspect the working workspace before review.", error: null, changed: false, plan: null, working: null, choices: [], selection: [], active: null, staged: null, stageGeneration: null, completed: null, retainedStages: [] };
  let captured: Captured | null = null, catalog: Catalog | null = null, epoch = 0;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<ReleaseState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const invalidate = () => { epoch++; emit({ changed: true, ...(state.phase === "approved" || state.phase === "reviewed" ? { phase: "inspect" as const } : {}) }); };
  const stopWorkspace = integration.subscribeChanges(invalidate), stopRelease = transport.subscribe(invalidate);
  const stopJournal = subscribeReleaseJournal(() => integration.workspace.id, () => emit({ message: "Local recovery receipts changed. Inspect the server catalog to refresh retained stages." }));
  const call = async <T,>(request: SiteProjectApiRequest): Promise<T> => {
    const result = await transport.request(request, guard);
    if (!result.ok) { if (result.error.code === "commit-uncertain") emit({ phase: "uncertain" }); throw new Error(`${result.error.code}: ${result.error.message}`); }
    return result.result as T;
  };
  const guard = async (payload: unknown): Promise<unknown> => {
    const value = payload as { kind?: string; project?: SiteProject; precondition?: JsonValue; active?: SiteProjectActiveSelection; changes?: unknown };
    if (value.kind === "current") return !!captured && json(value.precondition) === json(precondition(captured)) && serializeSiteProject(value.project!) === serializeSiteProject(captured.project) && await integration.isCaptureCurrent(captured.capture);
    return false;
  };
  const precondition = (value: Captured): JsonValue => ({ workspaceId: value.capture.workspaceId, sessionGeneration: value.capture.sessionGeneration, tokens: { ...value.capture.tokens } });
  const run = async (action: () => Promise<void>) => { if (state.busy) return; emit({ busy: true, error: null }); try { await action(); } catch (error) { emit({ error: error instanceof Error ? error.message : "Release operation failed." }); } finally { emit({ busy: false }); } };
  const capture = async () => { const outcome = await integration.captureWorkspace(); if (outcome.status !== "ready") throw new Error(outcome.status === "unavailable" ? outcome.error.message : outcome.status === "save-failed" ? outcome.failures.map(({ error }) => error.message).join("; ") : "Workspace changed during capture; retry after saving."); return outcome; };
  const readCatalog = async () => { catalog = await call<Catalog>({ protocolVersion: 2, operation: "list" }); emit({ active: catalog.active, retainedStages: catalog.projects.flatMap(({ projectId, stages }) => stages.map((buildId) => ({ projectId, buildId, stageGeneration: catalog!.stageGenerations[buildId]! }))) }); return catalog; };
  const reconcile = async () => {
    if (state.phase !== "activated" || !state.active || !state.completed) throw new Error("Inspect a matching activated build before reconciliation.");
    const reconciliation = state.working?.id === state.active.projectId ? await reconcileActivatedPublication({ active: state.active, stage: state.completed.stage, stores: integration.contentProviders.map(({ store }) => store), isActiveCurrent: async (active) => json((await call<Catalog>({ protocolVersion: 2, operation: "list" })).active) === json(active) }) : "changed";
    emit({ message: `Activated locally. Publication reconciliation: ${reconciliation}. Newer or different-project working drafts are retained.` });
  };
  const inspectStage = async (target: RetainedStage) => {
    const selected = await call<{ stage: StagedRelease; stageGeneration: number }>({ protocolVersion: 2, operation: "stage", projectId: target.projectId, buildId: target.buildId });
    if (!validateStagedRelease(selected.stage) || selected.stage.projectId !== target.projectId || selected.stage.buildId !== target.buildId || selected.stageGeneration !== target.stageGeneration) throw new Error("Stage incarnation changed; refresh the catalog before selecting it.");
    const result = await transport.request({ protocolVersion: 2, operation: "completed", projectId: target.projectId, buildId: target.buildId });
    if (result.ok) { const completed = result.result as unknown as CompletedRelease; emit({ staged: selected.stage, stageGeneration: selected.stageGeneration, completed, phase: json(catalog?.active) === json(completed.identity) ? "activated" : "built" }); }
    else if (result.error.code === "not-found") emit({ staged: selected.stage, stageGeneration: selected.stageGeneration, completed: null, phase: "staged" });
    else throw new Error(result.error.message);
  };
  return {
    getSnapshot: () => state, available: transport.available,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    inspect: () => run(async () => {
      if (!transport.available) { const next = await integration.getCurrentSiteProject(); if (next.status !== "ready") throw next.error; emit({ working: next.project, changed: false, message: "Static inspection/export only. Local release transport is absent; activated-baseline selection is unavailable." }); return; }
      await readCatalog();
      let target = state.staged ? state.retainedStages.find((item) => item.projectId === state.staged!.projectId && item.buildId === state.staged!.buildId) : undefined;
      if (!state.staged) { try { const receipts = releaseReceipts(integration.workspace.id!); const matches = state.retainedStages.filter((item) => receipts.some(({ stage, stageGeneration }) => stage.projectId === item.projectId && stage.buildId === item.buildId && stageGeneration === item.stageGeneration)); if (matches.length === 1) target = matches[0]; } catch { emit({ message: "Local journal unavailable; select retained stages from the authoritative server catalog." }); } }
      if (target) await inspectStage(target);
      else if (state.staged) emit({ phase: "inspect", staged: null, stageGeneration: null, completed: null, plan: null });
      const next = await capture();
      const baseline = catalog!.active?.projectId === next.project.id ? (await call<{ project: SiteProject }>({ protocolVersion: 2, operation: "get", projectId: catalog!.active.projectId, revision: catalog!.active.revision })).project : null;
      captured = next;
      const choices = getContentPublicationChanges(snapshots(next.project), baseline ? snapshots(baseline) : []);
      const selection = state.selection.filter(({ ref, action }) => choices.some((choice) => json(choice.ref) === json(ref) && action === (choice.kind === "deleted" ? "delete" : choice.kind === "unpublish" ? "unpublish" : "publish")));
      emit({ working: next.project, choices, selection, changed: false, ...(!state.staged ? { phase: "inspect" as const, plan: null } : {}), message: "Select Content publication changes, then run checks. Exact staged output is independent of working drafts." });
    }),
    selectStage: (target: RetainedStage) => run(async () => { await readCatalog(); if (!state.retainedStages.some((item) => json(item) === json(target))) throw new Error("Selected stage changed; choose its current incarnation."); await inspectStage(target); }),
    select(choice: ContentPublicationChange, selected: boolean) { if (state.busy || state.staged) return; const selection = state.selection.filter(({ ref }) => json(ref) !== json(choice.ref)); if (selected) selection.push({ ref: choice.ref, action: choice.kind === "deleted" ? "delete" : choice.kind === "unpublish" ? "unpublish" : "publish" }); emit({ selection, plan: null, phase: "inspect" }); },
    review: () => run(async () => {
      if (!transport.available || state.staged) throw new Error("Review requires local capability and no unfinished stage.");
      captured = await capture(); catalog = await call<Catalog>({ protocolVersion: 2, operation: "list" }); const before = epoch;
      const plan = await call<ReleasePlan>({ protocolVersion: 2, operation: "plan", project: captured.project, workingPrecondition: precondition(captured), selection: state.selection, expectedRevision: catalog.projects.find(({ projectId }) => projectId === captured!.project.id)?.head ?? null, expectedActive: catalog.active });
      if (before !== epoch || !await integration.isCaptureCurrent(captured.capture)) throw new Error("Workspace changed during review; run checks again.");
      emit({ plan, phase: "reviewed", active: catalog.active, changed: false, message: "Review Changes, Checks and Affected before approving." });
    }),
    approve() { if (!state.busy && state.phase === "reviewed" && !state.changed && state.plan && !state.plan.checks.some(({ severity }) => severity === "blocking")) emit({ phase: "approved" }); },
    apply: () => run(async () => {
      if (state.phase !== "approved" || !state.plan || !captured) throw new Error("Approval changed; review again.");
      if (!await integration.isCaptureCurrent(captured.capture)) { emit({ phase: "inspect", changed: true }); throw new Error("Approval changed; review again."); }
      const approved = state.plan;
      // Keep exact identity for inspection even when acknowledgement is lost.
      const stage: StagedRelease = { schemaVersion: 2, projectId: approved.candidate.id, revision: approved.projectRevision, buildId: approved.buildId, mediaLock: approved.mediaLock, toolchain: approved.toolchain, planDigest: approved.planDigest, publication: approved.publication };
      recordReleaseApproval(integration.workspace.id!, approved, stage);
      emit({ staged: stage });
      try {
        const result = await call<{ staged: StagedRelease; stageGeneration: number }>({ protocolVersion: 2, operation: "apply", plan: approved });
        emit({ staged: result.staged, stageGeneration: result.stageGeneration, phase: "staged", message: "A is staged. New working edits remain separate while A builds." });
        try { recordReleaseStage(integration.workspace.id!, result.staged, result.stageGeneration); } catch { emit({ message: "Stage committed; approval receipt retained. Refresh the server catalog for exact recovery." }); }
      } catch (error) { if ((state as ReleaseState).phase !== "uncertain") emit({ staged: null, phase: "inspect" }); throw error; }
    }),
    build: () => run(async () => { if (state.phase !== "staged" || !state.staged) throw new Error("Inspect or stage an exact candidate first."); const completed = await call<CompletedRelease>({ protocolVersion: 2, operation: "build", projectId: state.staged.projectId, buildId: state.staged.buildId }); emit({ completed, phase: "built", message: "Immutable local build completed. It is not activated." }); }),
    activate: () => run(async () => { if (state.phase !== "built" || !state.completed) throw new Error("A completed exact build is required."); const result = await call<{ active: SiteProjectActiveSelection }>({ protocolVersion: 2, operation: "activate", ...state.completed.identity, expectedActive: state.active }); emit({ active: result.active, phase: "activated", message: "Activated locally. Reconciling only matching working generations." }); await reconcile(); }),
    reconcile: () => run(reconcile),
    discard: () => run(async () => { if (state.phase !== "staged" || !state.staged || !state.stageGeneration) throw new Error("Only an inspected unbuilt stage can be discarded."); await call({ protocolVersion: 2, operation: "discard", projectId: state.staged.projectId, buildId: state.staged.buildId, expectedStageGeneration: state.stageGeneration, expectedActive: state.active }); emit({ staged: null, completed: null, stageGeneration: null, plan: null, phase: "inspect", message: "Local stage discarded; working drafts retained." }); }),
    newReview() { if (state.busy || state.phase === "uncertain") return; emit({ phase: "inspect", staged: null, completed: null, stageGeneration: null, plan: null, selection: [] }); },
    exportProject: () => state.working ? serializeSiteProject(state.working) : null,
    dispose() { stopWorkspace(); stopRelease(); stopJournal(); transport.dispose(); listeners.clear(); },
  };
}
export type ReleaseController = ReturnType<typeof createReleaseController>;
