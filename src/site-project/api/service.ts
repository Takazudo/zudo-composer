import type { JsonValue } from "@zudo-composer/component-contract";
import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import { checkAssetLockPreconditions, validateAssetReferenceLock } from "../../assets/references";
import { compileSiteProject } from "../compiler";
import { canonicalizeSiteProject } from "../model/canonical";
import { validateSiteProject } from "../model/validation";
import type { SiteProject } from "../model";
import { createReleasePlan, releaseJson, sameRelease } from "./review";
import { validateReleaseToolchain } from "./validation";
import { SITE_PROJECT_API_PROTOCOL_VERSION, type CompletedRelease, type ReleasePlan, type SiteProjectActiveSelection, type SiteProjectApiDependencies, type SiteProjectApiErrorCode, type SiteProjectApiRequest, type SiteProjectApiResponse, type SiteProjectApiService, type StagedRelease } from "./types";

const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const active = (value: unknown): value is SiteProjectActiveSelection | null => value === null || (isPlainObject(value) && keys(value, ["projectId", "revision", "buildId"]) && isSafeRecordId(value.projectId) && digest(value.revision) && digest(value.buildId));
const shapes = { describe: [], list: [], active: [], get: ["projectId", "revision"], plan: ["project", "workingPrecondition", "selection", "expectedRevision", "expectedActive"], apply: ["plan"], stage: ["projectId", "buildId"], build: ["projectId", "buildId"], completed: ["projectId", "buildId"], activate: ["projectId", "revision", "buildId", "expectedActive"], discard: ["projectId", "buildId", "expectedStageGeneration", "expectedActive"] };
const planKeys = ["schemaVersion", "workingProject", "workingPrecondition", "candidate", "selection", "expectedRevision", "expectedActive", "storeGeneration", "projectRevision", "buildId", "assetLock", "toolchain", "changes", "checks", "affected", "publication", "planDigest"];
const fail = (code: SiteProjectApiErrorCode, message: string, diagnostics?: readonly unknown[]): SiteProjectApiResponse => ({ ok: false, error: { code, message, ...(diagnostics ? { diagnostics: diagnostics as JsonValue[] } : {}) } });
const ok = (result: unknown): SiteProjectApiResponse => ({ ok: true, result: result as JsonValue });
function parse(value: unknown): SiteProjectApiRequest | SiteProjectApiResponse {
  if (!isPlainObject(value) || !isJsonSafe(value)) return fail("malformed-request", "Request must be a JSON-safe plain object.");
  if (value.protocolVersion !== SITE_PROJECT_API_PROTOCOL_VERSION) return fail("unsupported-protocol", "Release API requires protocolVersion 2.");
  if (typeof value.operation !== "string" || !Object.hasOwn(shapes, value.operation) || !keys(value, ["operation", "protocolVersion", ...shapes[value.operation as keyof typeof shapes]])) return fail("malformed-request", "Unknown operation or incorrect exact request shape.");
  if (("projectId" in value && !isSafeRecordId(value.projectId)) || ("revision" in value && !digest(value.revision)) || ("buildId" in value && !digest(value.buildId)) || ("expectedActive" in value && !active(value.expectedActive)) || ("expectedRevision" in value && value.expectedRevision !== null && !digest(value.expectedRevision))) return fail("malformed-request", "Invalid release identity or precondition.");
  if (value.operation === "plan" && (!Array.isArray(value.selection) || !value.selection.every((item) => isPlainObject(item) && keys(item, ["ref", "action"]) && ["publish", "delete", "unpublish"].includes(String(item.action)) && isPlainObject(item.ref) && keys(item.ref, ["providerId", "modelId", "recordId"]) && Object.values(item.ref).every(isSafeRecordId)))) return fail("malformed-request", "Publication selection requires exact provider-qualified entries.");
  if (value.operation === "apply") {
    const plan = value.plan;
    if (!isPlainObject(plan) || !keys(plan, planKeys) || plan.schemaVersion !== 2 || !digest(plan.planDigest) || !digest(plan.projectRevision) || !digest(plan.buildId) || !isPlainObject(plan.candidate) || !isPlainObject(plan.workingProject) || !active(plan.expectedActive) || !(plan.expectedRevision === null || digest(plan.expectedRevision)) || !Number.isSafeInteger(plan.storeGeneration) || Number(plan.storeGeneration) < 0 || !validateReleaseToolchain(plan.toolchain) || !(plan.assetLock === null || validateAssetReferenceLock(plan.assetLock)) || ![plan.selection, plan.changes, plan.checks, plan.affected, plan.publication].every(Array.isArray)) return fail("malformed-request", "Apply requires the exact detached protocol-2 approved plan.");
  }
  if (value.operation === "discard" && (!Number.isSafeInteger(value.expectedStageGeneration) || Number(value.expectedStageGeneration) < 1)) return fail("malformed-request", "Discard requires the exact visible stage generation.");
  return value as unknown as SiteProjectApiRequest;
}
const adapterFailure = (result: { status: string; message?: string; identity?: SiteProjectActiveSelection }): SiteProjectApiResponse => result.status === "uncertain"
  ? { ok: false, error: { code: "commit-uncertain", message: result.message ?? "Commit acknowledgment is uncertain.", ...(result.identity ? { identity: result.identity } : {}) } }
  : fail(result.status === "conflict" ? "conflict" : result.status === "not-found" ? "not-found" : "unavailable", result.message ?? `Release storage ${result.status}.`);
