import type { RecordTransactionStorage } from "../shared/record-transaction-storage";
import { memoryTransactions as portableMemoryTransactions } from "../shared/memory-transactions";
import { notifyPersistenceChange } from "../shared/persistence-generation";
/** Each instance is private to one workspace in one browser realm. */
export function memoryTransactions(channel: string, conflict: () => Error = () => new Error("Demo transaction conflict. Refresh and retry.")): RecordTransactionStorage {
  return portableMemoryTransactions({ conflict, onCommit: () => notifyPersistenceChange(channel) });
}
