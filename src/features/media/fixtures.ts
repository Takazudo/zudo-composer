import {
  createMediaRecord,
  loadMediaRecord,
  MediaPersistenceError,
  summarizeMedia,
  validateMediaRecord,
} from "../../media";
import type {
  MediaByteSource,
  MediaInitializationOutcome,
  MediaLoadOutcome,
  MediaProvider,
  MediaRecord,
  MediaSeed,
  MediaStore,
  MediaSummary,
} from "../../media";
import { isSafeRecordId } from "../../shared";

const FIXTURE_TIMESTAMP = "2026-01-01T00:00:00.000Z";
const FIXTURE_CHECKSUM = "0000000000000000000000000000000000000000000000000000000000000000";

export interface MemoryMediaProviderOptions {
  initialization?: MediaInitializationOutcome;
  failWrites?: boolean;
  records?: readonly MediaRecord[];
  /** Optional bytes keyed by record id; supplying this enables byte checks. */
  bytes?: Readonly<Record<string, Uint8Array>>;
  /** Metadata ids whose bytes should deliberately read as absent. */
  missingBytes?: readonly string[];
}

function cloneRecord(record: MediaRecord): MediaRecord {
  return structuredClone(record);
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

async function readByteSource(source: MediaByteSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return cloneBytes(source);
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  const chunks: Uint8Array[] = [];
  if (typeof ReadableStream !== "undefined" && source instanceof ReadableStream) {
    const reader = source.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(cloneBytes(next.value));
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    for await (const chunk of source as AsyncIterable<Uint8Array>) chunks.push(cloneBytes(chunk));
  }
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function checksum(bytes: Uint8Array): Promise<string | undefined> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) return undefined;
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = await subtle.digest("SHA-256", stable.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function readyOutcome(records: Iterable<MediaRecord>): MediaInitializationOutcome {
  const summaries = [...records].map(summarizeMedia).sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return { status: "ready", summaries };
}

function rawId(raw: unknown, fallback: string): string {
  return raw !== null && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : fallback;
}

function scanInitialization(records: Iterable<unknown>): MediaInitializationOutcome {
  const summaries: MediaSummary[] = [];
  const failures: { id: string; status: "invalid" | "future-schema"; version?: number }[] = [];
  let index = 0;
  for (const raw of records) {
    index += 1;
    const loaded = loadMediaRecord(raw);
    if (loaded.status === "loaded") summaries.push(summarizeMedia(loaded.record));
    else if (loaded.status === "future-schema") failures.push({ id: rawId(raw, `media-unknown-${index}`), status: loaded.status, version: loaded.foundSchemaVersion });
    else if (loaded.status === "invalid") failures.push({ id: rawId(raw, `media-unknown-${index}`), status: loaded.status });
  }
  summaries.sort((a, b) => a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : a.updatedAt > b.updatedAt ? -1 : 1);
  if (failures.length === 0) return { status: "ready", summaries };
  const future = failures.find((failure) => failure.status === "future-schema");
  return {
    status: "recovery-required",
    summaries,
    recovery: {
      kind: "quarantined",
      reason: future === undefined ? "invalid" : "future-schema",
      sourcePreserved: true,
      affectedRecordIds: failures.map((failure) => failure.id),
      ...(future?.version === undefined ? {} : { foundSchemaVersion: future.version }),
      message: future === undefined
        ? "Media storage contains malformed records. The source data was preserved."
        : "Media storage contains records from a newer schema. The source data was preserved.",
    },
  };
}

function cloneInitialization(outcome: MediaInitializationOutcome): MediaInitializationOutcome {
  if (outcome.status === "ready") return { status: "ready", summaries: outcome.summaries.map((summary) => ({ ...summary })) };
  if (outcome.status === "recovery-required") {
    return {
      status: "recovery-required",
      summaries: outcome.summaries.map((summary) => ({ ...summary })),
      recovery: {
        ...outcome.recovery,
        affectedRecordIds: [...outcome.recovery.affectedRecordIds],
      },
    };
  }
  return { status: "error", error: outcome.error };
}

/**
 * A deterministic provider for feature tests. It follows the same async
 * store/provider shape as the production provider without touching browser or
 * filesystem APIs.
 */
export function createMemoryMediaProvider(options: MemoryMediaProviderOptions = {}): MediaProvider {
  const records = new Map<string, unknown>();
  (options.records ?? []).forEach((record, index) => {
    const raw = record as unknown;
    records.set(rawId(raw, `media-unknown-${index + 1}`), structuredClone(raw));
  });
  const bytes = new Map<string, Uint8Array>(Object.entries(options.bytes ?? {}).map(([id, value]) => [id, cloneBytes(value)]));
  const missingBytes = new Set(options.missingBytes ?? []);
  const provider = { id: "media-memory", label: "In-memory Media" } as const;

  const summaries = (): MediaSummary[] => [...records.values()].flatMap((raw) => {
    const loaded = loadMediaRecord(raw);
    return loaded.status === "loaded" ? [summarizeMedia(loaded.record)] : [];
  });

  const initial = (): MediaInitializationOutcome => options.initialization === undefined
    ? scanInitialization(records.values())
    : cloneInitialization(options.initialization);

  const failWrite = (operation: "put" | "delete" | "seed" | "clear"): never => {
    throw new MediaPersistenceError(operation, "write-failed", "Media fixture write failed.", true);
  };

  const store: MediaStore = {
    provider,
    list: async () => summaries().sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
      return a.id.localeCompare(b.id);
    }),
    get: async (id): Promise<MediaLoadOutcome> => {
      if (!isSafeRecordId(id)) return { status: "not-found", id };
      const raw = records.get(id);
      if (raw === undefined) return { status: "not-found", id };
      const loaded = loadMediaRecord(raw);
      if (loaded.status !== "loaded") return loaded;
      if (missingBytes.has(id)) return { status: "bytes-missing", record: cloneRecord(loaded.record), reason: "missing" };
      const storedBytes = bytes.get(id);
      if (storedBytes === undefined) return { status: "loaded", record: cloneRecord(loaded.record) };
      const actualChecksum = await checksum(storedBytes);
      if (storedBytes.byteLength !== loaded.record.document.byteLength || (actualChecksum !== undefined && actualChecksum !== loaded.record.document.checksum)) {
        return { status: "bytes-missing", record: cloneRecord(loaded.record), reason: "checksum-mismatch" };
      }
      return { status: "loaded", record: cloneRecord(loaded.record) };
    },
    put: async (record, source) => {
      if (options.failWrites) failWrite("put");
      const validation = validateMediaRecord(record);
      if (!validation.ok) throw new MediaPersistenceError("put", "validation", validation.issue.message, false);
      const storedBytes = await readByteSource(source);
      records.set(record.id, cloneRecord(validation.value));
      missingBytes.delete(record.id);
      bytes.set(record.id, storedBytes);
    },
    delete: async (id) => {
      if (options.failWrites) failWrite("delete");
      if (!isSafeRecordId(id)) return false;
      const deleted = records.delete(id);
      bytes.delete(id);
      missingBytes.delete(id);
      return deleted;
    },
    seed: async (seed: MediaSeed) => {
      if (options.failWrites) failWrite("seed");
      for (const record of seed.records) {
        const source = seed.bytes?.[record.id] ?? new Uint8Array(record.document.byteLength);
        await store.put(record, source);
      }
    },
    clear: async () => {
      if (options.failWrites) failWrite("clear");
      records.clear();
      bytes.clear();
      missingBytes.clear();
    },
  };

  const initialize = async (): Promise<MediaInitializationOutcome> => initial();
  return {
    descriptor: provider,
    store,
    initialization: {
      initialize,
      retry: initialize,
      startFresh: async () => {
        try {
          await store.clear();
          return readyOutcome([]);
        } catch (error) {
          return {
            status: "error",
            error: error instanceof MediaPersistenceError
              ? error
              : new MediaPersistenceError("clear", "unknown", "Starting fresh Media storage failed.", true, { cause: error }),
          };
        }
      },
    },
  };
}

