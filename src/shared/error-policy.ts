// Error vocabulary a confined store hands to the shared filesystem/transaction
// helpers. Portable so a store generic over RecordTransactionStorage can type
// against it without reaching the Node filesystem modules.

export type SafeRootErrorCode = "blocked" | "read-failed" | "write-failed";

/**
 * Codes a store needs on top of root confinement once it takes a cross-process
 * lock and proves durability. A domain whose error type cannot represent them
 * cannot use the mutation-lock helpers, and the type system says so.
 */
export type DurableExtraErrorCode = "conflict" | "commit-uncertain";

export interface SafeRootErrorPolicy<Operation extends string, ExtraCode extends string = never> {
  isError(value: unknown): boolean;
  create(
    operation: Operation,
    code: SafeRootErrorCode | ExtraCode,
    message: string,
    cause?: unknown,
  ): Error;
  rethrow(
    operation: Operation,
    code: "read-failed" | "write-failed",
    message: string,
    cause: unknown,
  ): never;
}
