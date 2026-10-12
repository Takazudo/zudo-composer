// A read-only Content provider over the session's adopted authoritative draft.
//
// The Content route reads models and Entries through a `ContentProvider`; in
// the hosted editor that provider is a view of the last durable draft the
// session proved. Every write method refuses: Entry edits travel through the
// session's expected-revision save path, and schema, model, deletion and
// field-removal writes are not reachable from the client role at all.

import { ContentPersistenceError, CONTENT_PROVIDERS } from "../../content/library/types";
import type { ContentEntryRecord, ContentModelRecord } from "../../content/model";
import type { ContentProvider, ContentSnapshot, ContentStore } from "../../content/library/types";

export interface HostedContentView {
  readonly provider: ContentProvider;
  replace(snapshot: ContentSnapshot): void;
}

/** Raised for any structural write a restricted client attempts. */
export class HostedContentForbiddenError extends Error {
  constructor(operation: string) {
    super(`${operation} is not available to this editor.`);
    this.name = "HostedContentForbiddenError";
  }
}

function summary(record: ContentModelRecord) {
  return { id: record.id, name: record.document.name, kind: record.document.kind, fieldCount: record.document.fields.length, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

/** `listedModelIds` are the policy's models; other models stay readable as reference targets. */
export function createHostedContentView(initial: ContentSnapshot, listedModelIds: readonly string[], label: string): HostedContentView {
  let snapshot = structuredClone(initial);
  const listed = () => snapshot.models.filter((model) => listedModelIds.includes(model.id)).map(summary);
  const entriesOf = (modelId: string): ContentEntryRecord[] => snapshot.entries.filter((entry) => entry.modelId === modelId);
  const forbidden = (operation: string) => async (): Promise<never> => { throw new HostedContentForbiddenError(operation); };
  const store: ContentStore = {
    provider: { id: snapshot.providerId, label },
    transactionScope: "unsupported",
    readAll: async () => structuredClone(snapshot),
    transact: forbidden("Direct Content transactions"),
    reconcilePublication: async () => { throw new ContentPersistenceError("reconcile-publication", "unsupported-transaction", "Publication is reconciled by the host.", false); },
    listModels: async () => listed(),
    getModel: async (id) => {
      const record = snapshot.models.find((model) => model.id === id);
      return record ? { status: "loaded", record: structuredClone(record) } : { status: "not-found", id };
    },
    putModel: forbidden("Schema editing"),
    deleteModel: forbidden("Model deletion"),
    countEntries: async (modelId) => entriesOf(modelId).length,
    getEntry: async (id) => {
      const record = snapshot.entries.find((entry) => entry.id === id);
      return record ? { status: "loaded", record: structuredClone(record) } : { status: "not-found", id };
    },
    pageEntries: async (modelId, page = {}) => {
      const all = entriesOf(modelId);
      const start = page.cursor ? Number(page.cursor) : 0;
      const limit = page.limit ?? 50;
      return { entries: structuredClone(all.slice(start, start + limit)), ...(start + limit < all.length ? { nextCursor: String(start + limit) } : {}) };
    },
    scanEntries: async (modelId) => {
      const model = snapshot.models.find((candidate) => candidate.id === modelId);
      if (!model) throw new ContentPersistenceError("scan-entries", "not-found", `Content model "${modelId}" was not found.`, false);
      const entries = entriesOf(modelId);
      return { model: structuredClone(model), count: entries.length, entries: structuredClone(entries), diagnostics: [] };
    },
    putEntry: forbidden("Direct Entry writes"),
    deleteEntry: forbidden("Entry deletion"),
    removeField: forbidden("Field removal"),
    seed: forbidden("Seeding"),
    clear: forbidden("Clearing Content"),
  };
  const ready = async () => ({ status: "ready" as const, models: listed() });
  return {
    provider: {
      descriptor: { id: CONTENT_PROVIDERS.filesystem.id, label },
      store,
      initialization: { initialize: ready, retry: ready, startFresh: forbidden("Starting fresh") },
    },
    replace(next) { snapshot = structuredClone(next); },
  };
}