const defaultRecord = createMediaRecord({ fileName: "sample.png", mediaType: "image/png", byteLength: 0, checksum: FIXTURE_CHECKSUM }, { id: "sample-image", timestamp: FIXTURE_TIMESTAMP });

export type MediaRenderFixtureName = "populated" | "empty" | "broken";

/** Stable fixtures used by the Media route and its controller tests. */
export const mediaRenderFixtures: Readonly<Record<MediaRenderFixtureName, () => { provider: MediaProvider }>> = Object.freeze({
  populated: () => ({ provider: createMemoryMediaProvider({ records: [defaultRecord] }) }),
  empty: () => ({ provider: createMemoryMediaProvider() }),
  broken: () => ({
    provider: createMemoryMediaProvider({
      initialization: {
        status: "recovery-required",
        summaries: [],
        recovery: {
          kind: "quarantined",
          reason: "future-schema",
          sourcePreserved: true,
          affectedRecordIds: ["future-media"],
          foundSchemaVersion: 2,
          message: "A newer Media record was preserved.",
        },
      },
    }),
  }),
});

/** Compatibility-style singular fixture factory used by route harnesses. */
export function createDefaultMemoryMediaProvider(): MediaProvider {
  return createMemoryMediaProvider({ records: [defaultRecord] });
}
