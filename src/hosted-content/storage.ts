// The durable draft storage contract a host (for example a D1-backed Worker)
// implements for the restricted content editor, plus a portable in-memory
// reference implementation.
//
// Responsibilities the contract fixes, so a host cannot claim more than it
// proves:
//
//   - `apply` compares BOTH preconditions (draft revision and baseline
//     revision) and the operation id under the adapter's single transaction
//     boundary. A losing precondition writes nothing: no revision, no receipt,
//     no partial collection change.
//   - A duplicate `operationId` with the identical request replays the stored
//     receipt instead of applying twice; the same id with a different request
//     is a conflict. That is what makes a retry after a lost acknowledgement
//     safe.
//   - `snapshot` captures an immutable, coherent project at one draft revision
//     and names it by content digest, so an export refers to exact bytes.
//   - `advanceBaseline` moves the integrated base. A clean draft follows the
//     new baseline; a draft with newer unsent edits keeps them and only
//     records the new baseline identity. Either way the draft revision moves,
//     so a save prepared against the old state loses.
//
// Two independent writes are never one transaction, and an in-memory queue is
// not a cross-process guarantee: the memory adapter below proves the
// semantics, the host's adapter proves durability under
// `runContentStorageConformance`.

import type { JsonValue } from "@zudo-composer/component-contract";
import { TransactionalContentStore } from "../content/storage/filesystem/transactional-store";
import { CONTENT_PROVIDERS, ContentPersistenceError } from "../content/library/types";
import type { ContentMutation, ContentPersistenceErrorCode, ContentSnapshot } from "../content/library/types";
import { memoryTransactions } from "../shared/memory-transactions";
import { canonicalStringifyJson, serializeSiteProject } from "../site-project/model/canonical";
import type { SiteProject } from "../site-project/model/types";
import type { HostContentActor } from "./policy";

export interface ContentBaseline {
  /** The integrated project, exactly as the host's canonical source holds it. */
  readonly project: SiteProject;
  /** Host-defined identity of that source state, for example a Git commit. */
  readonly baselineRevision: string;
}

export interface ContentDraftState {
  readonly snapshot: ContentSnapshot;
  /** The revision `apply` compares against; the memory adapter uses the Content mutation token. */
  readonly draftRevision: number;
  readonly baselineRevision: string;
}

export interface ContentDraftApplyInput {
  readonly operationId: string;
  readonly actor: HostContentActor;
  readonly mutation: ContentMutation;
  readonly expectedDraftRevision: number;
  readonly expectedBaselineRevision: string;
  /**
   * Digest of the caller's own request when the mutation was derived from it
   * (see `applyHostContentRequest`). A replay is then matched by this digest
   * rather than by the derived mutation, whose timestamps differ per attempt.
   */
  readonly requestDigest?: string;
}

export interface ContentOperationReceipt {
  readonly operationId: string;
  readonly actor: HostContentActor;
  readonly appliedAt: string;
  readonly previousDraftRevision: number;
  readonly draftRevision: number;
  readonly baselineRevision: string;
  /** Digest of the exact request, so a replay can prove it is the same operation. */
  readonly requestDigest: string;
  readonly affectedEntryIds: readonly string[];
}

export interface ContentDraftApplied {
  readonly receipt: ContentOperationReceipt;
  readonly draft: ContentDraftState;
  /** True when an earlier identical operation was already applied and its receipt returned. */
  readonly replayed: boolean;
}

export interface ContentSnapshotRecord {
  /** sha256 of the canonical project text. */
  readonly snapshotId: string;
  readonly project: SiteProject;
  readonly draftRevision: number;
  readonly baselineRevision: string;
  readonly createdAt: string;
}

export interface ContentBaselineAdvanceInput {
  readonly baseline: ContentBaseline;
  readonly expectedBaselineRevision: string;
  /** The snapshot the host integrated; a draft at that snapshot's revision is clean afterwards. */
  readonly integratedSnapshotId: string;
}

export type ContentDraftConflictReason = "draft-revision" | "baseline-revision" | "operation-id";

export type ContentDraftReadResult<T> = { status: "ok"; value: T } | { status: "not-found" } | { status: "unavailable"; message: string };
export type ContentDraftMutationResult<T> =
  | ContentDraftReadResult<T>
  | { status: "conflict"; reason: ContentDraftConflictReason; current: { draftRevision: number; baselineRevision: string } }
  /** The storage transaction refused the mutation itself; nothing was written. */
  | { status: "rejected"; code: ContentPersistenceErrorCode; message: string }
  /** The write may have reached storage; recover through `readReceipt`. */
  | { status: "uncertain"; message: string; operationId: string };