export function createSiteProjectApiService(dependencies: SiteProjectApiDependencies): SiteProjectApiService {
  if (!validateReleaseToolchain(dependencies.toolchain) || releaseJson(dependencies.toolchain.componentPack) !== releaseJson({ packId: dependencies.componentCatalog.pack.packId, packVersion: dependencies.componentCatalog.pack.packVersion, contractVersion: dependencies.componentCatalog.pack.contractVersion })) throw new TypeError("Release toolchain must match the exact installed component catalog.");
  const compiler = dependencies.compiler ?? compileSiteProject;
  const validate = (value: unknown): SiteProject | SiteProjectApiResponse => {
    const result = validateSiteProject(value, { componentPack: dependencies.componentCatalog.pack });
    return result.ok ? canonicalizeSiteProject(result.project) : fail("validation", "SiteProject validation failed.", result.diagnostics);
  };
  const plan = async (project: unknown, workingPrecondition: JsonValue, selection: ReleasePlan["selection"], expectedRevision: string | null, expectedActive: SiteProjectActiveSelection | null): Promise<ReleasePlan | SiteProjectApiResponse> => {
    const working = validate(project); if ("ok" in working) return working;
    if (workingPrecondition !== null && !dependencies.isWorkingCurrent) return fail("unavailable", "This adapter cannot verify browser working-generation preconditions.");
    if (dependencies.isWorkingCurrent && workingPrecondition === null) return fail("malformed-request", "A working-generation guard requires an explicit captured precondition.");
    if (dependencies.isWorkingCurrent && !await dependencies.isWorkingCurrent(working, workingPrecondition)) return fail("conflict", "Working capture changed before review.");
    const state = await dependencies.projectStore.list(); if (state.status !== "ok") return adapterFailure(state);
    if (!sameRelease(state.value.active, expectedActive) || (state.value.projects.find(({ projectId }) => projectId === working.id)?.head ?? null) !== expectedRevision) return fail("conflict", "Project head or active release changed before review.");
    let baseline: SiteProject | null = null;
    let baselineBuild: CompletedRelease | undefined;
    if (expectedActive?.projectId === working.id) { const result = await dependencies.projectStore.get(expectedActive); if (result.status !== "ok") return adapterFailure(result); baseline = result.value.project; const completed = await dependencies.buildStore.getCompleted(expectedActive); if (completed.status !== "ok") return adapterFailure(completed); baselineBuild = completed.value; }
    try { const result = await createReleasePlan({ project: working, workingPrecondition, baseline, baselineBuild, selection, expectedRevision, expectedActive, storeGeneration: state.value.generation }, dependencies); if (dependencies.isWorkingCurrent && !await dependencies.isWorkingCurrent(working, workingPrecondition)) return fail("conflict", "Working capture changed during review."); return result; }
    catch (error) { return fail("validation", error instanceof Error ? error.message : "Invalid publication candidate."); }
  };
  const handleParsed = async (request: SiteProjectApiRequest): Promise<SiteProjectApiResponse> => {
    switch (request.operation) {
      case "describe": return ok({ protocolVersion: 2, requestShapes: shapes, activeSelection: ["projectId", "revision", "buildId"], capabilities: { immutableStage: true, completedBuilds: true, activationCas: true, workingPrecondition: !!dependencies.isWorkingCurrent, publicationReconciliation: !!dependencies.reconcilePublication }, toolchain: dependencies.toolchain });
      case "list": { const result = await dependencies.projectStore.list(); return result.status === "ok" ? ok(result.value) : adapterFailure(result); }
      case "active": { const result = await dependencies.projectStore.list(); if (result.status !== "ok") return adapterFailure(result); if (!result.value.active) return ok({ active: null }); const completed = await dependencies.buildStore.getCompleted(result.value.active); return completed.status === "ok" ? ok({ active: result.value.active, completed: completed.value }) : adapterFailure(completed); }
      case "get": { const result = await dependencies.projectStore.get(request); return result.status === "ok" ? ok(result.value) : adapterFailure(result); }
      case "stage": { const result = await dependencies.projectStore.getStage(request); return result.status === "ok" ? ok({ stage: result.value, stageGeneration: result.stageGeneration }) : adapterFailure(result); }
      case "completed": { const result = await dependencies.buildStore.getCompleted(request); return result.status === "ok" ? ok(result.value) : adapterFailure(result); }
      case "plan": { const result = await plan(request.project, request.workingPrecondition, request.selection, request.expectedRevision, request.expectedActive); return "ok" in result ? result : ok(result); }
      case "apply": {
        const approved = request.plan;
        const { planDigest, ...body } = approved;
        if (await dependencies.hash(releaseJson(body)) !== planDigest) return fail("conflict", "Approval digest does not match its detached plan.");
        const existing = await dependencies.projectStore.getStage({ projectId: approved.candidate.id, buildId: approved.buildId, approvalDigest: planDigest });
        if (existing.status === "ok") return ok({ staged: existing.value, stageGeneration: existing.stageGeneration, idempotent: true });
        if (existing.status === "unavailable") return adapterFailure(existing);
        if (dependencies.isWorkingCurrent && !await dependencies.isWorkingCurrent(approved.workingProject, approved.workingPrecondition)) return fail("conflict", "Working generations changed after review.");
        const fresh = await plan(approved.workingProject, approved.workingPrecondition, approved.selection, approved.expectedRevision, approved.expectedActive);
        if ("ok" in fresh) return fresh;
        if (fresh.planDigest !== planDigest) return fail("conflict", "Approval is stale; review current candidate, Media, toolchain and base again.");
        if (fresh.checks.some(({ severity }) => severity === "blocking")) return fail("compile-blocked", "Candidate release checks are blocking.", fresh.checks);
        if (fresh.assetLock && (!dependencies.assetStore || !await checkAssetLockPreconditions(fresh.assetLock, dependencies.assetStore))) return fail("conflict", "Assets changed after approval validation.");
        if (dependencies.isWorkingCurrent && !await dependencies.isWorkingCurrent(approved.workingProject, approved.workingPrecondition)) return fail("conflict", "Working generations changed while staging.");
        const stage: StagedRelease = { schemaVersion: 2, projectId: fresh.candidate.id, revision: fresh.projectRevision, buildId: fresh.buildId, assetLock: fresh.assetLock, toolchain: fresh.toolchain, planDigest, publication: fresh.publication };
        const result = await dependencies.projectStore.apply({ project: fresh.candidate, stage, expectedRevision: fresh.expectedRevision, expectedActive: fresh.expectedActive, expectedGeneration: fresh.storeGeneration, verifyApproval: async () => (!fresh.assetLock || (!!dependencies.assetStore && await checkAssetLockPreconditions(fresh.assetLock, dependencies.assetStore))) && (!dependencies.isWorkingCurrent || await dependencies.isWorkingCurrent(approved.workingProject, approved.workingPrecondition)) });
        if (result.status !== "ok") return adapterFailure(result);
        const retained = await dependencies.projectStore.getStage({ projectId: stage.projectId, buildId: stage.buildId });
        return retained.status === "ok" ? ok({ ...result.value, staged: retained.value }) : adapterFailure(retained);
      }
      case "build": {
        const existing = await dependencies.buildStore.getCompleted(request);
        if (existing.status === "ok") return ok(existing.value);
        if (existing.status === "unavailable") return adapterFailure(existing);
        const staged = await dependencies.projectStore.getStage(request); if (staged.status !== "ok") return adapterFailure(staged);
        if (releaseJson(staged.value.toolchain) !== releaseJson(dependencies.toolchain)) return fail("unavailable", "Pinned toolchain is unavailable; do not compile this stage with a different toolchain.");
        const stored = await dependencies.projectStore.get({ projectId: request.projectId, revision: staged.value.revision }); if (stored.status !== "ok") return adapterFailure(stored);
        const compilation = await compiler(stored.value.project, { componentCatalog: dependencies.componentCatalog, policy: "release", ...(staged.value.assetLock ? { assetLock: staged.value.assetLock } : {}) });
        if (compilation.status === "blocked") return fail("compile-blocked", "Pinned candidate compilation failed.", compilation.diagnostics);
        const result = await dependencies.buildStore.complete({ stage: staged.value, build: compilation.build });
        return result.status === "ok" ? ok(result.value) : adapterFailure(result);
      }
      case "activate": {
        const target = { projectId: request.projectId, revision: request.revision, buildId: request.buildId };
        const result = await dependencies.projectStore.activate({ target, expectedActive: request.expectedActive, reconcile: dependencies.reconcilePublication ? (stage, generation) => dependencies.reconcilePublication!(target, stage.publication, generation) : undefined });
        if (result.status !== "ok") return adapterFailure(result);
        return ok(result.value);
      }
      case "discard": { const result = await dependencies.projectStore.discard(request); return result.status === "ok" ? ok(result.value) : adapterFailure(result); }
    }
  };
  const handle = async (value: unknown): Promise<SiteProjectApiResponse> => { try { const request = parse(value); return "ok" in request ? request : await handleParsed(request); } catch { return fail("internal", "Release service failed unexpectedly."); } };
  return { handle, serialize: async (value) => releaseJson(await handle(value)) };
}
