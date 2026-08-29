import { isSafeRecordId } from "../../shared";
import type {
  ContentCatalog,
  ContentCatalogEntry,
  ContentCatalogListOutcome,
  ContentCatalogProvider,
  ContentCatalogProviderFailure,
  ContentCatalogResolveOutcome,
  ContentModelRef,
} from "./types";

function reason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : typeof error === "string" && error ? error : fallback;
}

function validateRef(ref: unknown): string | undefined {
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) return "Content model reference must be an object.";
  const value = ref as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || typeof value.providerId !== "string" || value.providerId.length === 0) return "Content model reference providerId must be a non-empty string.";
  if (!isSafeRecordId(value.recordId)) return "Content model reference recordId is not a safe record id.";
  return undefined;
}

export function createContentCatalog(providers: readonly ContentCatalogProvider[]): ContentCatalog {
  const byId = new Map<string, ContentCatalogProvider>();
  for (const provider of providers) {
    if (!provider || typeof provider !== "object" || !provider.descriptor || typeof provider.descriptor.id !== "string" || !provider.descriptor.id || typeof provider.descriptor.label !== "string" || !provider.descriptor.label || !provider.store || typeof provider.store.listModels !== "function" || typeof provider.store.getModel !== "function") throw new TypeError("Content catalog providers must expose a non-empty id, label, listModels, and getModel.");
    if (byId.has(provider.descriptor.id)) throw new TypeError(`Duplicate Content provider id "${provider.descriptor.id}".`);
    byId.set(provider.descriptor.id, provider);
  }
  return {
    async listModels(): Promise<ContentCatalogListOutcome> {
      const entries: ContentCatalogEntry[] = []; const failures: ContentCatalogProviderFailure[] = [];
      const results = await Promise.all([...byId.values()].map(async (provider) => {
        try { return { provider, summaries: await provider.store.listModels() } as const; }
        catch (error) { return { provider, error } as const; }
      }));
      for (const result of results) {
        if ("error" in result) failures.push({ providerId: result.provider.descriptor.id, providerLabel: result.provider.descriptor.label, reason: reason(result.error, "Content provider could not list models.") });
        else for (const summary of result.summaries) entries.push({ ref: { providerId: result.provider.descriptor.id, recordId: summary.id }, providerLabel: result.provider.descriptor.label, summary });
      }
      return { status: "listed", entries, failures };
    },
    async resolveModel(ref: ContentModelRef): Promise<ContentCatalogResolveOutcome> {
      const invalid = validateRef(ref);
      if (invalid) return { status: "invalid", reason: invalid };
      const provider = byId.get(ref.providerId);
      if (!provider) return { status: "not-found" };
      try {
        const result = await provider.store.getModel(ref.recordId);
        switch (result.status) {
          case "loaded": return { status: "resolved", record: result.record };
          case "not-found": return { status: "not-found" };
          case "invalid": return { status: "invalid", reason: result.issue.message };
          case "future-schema": return { status: "invalid", reason: `Content model uses unsupported schema version ${result.foundSchemaVersion}.` };
        }
      } catch (error) { return { status: "provider-error", reason: reason(error, "Content provider could not resolve the model.") }; }
    },
  };
}