export interface ContentDraftStorageAdapter {
  readBaseline(): Promise<ContentDraftReadResult<ContentBaseline>>;
  readDraft(): Promise<ContentDraftReadResult<ContentDraftState>>;
  apply(input: ContentDraftApplyInput): Promise<ContentDraftMutationResult<ContentDraftApplied>>;
  readReceipt(operationId: string): Promise<ContentDraftReadResult<ContentOperationReceipt>>;
  snapshot(input: { expectedDraftRevision: number }): Promise<ContentDraftMutationResult<ContentSnapshotRecord>>;
  readSnapshot(snapshotId: string): Promise<ContentDraftReadResult<ContentSnapshotRecord>>;
  advanceBaseline(input: ContentBaselineAdvanceInput): Promise<ContentDraftMutationResult<ContentDraftState>>;
}

const encoder = new TextEncoder();

/** Hex sha256 through Web Crypto, available to Workers, browsers and Node alike. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function contentDraftRequestDigest(input: Pick<ContentDraftApplyInput, "mutation" | "expectedDraftRevision" | "expectedBaselineRevision">): Promise<string> {
  return sha256Hex(canonicalStringifyJson({ mutation: input.mutation, expectedDraftRevision: input.expectedDraftRevision, expectedBaselineRevision: input.expectedBaselineRevision } as unknown as JsonValue));
}

/** The project with its `providerId` Content provider replaced by the draft snapshot's models and entries. */
export function projectWithContentSnapshot(project: SiteProject, snapshot: ContentSnapshot): SiteProject {
  const copy = structuredClone(project);
  const provider = copy.providers.content.find((candidate) => candidate.id === snapshot.providerId);
  if (!provider) throw new Error(`Project has no Content provider "${snapshot.providerId}".`);
  provider.models = structuredClone([...snapshot.models]);
  provider.entries = structuredClone([...snapshot.entries]);
  return copy;
}

export function contentSnapshotId(project: SiteProject): Promise<string> {
  return sha256Hex(serializeSiteProject(project));
}

export interface MemoryContentDraftStorageOptions {
  /** Canonical ISO timestamp source for receipts and snapshots. */
  now?: () => string;
  /**
   * Test seam: throws after the transaction committed but before the result
   * is returned, which is how a lost acknowledgement looks to a caller.
   */
  afterCommit?: (operationId: string) => void;
}

/**
 * Reference adapter: the real transactional Content store over an in-memory
 * record store, serialised behind one queue so every precondition is compared
 * in the same critical section as the write it guards.
 */
