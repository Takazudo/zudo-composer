export interface UiPackIdentity {
  readonly packageName: string;
  readonly sourcePath: string;
  readonly workspaceSpec: string;
  readonly packageBranch: string;
  readonly packageCommit: string;
  readonly rootGitSpec: string;
  readonly installedVersion: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly sourceModule: string;
  readonly provenanceCommit: string;
}

export const UI_PACK: UiPackIdentity;
export const APP_PROVENANCE_COMMIT: string;
export const CONTRACT_PACKAGE_COMMIT: string;
export const PERMANENT_HANDOFF_HASHES: readonly string[];
