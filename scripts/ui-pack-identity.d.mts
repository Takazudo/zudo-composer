export interface UiPackLock {
  readonly tarballUrl: string;
  readonly peerResolutionSuffix: string;
}

export interface UiPackIdentity {
  readonly packageName: string;
  readonly dependencySpec: string;
  readonly installedVersion: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly sourceModule: string;
  readonly provenanceCommit: string;
  readonly provenanceTree: string;
  readonly lock: UiPackLock;
}

export const UI_PACK: UiPackIdentity;
export const APP_PROVENANCE_COMMIT: string;
export const CONTRACT_PACKAGE_COMMIT: string;
export const PERMANENT_HANDOFF_HASHES: readonly string[];
