import type { ContentCatalog } from "../../content";
import type { CompositionCatalog } from "../../mapping";

function qualifiedKey(ref: unknown): string | null {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
  const value = ref as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "providerId,recordId" || typeof value.providerId !== "string" || typeof value.recordId !== "string") return null;
  return JSON.stringify([value.providerId, value.recordId]);
}

/** One library refresh only. Exact qualified reads (including failures) are shared;
 * selected editor resolution always uses the original catalogs afresh. */
export function libraryResolutionCatalogs(catalogs: { content: ContentCatalog; compositions: CompositionCatalog }): typeof catalogs {
  const content = new Map<string, ReturnType<ContentCatalog["resolveModel"]>>();
  const compositions = new Map<string, ReturnType<CompositionCatalog["resolve"]>>();
  return {
    content: {
      listModels: () => catalogs.content.listModels(),
      resolveModel(ref) {
        const key = qualifiedKey(ref);
        if (key === null) return catalogs.content.resolveModel(ref);
        let read = content.get(key);
        if (!read) { read = Promise.resolve().then(() => catalogs.content.resolveModel(ref)); content.set(key, read); }
        return read;
      },
    },
    compositions: {
      list: () => catalogs.compositions.list(),
      resolve(ref) {
        const key = qualifiedKey(ref);
        if (key === null) return catalogs.compositions.resolve(ref);
        let read = compositions.get(key);
        if (!read) { read = Promise.resolve().then(() => catalogs.compositions.resolve(ref)); compositions.set(key, read); }
        return read;
      },
    },
  };
}

/** Bound original provider work, preserve input order, and join every admitted
 * job even on failure. Never detach a provider response from the caller. */
export async function mapLibraryRows<T, R>(rows: readonly T[], resolve: (row: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(rows.length);
  let next = 0, failed = false;
  const worker = async () => {
    while (!failed && next < rows.length) {
      const index = next++;
      try { results[index] = await resolve(rows[index]!); }
      catch (error) { failed = true; throw error; }
    }
  };
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(4, rows.length) }, worker));
  const failure = outcomes.find(outcome => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results;
}
