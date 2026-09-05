/** Durable generation stored in the same transaction as the records it guards. */
export const MUTATION_META_KEY = "mutation";
export class PersistenceGenerationError extends Error {
  constructor(readonly code: "unsupported-version" | "write-failed", message: string) { super(message); }
}
export interface PersistedSnapshot<T> { mutationToken: number | string; records: readonly T[] }
export interface SnapshotStore<T> {
  snapshot(): Promise<PersistedSnapshot<T>>;
  mutationToken(): Promise<number | string>;
}

interface StorageRequest<T> { readonly result: T; readonly error: unknown; addEventListener(type: "success" | "error", callback: () => void): void }
interface StorageTransaction { objectStore(name: string): { get(key: string): StorageRequest<unknown>; put(value: unknown): unknown } }
export function requestValue<T>(request: StorageRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

export async function readMutationToken(transaction: StorageTransaction, metaStore = "meta"): Promise<number> {
  const value: unknown = await requestValue(transaction.objectStore(metaStore).get(MUTATION_META_KEY));
  if (!value || typeof value !== "object" || !("token" in value) || !Number.isSafeInteger(value.token) || (value.token as number) < 0) {
    throw new PersistenceGenerationError("unsupported-version", "Durable mutation metadata is missing or invalid; explicit recovery is required.");
  }
  return value.token as number;
}

export async function advanceMutationToken(transaction: StorageTransaction, metaStore = "meta"): Promise<void> {
  const token = await readMutationToken(transaction, metaStore);
  if (token === Number.MAX_SAFE_INTEGER) throw new PersistenceGenerationError("write-failed", "Durable mutation generation is exhausted.");
  transaction.objectStore(metaStore).put({ key: MUTATION_META_KEY, token: token + 1 });
}

const listeners = new Set<(database: string) => void>();
let channel: BroadcastChannel | undefined;
function emit(database: string) { for (const listener of listeners) { try { listener(database); } catch { /* Observers cannot change a committed write outcome. */ } } }
function changesChannel(): BroadcastChannel | undefined {
  if (!channel && "window" in globalThis && typeof BroadcastChannel !== "undefined") {
    try { channel = new BroadcastChannel("zudo-workspace-persistence-v1"); } catch { return undefined; }
    channel.onmessage = ({ data }) => {
      if (typeof data === "string") emit(data);
    };
  }
  return channel;
}
/** Refresh hints only. Snapshot correctness always uses persisted tokens. */
export function notifyPersistenceChange(database: string): void {
  emit(database);
  try { changesChannel()?.postMessage(database); } catch { /* Persisted tokens remain authoritative. */ }
  if (!listeners.size) { channel?.close(); channel = undefined; }
}
export function subscribePersistenceChanges(listener: (database: string) => void): () => void {
  listeners.add(listener);
  changesChannel();
  return () => { listeners.delete(listener); if (!listeners.size) { channel?.close(); channel = undefined; } };
}
