import type { JsonValue } from "@zudo-composer/component-contract";
import { getContentPublicationChanges } from "../../src/content";
import { contentSnapshots, releaseJson, sameRelease } from "../../src/site-project/api/review";
import type { ReleasePlan, SiteProjectActiveSelection, SiteProjectApiError, SiteProjectApiRequest, SiteProjectApiService, SiteProjectListEntry, StoredSiteProject } from "../../src/site-project/api/types";
import { validateSiteProject } from "../../src/site-project/model/validation";
import { createLocalSiteProjectApiService, type LocalSiteProjectServiceOptions } from "./service";

export interface SeedSiteProjectResult extends SiteProjectActiveSelection {
  status: "activated" | "unchanged";
}

interface ReleaseState {
  projects: readonly SiteProjectListEntry[];
  active: SiteProjectActiveSelection | null;
  generation: number;
}

export class SeedSiteProjectError extends Error {
  constructor(operation: string, readonly detail: SiteProjectApiError) {
    super(`${operation} failed (${detail.code}): ${detail.message}${detail.diagnostics ? `\n${releaseJson(detail.diagnostics)}` : ""}${detail.identity ? `\nRelease: ${releaseJson(detail.identity)}` : ""}`);
    this.name = "SeedSiteProjectError";
  }
}

/**
 * Publish the committed project's entries and activate its immutable release.
 * Every mutation keeps the CAS values from the initial list; failures never
 * refresh them or retry. The service owns staging, build verification and the
 * atomic activation pointer, including any recoverable inactive stage.
 */
export async function seedSiteProject(
  input: unknown,
  options: LocalSiteProjectServiceOptions,
  deps: { service?: SiteProjectApiService } = {},
): Promise<SeedSiteProjectResult> {
  const validation = validateSiteProject(input, { componentPack: options.pack.manifest });
  if (!validation.ok) throw new SeedSiteProjectError("read project", { code: "validation", message: "SiteProject validation failed.", diagnostics: validation.diagnostics as unknown as JsonValue[] });
  const service = deps.service ?? createLocalSiteProjectApiService(options);
  const call = async <T>(request: SiteProjectApiRequest): Promise<T> => {
    const response = await service.handle(request);
    if (!response.ok) throw new SeedSiteProjectError(request.operation, response.error);
    return response.result as T;
  };
  const project = structuredClone(validation.project);
  const state = await call<ReleaseState>({ protocolVersion: 2, operation: "list" });
  const expectedRevision = state.projects.find((entry) => entry.projectId === project.id)?.head ?? null;
  const expectedActive = state.active;
  const baseline = expectedActive?.projectId === project.id
    ? (await call<StoredSiteProject>({ protocolVersion: 2, operation: "get", projectId: project.id, revision: expectedActive.revision })).project
    : null;

  // Seed is an explicit request to publish every committed entry. Compare
  // published intent with the baseline: publishing unchanged entries again is
  // invalid in protocol 2, and removed committed entries need a delete selection.
  for (const provider of project.providers.content) for (const entry of provider.entries) entry.lifecycle = "published";
  const selection = getContentPublicationChanges(contentSnapshots(project), baseline ? contentSnapshots(baseline) : [])
    .map(({ ref, kind }) => ({ ref, action: kind === "deleted" ? "delete" as const : "publish" as const }));
  const plan = await call<ReleasePlan>({
    protocolVersion: 2, operation: "plan", project, workingPrecondition: null,
    selection, expectedRevision, expectedActive,
  });
  if (plan.checks.some(({ severity }) => severity === "blocking")) {
    throw new SeedSiteProjectError("plan", { code: "compile-blocked", message: "Candidate release checks are blocking.", diagnostics: plan.checks as unknown as JsonValue[] });
  }
  const target = { projectId: project.id, revision: plan.projectRevision, buildId: plan.buildId };
  if (sameRelease(target, expectedActive)) {
    // Planning verified the completed baseline and current Assets/toolchain.
    // A concurrent head change must also fail, even if activation stayed put.
    const current = await call<ReleaseState>({ protocolVersion: 2, operation: "list" });
    if (!sameRelease(current.active, expectedActive)
      || (current.projects.find((entry) => entry.projectId === project.id)?.head ?? null) !== expectedRevision
      || current.generation !== plan.storeGeneration) {
      throw new SeedSiteProjectError("verify unchanged release", { code: "conflict", message: "Project head or active release changed while seeding." });
    }
    return { ...target, status: "unchanged" };
  }

  // A successful idempotent apply returns `staged`, without top-level revision
  // or buildId. The approved plan already names the exact target in both cases.
  await call({ protocolVersion: 2, operation: "apply", plan });
  await call({ protocolVersion: 2, operation: "build", projectId: target.projectId, buildId: target.buildId });
  await call({ protocolVersion: 2, operation: "activate", ...target, expectedActive });
  return { ...target, status: "activated" };
}