export async function createMemoryContentDraftStorage(baseline: ContentBaseline, options: MemoryContentDraftStorageOptions = {}): Promise<ContentDraftStorageAdapter> {
  const now = options.now ?? (() => new Date().toISOString());
  const providerId = CONTENT_PROVIDERS.filesystem.id;
  const seedProvider = baseline.project.providers.content.find((provider) => provider.id === providerId);
  if (!seedProvider) throw new Error(`Baseline project has no Content provider "${providerId}".`);
  const store = await TransactionalContentStore.fromRecords(memoryTransactions({ conflict: () => new ContentPersistenceError("transact", "conflict", "Draft changed since the mutation was prepared.", true) }), now);
  await store.seed({ models: structuredClone(seedProvider.models), entries: structuredClone(seedProvider.entries) });
  let current: ContentBaseline = structuredClone(baseline);
  let baselineRevision = baseline.baselineRevision;
  const receipts = new Map<string, ContentOperationReceipt>();
  const snapshots = new Map<string, ContentSnapshotRecord>();
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };
  const draft = async (): Promise<ContentDraftState> => {
    const snapshot = await store.readAll();
    return { snapshot, draftRevision: snapshot.mutationToken, baselineRevision };
  };
  const conflict = async (reason: ContentDraftConflictReason): Promise<ContentDraftMutationResult<never>> => {
    const state = await draft();
    return { status: "conflict", reason, current: { draftRevision: state.draftRevision, baselineRevision: state.baselineRevision } };
  };

  return {
    async readBaseline() { return { status: "ok", value: structuredClone(current) }; },
    async readDraft() { return serialized(async () => ({ status: "ok", value: await draft() })); },
    apply(input) {
      return serialized(async (): Promise<ContentDraftMutationResult<ContentDraftApplied>> => {
        const requestDigest = input.requestDigest ?? await contentDraftRequestDigest(input);
        const existing = receipts.get(input.operationId);
        if (existing) {
          if (existing.requestDigest !== requestDigest) return conflict("operation-id");
          return { status: "ok", value: { receipt: existing, draft: await draft(), replayed: true } };
        }
        if (input.expectedBaselineRevision !== baselineRevision) return conflict("baseline-revision");
        const before = await draft();
        if (input.expectedDraftRevision !== before.draftRevision || input.mutation.expectedMutationToken !== before.draftRevision) return conflict("draft-revision");
        let next: ContentSnapshot;
        try {
          next = await store.transact(input.mutation);
        } catch (error) {
          if (error instanceof ContentPersistenceError) return error.code === "conflict" ? conflict("draft-revision") : { status: "rejected", code: error.code, message: error.message };
          return { status: "unavailable", message: error instanceof Error ? error.message : String(error) };
        }
        const receipt: ContentOperationReceipt = {
          operationId: input.operationId,
          actor: { subject: input.actor.subject },
          appliedAt: now(),
          previousDraftRevision: before.draftRevision,
          draftRevision: next.mutationToken,
          baselineRevision,
          requestDigest,
          affectedEntryIds: affectedEntryIds(input.mutation),
        };
        receipts.set(input.operationId, receipt);
        options.afterCommit?.(input.operationId);
        return { status: "ok", value: { receipt, draft: { snapshot: next, draftRevision: next.mutationToken, baselineRevision }, replayed: false } };
      });
    },
    async readReceipt(operationId) {
      const receipt = receipts.get(operationId);
      return receipt ? { status: "ok", value: receipt } : { status: "not-found" };
    },
    snapshot(input) {
      return serialized(async (): Promise<ContentDraftMutationResult<ContentSnapshotRecord>> => {
        const state = await draft();
        if (input.expectedDraftRevision !== state.draftRevision) return conflict("draft-revision");
        const project = projectWithContentSnapshot(current.project, state.snapshot);
        const snapshotId = await contentSnapshotId(project);
        const record = snapshots.get(snapshotId) ?? { snapshotId, project, draftRevision: state.draftRevision, baselineRevision, createdAt: now() };
        snapshots.set(snapshotId, record);
        return { status: "ok", value: structuredClone(record) };
      });
    },
    async readSnapshot(snapshotId) {
      const record = snapshots.get(snapshotId);
      return record ? { status: "ok", value: structuredClone(record) } : { status: "not-found" };
    },
    advanceBaseline(input) {
      return serialized(async (): Promise<ContentDraftMutationResult<ContentDraftState>> => {
        if (input.expectedBaselineRevision !== baselineRevision) return conflict("baseline-revision");
        const integrated = snapshots.get(input.integratedSnapshotId);
        if (!integrated) return { status: "not-found" };
        const provider = input.baseline.project.providers.content.find((candidate) => candidate.id === providerId);
        if (!provider) return { status: "rejected", code: "validation", message: `Baseline project has no Content provider "${providerId}".` };
        const state = await draft();
        const clean = state.draftRevision === integrated.draftRevision;
        try {
          // The draft revision always advances so an in-flight save prepared
          // against the previous base cannot land on the new one. A clean
          // draft is rebuilt from the integrated baseline through the store's
          // own seed path, which is the one write that may set lifecycles.
          if (clean) {
            await store.clear();
            await store.seed({ models: structuredClone(provider.models), entries: structuredClone(provider.entries) });
          } else {
            await store.transact({ expectedMutationToken: state.draftRevision, operations: [] });
          }
        } catch (error) {
          if (error instanceof ContentPersistenceError) return { status: "rejected", code: error.code, message: error.message };
          return { status: "unavailable", message: error instanceof Error ? error.message : String(error) };
        }
        current = structuredClone(input.baseline);
        baselineRevision = input.baseline.baselineRevision;
        return { status: "ok", value: await draft() };
      });
    },
  };
}

function affectedEntryIds(mutation: ContentMutation): string[] {
  const ids = new Set<string>();
  for (const operation of mutation.operations) {
    if (operation.kind === "put-entry") ids.add(operation.record.id);
    else if (operation.kind === "delete-entry" || operation.kind === "unpublish-entry") ids.add(operation.id);
  }
  return [...ids].sort();
}
