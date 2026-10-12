// Transaction record shapes shared by every RecordTransactionStorage, whether
// it is the Node filesystem store or a portable in-memory one. Kept free of
// Node imports so a browser/Worker graph can type against them.

/** One record as it is written: an id plus its already-serialized JSON text. */
export interface RecordEnvelope {
  readonly id: string;
  readonly json: string;
}

export interface RecordTransactionContext {
  readonly generation: number;
  readonly mutationToken: string;
  readonly records: readonly RecordEnvelope[];
}

/**
 * The complete next state of the domain. A transaction is expressed as the
 * whole record set rather than a diff so before/after graph validation happens
 * on one value, and so the commit has exactly one outcome for every record.
 */
export interface RecordTransactionPlan<T> {
  readonly records: readonly RecordEnvelope[];
  readonly result: T;
}

export interface RecordTransactionSnapshot {
  readonly schemaVersion: number;
  readonly generation: number;
  readonly mutationToken: string;
  readonly records: readonly RecordEnvelope[];
}

/** Only isolated reproducible generation supplies this; live stores use random tokens. */
export type RecordMutationTokenSource = (next: Omit<RecordTransactionSnapshot, "mutationToken"> & {
  readonly previousMutationToken: string;
}) => string;
