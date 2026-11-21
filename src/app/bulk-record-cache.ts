import { subscribePersistenceChanges } from "../shared/persistence-generation";

/** Short enough that a write this tab never hears about cannot linger. */
export const BULK_RECORD_TTL_MS = 3000;

/**
 * Serves per-record reads from one bulk read per burst, so a library that
 * resolves hundreds of rows makes one request instead of one per row. Any
 * persistence change (this tab or another, via the broadcast channel) or the
 * TTL drops it. `undefined` means "not served here": callers fall back to their
 * exact per-record read, which also keeps every error/invalid outcome exact.
 */
export function createBulkRecordCache<T>(read: () => Promise<readonly T[]>, idOf: (record: T) => string, ttlMs = BULK_RECORD_TTL_MS) {
  let current: { records: Promise<Map<string, T>>; stop: () => void; timer: ReturnType<typeof setTimeout> } | undefined;
  const drop = () => { if (!current) return; current.stop(); clearTimeout(current.timer); current = undefined; };
  return async (id: string): Promise<T | undefined> => {
    if (!current) {
      const records = read().then((values) => new Map(values.map((record) => [idOf(record), record])));
      const entry = { records, stop: subscribePersistenceChanges(() => { if (current === entry) drop(); }), timer: setTimeout(() => { if (current === entry) drop(); }, ttlMs) };
      current = entry;
      records.catch(() => { if (current === entry) drop(); });
    }
    try {
      const record = (await current.records).get(id);
      return record === undefined ? undefined : structuredClone(record);
    } catch { return undefined; }
  };
}
