import type { RecordTransactionStorage } from "../shared/record-transaction-storage";
import type { RecordTransactionSnapshot } from "../shared/node-fs/record-transaction";
import { notifyPersistenceChange } from "../shared/persistence-generation";
/** Each instance is private to one workspace in one browser realm. */
export function memoryTransactions(channel: string, conflict: () => Error = () => new Error("Demo transaction conflict. Refresh and retry.")): RecordTransactionStorage {
  let snapshot: RecordTransactionSnapshot = { schemaVersion: 1, generation: 0, mutationToken: "0".repeat(64), records: [] };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    root: "disposable-demo",
    async snapshot() { await queue; return structuredClone(snapshot); },
    async mutationToken() { await queue; return snapshot.mutationToken; },
    commit(plan, options = {}) {
      const work = queue.then(async () => {
        options.signal?.throwIfAborted();
        if (options.expectedMutationToken !== undefined && options.expectedMutationToken !== snapshot.mutationToken) throw conflict();
        const next = await plan(structuredClone(snapshot));
        options.signal?.throwIfAborted();
        const generation = snapshot.generation + 1;
        snapshot = { schemaVersion: 1, generation, mutationToken: generation.toString(16).padStart(64, "0"), records: structuredClone(next.records) };
        notifyPersistenceChange(channel);
        return structuredClone(next.result);
      });
      queue = work.catch(() => undefined);
      return work;
    },
  };
}
