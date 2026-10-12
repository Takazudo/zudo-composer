// Provider-neutral publication/export status interface. The editor submits an
// immutable snapshot identity plus the baseline it was edited against; the
// host's adapter (Pinsel's Git/PR workflow) reports what it has actually
// proven. No repository name, branch, path, command or URL ever travels in a
// submission, so editable content cannot steer where an export goes.

export const CONTENT_EXPORT_STATES = ["submitted", "building", "verified", "integrated", "deployed", "failed", "conflict"] as const;
export type ContentExportState = (typeof CONTENT_EXPORT_STATES)[number];

/** Opaque host identities: short, URL/path-free tokens. */
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PACK_ID_PATTERN = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const SUBMISSION_KEYS = ["snapshotId", "projectRevision", "baselineRevision", "packageIdentity", "idempotencyKey"] as const;
const PACKAGE_KEYS = ["packId", "packVersion", "contractVersion"] as const;

export interface ContentExportPackageIdentity {
  readonly packId: string;
  readonly packVersion: string;
  readonly contractVersion: number;
}

export interface ContentExportSubmission {
  /** `ContentSnapshotRecord.snapshotId`: sha256 of the canonical project. */
  readonly snapshotId: string;
  /** sha256 of the canonical project text the host will build; equals `snapshotId` for a whole-project snapshot. */
  readonly projectRevision: string;
  readonly baselineRevision: string;
  readonly packageIdentity: ContentExportPackageIdentity;
  readonly idempotencyKey: string;
}

export interface ContentExportEvidence {
  readonly commit?: string;
  readonly pr?: string;
  readonly buildId?: string;
  readonly checks?: readonly { name: string; status: "pending" | "passed" | "failed" }[];
}

export interface ContentExportStatus {
  readonly operationId: string;
  readonly state: ContentExportState;
  readonly snapshotId: string;
  readonly baselineRevision: string;
  readonly evidence?: ContentExportEvidence;
  readonly message?: string;
  readonly updatedAt: string;
}

export type ContentExportSubmitResult =
  | { status: "ok"; value: { operationId: string; replayed: boolean } }
  | { status: "rejected"; message: string; path?: string }
  /** The same idempotency key was used for a different submission. */
  | { status: "conflict"; operationId: string }
  | { status: "unavailable"; message: string };

export type ContentExportStatusResult = { status: "ok"; value: ContentExportStatus } | { status: "not-found" } | { status: "unavailable"; message: string };

export interface ContentExportAdapter {
  submit(submission: ContentExportSubmission): Promise<ContentExportSubmitResult>;
  status(operationId: string): Promise<ContentExportStatusResult>;
}

export type ContentExportSubmissionValidation = { ok: true; value: ContentExportSubmission } | { ok: false; message: string; path?: string };

function exactKeys(value: object, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Accept only the exact submission shape; anything resembling a repository, path or URL is refused by construction. */
export function validateContentExportSubmission(value: unknown): ContentExportSubmissionValidation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "Submission must be a plain object." };
  if (!exactKeys(value, SUBMISSION_KEYS)) return { ok: false, message: `Submission must contain exactly: ${SUBMISSION_KEYS.join(", ")}.` };
  const candidate = value as Record<string, unknown>;
  for (const key of ["snapshotId", "projectRevision"] as const) {
    if (typeof candidate[key] !== "string" || !DIGEST_PATTERN.test(candidate[key])) return { ok: false, message: `${key} must be a sha256 hex digest.`, path: key };
  }
  for (const key of ["baselineRevision", "idempotencyKey"] as const) {
    if (typeof candidate[key] !== "string" || !IDENTITY_PATTERN.test(candidate[key])) return { ok: false, message: `${key} must be a short opaque identity without separators or URLs.`, path: key };
  }
  const identity = candidate.packageIdentity;
  if (identity === null || typeof identity !== "object" || Array.isArray(identity) || !exactKeys(identity, PACKAGE_KEYS)) return { ok: false, message: "packageIdentity must contain exactly packId, packVersion and contractVersion.", path: "packageIdentity" };
  const pack = identity as Record<string, unknown>;
  if (typeof pack.packId !== "string" || !PACK_ID_PATTERN.test(pack.packId)) return { ok: false, message: "packId must be a package-like identifier.", path: "packageIdentity.packId" };
  if (typeof pack.packVersion !== "string" || !IDENTITY_PATTERN.test(pack.packVersion)) return { ok: false, message: "packVersion must be a short version token.", path: "packageIdentity.packVersion" };
  if (!Number.isSafeInteger(pack.contractVersion) || (pack.contractVersion as number) < 1) return { ok: false, message: "contractVersion must be a positive integer.", path: "packageIdentity.contractVersion" };
  return { ok: true, value: structuredClone(value) as ContentExportSubmission };
}

export interface FakeContentExportAdapterOptions {
  now?: () => string;
}

export interface FakeContentExportAdapter extends ContentExportAdapter {
  /** Test control: move an operation to `state`, optionally attaching host evidence. */
  advance(operationId: string, state: ContentExportState, details?: { evidence?: ContentExportEvidence; message?: string }): void;
  readonly submissions: readonly { operationId: string; submission: ContentExportSubmission }[];
}

/**
 * Deterministic sink for tests and the consumer fixture. Operation ids derive
 * from the idempotency key; states only move when a test says so, and
 * `deployed` is never reached on its own because no host evidence exists.
 */
export function createFakeContentExportAdapter(options: FakeContentExportAdapterOptions = {}): FakeContentExportAdapter {
  const now = options.now ?? (() => new Date().toISOString());
  const byKey = new Map<string, { operationId: string; submission: ContentExportSubmission }>();
  const statuses = new Map<string, ContentExportStatus>();
  const submissions: { operationId: string; submission: ContentExportSubmission }[] = [];
  return {
    submissions,
    async submit(submission) {
      const validation = validateContentExportSubmission(submission);
      if (!validation.ok) return { status: "rejected", message: validation.message, ...(validation.path ? { path: validation.path } : {}) };
      const existing = byKey.get(validation.value.idempotencyKey);
      if (existing) {
        const same = JSON.stringify(existing.submission) === JSON.stringify(validation.value);
        return same ? { status: "ok", value: { operationId: existing.operationId, replayed: true } } : { status: "conflict", operationId: existing.operationId };
      }
      const operationId = `export-${String(byKey.size + 1).padStart(4, "0")}`;
      const record = { operationId, submission: validation.value };
      byKey.set(validation.value.idempotencyKey, record);
      submissions.push(record);
      statuses.set(operationId, { operationId, state: "submitted", snapshotId: validation.value.snapshotId, baselineRevision: validation.value.baselineRevision, updatedAt: now() });
      return { status: "ok", value: { operationId, replayed: false } };
    },
    async status(operationId) {
      const status = statuses.get(operationId);
      return status ? { status: "ok", value: structuredClone(status) } : { status: "not-found" };
    },
    advance(operationId, state, details = {}) {
      const status = statuses.get(operationId);
      if (!status) throw new Error(`Unknown export operation "${operationId}".`);
      statuses.set(operationId, { ...status, state, ...(details.evidence ? { evidence: structuredClone(details.evidence) } : {}), ...(details.message ? { message: details.message } : {}), updatedAt: now() });
    },
  };
}
