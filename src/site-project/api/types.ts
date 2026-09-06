import type { JsonValue } from "@zudo-composer/component-contract";
import type { ComponentCatalog } from "../../composer/model/types";
import type { ContentPublicationSelection, ContentPublicationReconciliation } from "../../content";
import type { VersionedMediaStore } from "../../media/library";
import type { MediaReferenceLock } from "../../media/references";
import type { SiteBuildPlan, SiteProjectCompiler } from "../compiler/types";
import type { SiteProject } from "../model/types";

export const SITE_PROJECT_API_PROTOCOL_VERSION = 2 as const;
export type SiteProjectApiErrorCode = "malformed-request" | "unsupported-protocol" | "validation" | "compile-blocked" | "not-found" | "conflict" | "commit-uncertain" | "unavailable" | "internal";
export interface SiteProjectActiveSelection { projectId: string; revision: string; buildId: string }
/**
 * Exactly which code compiled a release. A component pack is a package, not a
 * Git checkout — a registry themeset and a host self-reference have no commit —
 * so provenance is the specifier the host configured, the dependency spec it
 * was installed by, and a digest of the resolved bytes.
 */
export interface ReleaseToolchain {
  compiler: string;
  componentPack: { packId: string; packVersion: string; contractVersion: number };
  /** The config `pack` value, verbatim. */
  packSpecifier: string;
  /** The host's dependency spec for the pack's package, or `"self"`. */
  packSource: string;
  installedPackDigest: string;
  contractDigest: string;
}
export interface ReleaseChange { domain: string; providerId: string; recordId: string; kind: "added" | "changed" | "removed" }
export interface ReleaseCheck { severity: "blocking" | "info"; code: string; message: string; path: string }
export interface ReleaseAffected { kind: "route" | "record" | "media"; identity: string; reason: string }
export interface ReleasePlan {
  schemaVersion: 2; workingProject: SiteProject; workingPrecondition: JsonValue; candidate: SiteProject;
  selection: ContentPublicationSelection[]; expectedRevision: string | null; expectedActive: SiteProjectActiveSelection | null; storeGeneration: number;
  projectRevision: string; buildId: string; mediaLock: MediaReferenceLock | null; toolchain: ReleaseToolchain;
  changes: ReleaseChange[]; checks: ReleaseCheck[]; affected: ReleaseAffected[]; publication: ContentPublicationReconciliation[]; planDigest: string;
}
export interface StagedRelease { schemaVersion: 2; projectId: string; revision: string; buildId: string; mediaLock: MediaReferenceLock | null; toolchain: ReleaseToolchain; planDigest: string; publication: ContentPublicationReconciliation[] }
export interface StoredSiteProject { project: SiteProject; revision: string }
export interface CompletedRelease { identity: SiteProjectActiveSelection; completionDigest: string; files: Record<string, string>; build: SiteBuildPlan; stage: StagedRelease }
export interface SiteProjectListEntry { projectId: string; name: string; revisions: readonly string[]; head: string; stages: readonly string[] }
export type SiteProjectAdapterReadResult<T> = { status: "ok"; value: T } | { status: "not-found" } | { status: "unavailable"; message: string };
export type SiteProjectAdapterMutationResult<T> = SiteProjectAdapterReadResult<T> | { status: "conflict" } | { status: "uncertain"; message: string; identity: SiteProjectActiveSelection };
/** Every mutation compares all preconditions under the adapter's one transaction lock. */
export interface SiteProjectStoreAdapter {
  list(): Promise<SiteProjectAdapterReadResult<{ projects: readonly SiteProjectListEntry[]; active: SiteProjectActiveSelection | null; generation: number; stageGenerations: Readonly<Record<string, number>> }>>;
  get(input: { projectId: string; revision: string }): Promise<SiteProjectAdapterReadResult<StoredSiteProject>>;
  getStage(input: { projectId: string; buildId: string; approvalDigest?: string }): Promise<{ status: "ok"; value: StagedRelease; stageGeneration: number } | { status: "not-found" } | { status: "unavailable"; message: string }>;
  apply(input: { project: SiteProject; stage: StagedRelease; expectedRevision: string | null; expectedActive: SiteProjectActiveSelection | null; expectedGeneration: number; verifyApproval?(): Promise<boolean> }): Promise<SiteProjectAdapterMutationResult<{ revision: string; buildId: string; stageGeneration: number; active: SiteProjectActiveSelection | null }>>;
  activate(input: { target: SiteProjectActiveSelection; expectedActive: SiteProjectActiveSelection | null; reconcile?(stage: StagedRelease, activationGeneration: number): Promise<"applied" | "changed" | "unavailable"> }): Promise<SiteProjectAdapterMutationResult<{ active: SiteProjectActiveSelection; activationGeneration: number; reconciliation: "applied" | "changed" | "unavailable" }>>;
  discard(input: { projectId: string; buildId: string; expectedStageGeneration: number; expectedActive: SiteProjectActiveSelection | null }): Promise<SiteProjectAdapterMutationResult<{ active: SiteProjectActiveSelection | null }>>;
}
export interface SiteProjectBuildAdapter {
  complete(input: { stage: StagedRelease; build: SiteBuildPlan }): Promise<SiteProjectAdapterMutationResult<CompletedRelease>>;
  getCompleted(input: { projectId: string; buildId: string }): Promise<SiteProjectAdapterReadResult<CompletedRelease>>;
}
export interface SiteProjectApiDependencies {
  componentCatalog: ComponentCatalog; projectStore: SiteProjectStoreAdapter; buildStore: SiteProjectBuildAdapter;
  toolchain: ReleaseToolchain; hash(text: string): Promise<string>;
  mediaStore?: VersionedMediaStore; compiler?: SiteProjectCompiler;
  /** Browser workspace adapter verifies its coherent captured generation before staging. */
  isWorkingCurrent?(project: SiteProject, precondition: JsonValue): Promise<boolean>;
  /** Owning adapter matches working generation AND digest, never overwriting newer edits. */
  reconcilePublication?(active: SiteProjectActiveSelection, changes: readonly ContentPublicationReconciliation[], activationGeneration: number): Promise<"applied" | "changed" | "unavailable">;
}
export type SiteProjectApiRequest =
  | { protocolVersion: 2; operation: "describe" | "list" | "active" }
  | { protocolVersion: 2; operation: "get"; projectId: string; revision: string }
  | { protocolVersion: 2; operation: "plan"; project: unknown; workingPrecondition: JsonValue; selection: ContentPublicationSelection[]; expectedRevision: string | null; expectedActive: SiteProjectActiveSelection | null }
  | { protocolVersion: 2; operation: "apply"; plan: ReleasePlan }
  | { protocolVersion: 2; operation: "stage" | "build" | "completed"; projectId: string; buildId: string }
  | { protocolVersion: 2; operation: "activate"; projectId: string; revision: string; buildId: string; expectedActive: SiteProjectActiveSelection | null }
  | { protocolVersion: 2; operation: "discard"; projectId: string; buildId: string; expectedStageGeneration: number; expectedActive: SiteProjectActiveSelection | null };
export interface SiteProjectApiError { code: SiteProjectApiErrorCode; message: string; identity?: SiteProjectActiveSelection; diagnostics?: readonly JsonValue[] }
export type SiteProjectApiResponse = { ok: true; result: JsonValue } | { ok: false; error: SiteProjectApiError };
export interface SiteProjectApiService { handle(request: unknown): Promise<SiteProjectApiResponse>; serialize(request: unknown): Promise<string> }
