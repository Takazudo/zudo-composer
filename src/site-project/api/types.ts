import type { JsonValue } from "@zudo-composer/component-contract";
import type { ComponentCatalog } from "../../composer/model/types";
import type { SiteBuildPlan, SiteProjectCompiler } from "../compiler/types";
import type { SiteProject, SiteProjectDiagnostic } from "../model/types";

export const SITE_PROJECT_API_PROTOCOL_VERSION = 1 as const;

export type SiteProjectApiErrorCode =
  | "malformed-request"
  | "unsupported-protocol"
  | "validation"
  | "compile-blocked"
  | "not-found"
  | "conflict"
  | "unavailable"
  | "internal";

export interface SiteProjectActiveSelection {
  projectId: string;
  revision: string;
}

export interface StoredSiteProject {
  project: SiteProject;
  revision: string;
}

export interface SiteProjectListEntry {
  projectId: string;
  name: string;
  revisions: readonly string[];
}

export type SiteProjectAdapterReadResult<T> =
  | { status: "ok"; value: T }
  | { status: "not-found" }
  | { status: "unavailable"; message: string };

export type SiteProjectAdapterMutationResult<T> =
  | { status: "ok"; value: T }
  | { status: "not-found" }
  | { status: "conflict" }
  | { status: "unavailable"; message: string };

/**
 * Persistence boundary for canonical project snapshots and the active pointer.
 * Every mutation is one adapter-level transaction; implementations must not
 * split the revision and active-pointer comparisons into separate operations.
 */
export interface SiteProjectStoreAdapter {
  list(): Promise<SiteProjectAdapterReadResult<{
    projects: readonly SiteProjectListEntry[];
    active: SiteProjectActiveSelection | null;
  }>>;
  get(input: { projectId: string; revision: string }): Promise<SiteProjectAdapterReadResult<StoredSiteProject>>;
  /**
   * `null` is create-only. A string replaces that exact revision. The active
   * pointer is compared in the same transaction and, when it names the
   * replaced revision, advances to the returned revision.
   */
  apply(input: {
    project: SiteProject;
    expectedRevision: string | null;
    expectedActive: SiteProjectActiveSelection | null;
  }): Promise<SiteProjectAdapterMutationResult<{
    revision: string;
    active: SiteProjectActiveSelection | null;
  }>>;
  activate(input: {
    target: SiteProjectActiveSelection;
    expectedActive: SiteProjectActiveSelection | null;
  }): Promise<SiteProjectAdapterMutationResult<{ active: SiteProjectActiveSelection }>>;
  /**
   * Deletes only `expectedRevision` while comparing `expectedActive` in the
   * same transaction. A pointer to the deleted target is cleared; any other
   * pointer that matched the expectation is preserved.
   */
  discard(input: {
    projectId: string;
    expectedRevision: string;
    expectedActive: SiteProjectActiveSelection | null;
  }): Promise<SiteProjectAdapterMutationResult<{ active: SiteProjectActiveSelection | null }>>;
}

/** Derived artifacts are published only after a successful exact-revision read and compile. */
export interface SiteProjectBuildAdapter {
  publish(input: {
    projectId: string;
    revision: string;
    build: SiteBuildPlan;
  }): Promise<{ status: "ok" } | { status: "unavailable"; message: string }>;
}

export interface SiteProjectApiDependencies {
  componentCatalog: ComponentCatalog;
  projectStore: SiteProjectStoreAdapter;
  buildStore: SiteProjectBuildAdapter;
  compiler?: SiteProjectCompiler;
}

export type SiteProjectPlanSource =
  | { kind: "inline"; project: unknown }
  | { kind: "stored"; projectId: string; revision: string };

export type SiteProjectApiRequest =
  | { protocolVersion: 1; operation: "describe" }
  | { protocolVersion: 1; operation: "list" }
  | { protocolVersion: 1; operation: "get"; projectId: string; revision: string }
  | { protocolVersion: 1; operation: "plan"; source: SiteProjectPlanSource }
  | {
      protocolVersion: 1;
      operation: "apply";
      project: unknown;
      expectedRevision: string | null;
      expectedActive: SiteProjectActiveSelection | null;
    }
  | { protocolVersion: 1; operation: "build"; projectId: string; revision: string }
  | {
      protocolVersion: 1;
      operation: "activate";
      projectId: string;
      revision: string;
      expectedActive: SiteProjectActiveSelection | null;
    }
  | {
      protocolVersion: 1;
      operation: "discard";
      projectId: string;
      expectedRevision: string;
      expectedActive: SiteProjectActiveSelection | null;
    };

export interface SiteProjectApiError {
  code: SiteProjectApiErrorCode;
  message: string;
  diagnostics?: readonly SiteProjectDiagnostic[] | readonly JsonValue[];
}

export type SiteProjectApiResponse =
  | { ok: true; result: JsonValue }
  | { ok: false; error: SiteProjectApiError };

export interface SiteProjectApiService {
  handle(request: unknown): Promise<SiteProjectApiResponse>;
  /** Canonical JSON with a trailing newline, suitable for any transport. */
  serialize(request: unknown): Promise<string>;
}
