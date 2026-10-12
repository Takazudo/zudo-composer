import type { RecordTransactionStorage } from "./record-transaction-storage";
import type { RecordTransactionSnapshot } from "./record-transaction-types";

export interface MemoryTransactionsOptions {
  /** Error thrown when `expectedMutationToken` no longer matches. */
  conflict?: () => Error;
  /** Observes every committed generation; refresh hints only. */
  onCommit?: () => void;
}

/**
 * A queue-serialised RecordTransactionStorage held entirely in memory. Each
 * instance is private to one realm: it proves transaction/precondition
 * semantics for disposable editors and conformance suites, never durability.
 */
export function memoryTransactions(options: MemoryTransactionsOptions = {}): RecordTransactionStorage {
  const conflict = options.conflict ?? (() => new Error("Transaction conflict. Refresh and retry."));
  let snapshot: RecordTransactionSnapshot = { schemaVersion: 1, generation: 0, mutationToken: "0".repeat(64), records: [] };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    root: "memory",
    async snapshot() { await queue; return structuredClone(snapshot); },
    async mutationToken() { await queue; return snapshot.mutationToken; },
    commit(plan, commitOptions = {}) {
      const work = queue.then(async () => {
        commitOptions.signal?.throwIfAborted();
        if (commitOptions.expectedMutationToken !== undefined && commitOptions.expectedMutationToken !== snapshot.mutationToken) throw conflict();
        const next = await plan(structuredClone(snapshot));
        commitOptions.signal?.throwIfAborted();
        const generation = snapshot.generation + 1;
        snapshot = { schemaVersion: 1, generation, mutationToken: generation.toString(16).padStart(64, "0"), records: structuredClone(next.records) };
        options.onCommit?.();
        return structuredClone(next.result);
      });
      queue = work.catch(() => undefined);
      return work;
    },
  };
}
