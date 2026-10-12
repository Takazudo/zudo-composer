import { SafeRootFilesystem, type DurableExtraErrorCode } from "./safe-root";
import { MutationLock } from "./mutation-lock";

export class MutationBarrierError extends Error {
  constructor(readonly code: string, message: string, cause?: unknown) { super(message, { cause }); }
}

/**
 * Hold a domain's existing kernel writer lock without occupying its read queue.
 * The callback may call snapshot APIs, but must not mutate this root. Writers
 * fail immediately on O_EXCL contention; there is no queue/lock wait inversion.
 * Nest roots in a single deterministic order. Never wrap Composer, whose reads
 * also acquire its writer lock for journal recovery.
 */
export async function withMutationBarrier<T>(root: string, task: () => Promise<T>): Promise<T> {
  const filesystem = await SafeRootFilesystem.create<"barrier", DurableExtraErrorCode>({
    root, initializeOperation: "barrier", rootLabel: "Mutation barrier root", ownerLabel: "Mutation barrier", recordLabel: "record",
    errors: {
      isError: value => value instanceof MutationBarrierError,
      create: (_operation, code, message, cause) => new MutationBarrierError(code, message, cause),
      rethrow: (_operation, code, message, cause): never => { if (cause instanceof MutationBarrierError) throw cause; throw new MutationBarrierError(code, message, cause); },
    },
  });
  await filesystem.assertRoot("barrier");
  const lock = await MutationLock.acquire(filesystem, "barrier", () => new Date().toISOString());
  try {
    const value = await task();
    await filesystem.assertRoot("barrier");
    return value;
  } finally {
    // The barrier never writes this domain. An uncertain downstream Composer
    // commit retains Composer's lock, not unrelated read-only dependency locks.
    await lock.release(false);
  }
}
