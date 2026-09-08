import type { RecordTransactionContext, RecordTransactionPlan, RecordTransactionSnapshot } from "./node-fs/record-transaction";
/** Whole-record transaction capability, independent of a filesystem transport. */
export interface RecordTransactionStorage {
  readonly root: string;
  snapshot(): Promise<RecordTransactionSnapshot>;
  mutationToken(): Promise<string>;
  commit<T>(plan: (context: RecordTransactionContext) => Promise<RecordTransactionPlan<T>> | RecordTransactionPlan<T>, options?: { expectedMutationToken?: string; signal?: AbortSignal }): Promise<T>;
}
