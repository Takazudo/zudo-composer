// Sitemapper ↔ Composer boundary: this is the only module in src/sitemapper/
// that imports ../../composer/index. It never calls Composer write APIs.

import { isSafeRecordId } from "../../shared";
import type { CompositionLoadOutcome } from "../../composer/index";
import type { CompositionRef } from "../model/types";
import type {
  CatalogEntry,
  CompositionCatalog,
  CompositionCatalogListOutcome,
  CompositionCatalogProvider,
  ProviderFailure,
  ResolveOutcome,
} from "./types";

interface ProviderCollection {
  readonly get: (providerId: string) => CompositionCatalogProvider | undefined;
  readonly all: readonly CompositionCatalogProvider[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProvider(value: unknown): value is CompositionCatalogProvider {
  if (!isObject(value)) return false;
  const descriptor = value.descriptor;
  const store = value.store;
  return isObject(descriptor)
    && typeof descriptor.id === "string"
    && typeof descriptor.label === "string"
    && isObject(store)
    && typeof store.list === "function"
    && typeof store.get === "function";
}

function providerCollection(
  providers: readonly CompositionCatalogProvider[],
): ProviderCollection {
  const byId = new Map<string, CompositionCatalogProvider>();
  for (const provider of providers) {
    if (!isProvider(provider)
      || provider.descriptor.id.length === 0
      || provider.descriptor.label.length === 0) {
      throw new TypeError("Composition catalog providers must expose a non-empty id, label, list, and get.");
    }
    if (byId.has(provider.descriptor.id)) {
      throw new TypeError(`Duplicate composition provider id "${provider.descriptor.id}".`);
    }
    byId.set(provider.descriptor.id, provider);
  }
  return { get: (providerId) => byId.get(providerId), all: [...byId.values()] };
}

function failureReason(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function listEntry(
  provider: CompositionCatalogProvider,
  summary: {
    id: string;
    name: string;
    updatedAt: string;
    nodeCount: number;
  },
): CatalogEntry {
  return {
    ref: {
      providerId: provider.descriptor.id,
      recordId: summary.id,
    },
    providerLabel: provider.descriptor.label,
    name: summary.name,
    updatedAt: summary.updatedAt,
    nodeCount: summary.nodeCount,
  };
}

function invalidRefReason(ref: unknown): string | undefined {
  if (!isObject(ref) || Array.isArray(ref)) {
    return "Composition reference must be an object.";
  }
  if (typeof ref.providerId !== "string" || ref.providerId.length === 0) {
    return "Composition reference providerId must be a non-empty string.";
  }
  if (!isSafeRecordId(ref.recordId)) {
    return "Composition reference recordId is not a safe record id.";
  }
  return undefined;
}

function unreadableReason(outcome: Extract<CompositionLoadOutcome, { status: "invalid" | "future-schema" }>): string {
  return outcome.status === "invalid"
    ? outcome.issue.message
    : `The composition uses unsupported schema version ${outcome.foundSchemaVersion}.`;
}

async function resolveFromProvider(
  provider: CompositionCatalogProvider,
  recordId: string,
): Promise<ResolveOutcome> {
  let outcome: CompositionLoadOutcome;
  try {
    outcome = await provider.store.get(recordId);
  } catch (error) {
    // A provider that exists but cannot complete a read has a real target that
    // cannot currently be opened. Keep resolve's closed outcome union intact
    // and preserve the actionable operational message for the UI.
    return {
      status: "unreadable-target",
      reason: failureReason(error, `Could not read composition "${recordId}".`),
    };
  }

  switch (outcome.status) {
    case "loaded":
      return { status: "resolved", record: outcome.record };
    case "not-found":
      return { status: "not-found" };
    case "invalid":
    case "future-schema":
      return { status: "unreadable-target", reason: unreadableReason(outcome) };
    default:
      return {
        status: "unreadable-target",
        reason: "The composition provider returned an unknown load outcome.",
      };
  }
}

/**
 * Build the Sitemapper's Composer catalog boundary from the active providers.
 * Only list/get are retained; no Composer mutation method is reachable through
 * the returned API.
 */
export function createCompositionCatalog(
  providers: readonly CompositionCatalogProvider[],
): CompositionCatalog {
  const collection = providerCollection(providers);

  return {
    async listCompositions(): Promise<CompositionCatalogListOutcome> {
      const entries: CatalogEntry[] = [];
      const failures: ProviderFailure[] = [];

      // Keep each provider attached to its settled result. One rejected list
      // must not suppress entries from any provider that did load. Catching
      // inside each task also covers a malformed test/provider implementation
      // that throws synchronously before returning its Promise.
      const results = await Promise.all(
        collection.all.map(async (provider) => {
          try {
            return { provider, summaries: await provider.store.list() } as const;
          } catch (error) {
            return { provider, error } as const;
          }
        }),
      );
      for (const result of results) {
        const { provider } = result;
        if ("error" in result) {
          failures.push({
            providerId: provider.descriptor.id,
            providerLabel: provider.descriptor.label,
            reason: failureReason(
              result.error,
              `Could not list compositions from provider "${provider.descriptor.id}".`,
            ),
          });
          continue;
        }
        for (const summary of result.summaries) entries.push(listEntry(provider, summary));
      }

      return { entries, failures };
    },

    async resolveComposition(ref: CompositionRef): Promise<ResolveOutcome> {
      const reason = invalidRefReason(ref);
      if (reason !== undefined) return { status: "invalid-ref", reason };

      // The guard above proves these fields exist and have the expected
      // runtime types; keep the cast local so the public contract stays tied to
      // the schema-owned CompositionRef.
      const candidate = ref as unknown as { providerId: string; recordId: string };
      let provider: CompositionCatalogProvider | undefined;
      try {
        provider = collection.get(candidate.providerId);
      } catch {
        provider = undefined;
      }
      if (!provider) return { status: "provider-unavailable" };
      return resolveFromProvider(provider, candidate.recordId);
    },
  };
}
