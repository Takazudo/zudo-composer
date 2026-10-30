// Native project-file Content behind the shared editorial boundary. Working
// values, history and receipts belong to the Content store; published values
// belong to the activated SiteProject release. This adapter owns neither.
import type { JsonValue } from "@zudo-composer/component-contract";
import { ContentPersistenceError } from "../library";
import type { ContentEditReceipt, ContentRevisionRecord, ContentSnapshot } from "../library";
import { isValueValidForField } from "../model/validate";
import type { ContentEntryRecord, ContentEntryRef, ContentModelRecord } from "../model";
import type { TransactionalContentStore } from "../storage/filesystem/transactional-store";
import { canonicalEditorialJson, editorialDifferences, sameEditorialValue } from "./differences";
import {
  EditorialError,
  type ContentEditorialBoundary,
  type EditorialEntryView,
  type EditorialFieldDiagnostic,
  type EditorialFieldsRequest,
  type EditorialPerspective,
  type EditorialProvenance,
  type EditorialPublicationStatus,
  type EditorialReceipt,
  type EditorialRevisionTarget,
} from "./types";

/** The activated release's Content for this provider; null before anything was activated. */
export interface NativePublishedContent {
  release: string;
  fence: number;
  entries: readonly ContentEntryRecord[];
}
export interface NativeEditorialOptions {
  store: Pick<TransactionalContentStore, "provider" | "readAll" | "editEntry" | "listRevisions" | "readRevision">;
  readPublished(): Promise<NativePublishedContent | null>;
  /** A submission still on its way to activation, when the host tracks one. */
  readSubmission?(): Promise<EditorialPublicationStatus["submission"]>;
  provenance: EditorialProvenance;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function createNativeContentEditorial(options: NativeEditorialOptions): ContentEditorialBoundary {
  const { store } = options;
  const provenance: EditorialProvenance = { actor: options.provenance.actor ? { id: options.provenance.actor.id } : null, source: options.provenance.source };
  if (!provenance.source.trim()) throw new EditorialError("configuration-required", "A trusted source label is required.");

  async function read(): Promise<ContentSnapshot> {
    try { return await store.readAll(); } catch (error) { throw translate(error); }
  }
  function own(entry: ContentEntryRef): void {
    if (entry.providerId !== store.provider.id) throw new EditorialError("not-found", "Entry is unavailable.");
  }
  function locate(snapshot: ContentSnapshot, ref: ContentEntryRef): { entry: ContentEntryRecord; model: ContentModelRecord } | null {
    const entry = snapshot.entries.find((candidate) => candidate.id === ref.recordId && candidate.modelId === ref.modelId);
    const model = snapshot.models.find((candidate) => candidate.id === ref.modelId);
    return entry && model ? { entry, model } : null;
  }
  const publishedEntry = (published: NativePublishedContent | null, ref: ContentEntryRef) =>
    published?.entries.find((entry) => entry.id === ref.recordId && entry.modelId === ref.modelId);
  async function head(ref: ContentEntryRef): Promise<string | null> {
    return (await store.listRevisions(ref.recordId, { limit: 1 }))[0]?.id ?? null;
  }
  async function revisionFor(ref: ContentEntryRef, revisionId: string): Promise<ContentRevisionRecord> {
    const revision = await store.readRevision(revisionId);
    if (!revision || revision.entry.recordId !== ref.recordId || revision.entry.modelId !== ref.modelId) throw new EditorialError("not-found", "Revision is unavailable.");
    return revision;
  }
  function expectedToken(expected: string): number {
    if (!/^(0|[1-9]\d{0,15})$/.test(expected)) throw new EditorialError("invalid-request", "Malformed precondition.");
    return Number(expected);
  }
  function assertCurrent(snapshot: ContentSnapshot, expected: string): void {
    if (expectedToken(expected) !== snapshot.mutationToken) throw new EditorialError("revision-conflict", "Content changed; reload and review before reapplying.");
  }
  function candidate(entry: ContentEntryRecord, model: ContentModelRecord, request: Pick<EditorialFieldsRequest, "values" | "clear">): Record<string, JsonValue> {
    const names = [...Object.keys(request.values), ...request.clear];
    if (new Set(names).size !== names.length) throw new EditorialError("invalid-request", "Fields may be named only once.");
    const values = structuredClone(entry.values);
    for (const fieldId of request.clear) delete values[fieldId];
    for (const [fieldId, value] of Object.entries(request.values)) values[fieldId] = structuredClone(value);
    const diagnostics = fieldDiagnostics(model, entry.values, values);
    if (diagnostics.length) throw new EditorialError("invalid-value", "The change does not match the Content model; nothing was written.", diagnostics);
    return values;
  }
  async function fingerprint(request: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalEditorialJson({ provider: store.provider.id, actor: provenance.actor?.id ?? null, source: provenance.source, request }));
    return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function receipt(value: ContentEditReceipt): EditorialReceipt {
    return { operationKey: value.operationKey, entry: structuredClone(value.entry), revisionId: value.revisionId, expected: String(value.mutationToken) };
  }
  async function view(snapshot: ContentSnapshot, published: NativePublishedContent | null, ref: ContentEntryRef, perspective: EditorialPerspective): Promise<EditorialEntryView> {
    own(ref);
    const working = locate(snapshot, ref);
    const release = publishedEntry(published, ref);
    if (!working && !(perspective === "published" && release)) throw new EditorialError("not-found", `Entry has no ${perspective} version.`);
    const shown = perspective === "working" ? working?.entry : release;
    if (!shown) throw new EditorialError("not-found", `Entry has no ${perspective} version.`);
    const workingRevisionId = await head(ref);
    return structuredClone({
      entry: { providerId: store.provider.id, modelId: ref.modelId, recordId: ref.recordId },
      perspective,
      status: !release ? "new" : working && !sameEditorialValue(working.entry.values, release.values) ? "changed" : "published",
      lifecycle: working?.entry.lifecycle ?? shown.lifecycle,
      updatedAt: shown.updatedAt,
      values: shown.values,
      workingRevisionId,
      valuesIdentity: perspective === "working"
        ? { perspective, token: String(snapshot.mutationToken), revisionId: workingRevisionId }
        : { perspective, release: published!.release, fence: published!.fence },
      expected: String(snapshot.mutationToken),
    } satisfies EditorialEntryView);
  }
  async function targetValues(snapshot: ContentSnapshot, ref: ContentEntryRef, target: EditorialRevisionTarget): Promise<Record<string, JsonValue>> {
    if ("revisionId" in target) return (await revisionFor(ref, target.revisionId)).values;
    // An Entry absent from a perspective compares as empty, so every value shows as added or removed.
    if (target.perspective === "working") return locate(snapshot, ref)?.entry.values ?? {};
    return publishedEntry(await options.readPublished(), ref)?.values ?? {};
  }
  async function edit(request: { entry: ContentEntryRef; expected: string; operationKey: string }, kind: "set-fields" | "restore-revision", body: unknown, values: (entry: ContentEntryRecord, model: ContentModelRecord) => Record<string, JsonValue>, restoredFrom?: string): Promise<EditorialReceipt> {
    own(request.entry);
    if (typeof request.operationKey !== "string" || !request.operationKey.trim()) throw new EditorialError("invalid-request", "An operation key is required.");
    try {
      const result = await store.editEntry({
        entry: request.entry,
        expectedMutationToken: expectedToken(request.expected),
        operation: { kind, key: request.operationKey },
        provenance,
        fingerprint: await fingerprint({ kind, entry: request.entry, expected: request.expected, body }),
        ...(restoredFrom ? { restoredFrom } : {}),
        values,
      });
      return receipt(result.receipt);
    } catch (error) { throw translate(error); }
  }

  return {
    backend: "native",
    async readEntry(query) {
      const [snapshot, published] = [await read(), await options.readPublished()];
      return view(snapshot, published, query.entry, query.perspective);
    },
    async readFields(query) {
      own(query.entry);
      const model = (await read()).models.find((candidate) => candidate.id === query.entry.modelId);
      if (!model) throw new EditorialError("not-found", "Entry model is unavailable.");
      return model.document.fields.map((field) => ({ id: field.id, key: field.key, label: field.label, kind: field.kind, required: field.required }));
    },
    async listRevisions(query) {
      own(query.entry);
      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new EditorialError("invalid-request", `Page limit must be an integer from 1 to ${MAX_LIMIT}.`);
      if (query.cursor !== undefined && !/^[1-9]\d{0,15}$/.test(query.cursor)) throw new EditorialError("invalid-request", "Malformed cursor.");
      const revisions = (await store.listRevisions(query.entry.recordId, { ...(query.cursor ? { beforeSequence: Number(query.cursor) } : {}), limit: limit + 1 }))
        .filter((revision) => revision.entry.modelId === query.entry.modelId);
      const page = revisions.slice(0, limit);
      return { revisions: structuredClone(page), nextCursor: revisions.length > limit ? String(page.at(-1)!.sequence) : null };
    },
    async readRevision(query) {
      own(query.entry);
      return structuredClone(await revisionFor(query.entry, query.revisionId));
    },
    async compare(query) {
      own(query.entry);
      const snapshot = await read();
      const [before, after] = [await targetValues(snapshot, query.entry, query.from), await targetValues(snapshot, query.entry, query.to)];
      const fields = snapshot.models.find((model) => model.id === query.entry.modelId)?.document.fields ?? [];
      return structuredClone({ entry: query.entry, from: query.from, to: query.to, differences: editorialDifferences(fields, before, after) });
    },
    async validateFields(request) {
      own(request.entry);
      const snapshot = await read();
      assertCurrent(snapshot, request.expected);
      const found = locate(snapshot, request.entry);
      if (!found) throw new EditorialError("not-found", "Entry is unavailable.");
      const values = candidate(found.entry, found.model, request);
      return structuredClone({ entry: request.entry, expected: request.expected, values, differences: editorialDifferences(found.model.document.fields, found.entry.values, values) });
    },
    async saveFields(request) {
      const body = { values: request.values, clear: request.clear };
      return edit(request, "set-fields", body, (entry, model) => candidate(entry, model, request));
    },
    async restoreRevision(request) {
      own(request.entry);
      const revision = await revisionFor(request.entry, request.revisionId);
      return edit(request, "restore-revision", { revisionId: request.revisionId }, (entry, model) => {
        const diagnostics = fieldDiagnostics(model, entry.values, revision.values);
        if (diagnostics.length) throw new EditorialError("restore-incompatible", "The revision cannot be restored under the current definition; nothing was written.", diagnostics);
        return structuredClone(revision.values);
      }, revision.id);
    },
    async publicationStatus() {
      const published = await options.readPublished();
      return {
        activated: { release: published?.release ?? null, fence: published?.fence ?? 0 },
        submission: (await options.readSubmission?.()) ?? null,
        artifact: null,
        deployed: false,
      };
    },
  };
}

/** Every changed field the current definition refuses, so a refusal names each one. */
function fieldDiagnostics(model: ContentModelRecord, before: Record<string, JsonValue>, after: Record<string, JsonValue>): EditorialFieldDiagnostic[] {
  const diagnostics: EditorialFieldDiagnostic[] = [];
  for (const fieldId of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const next = after[fieldId];
    if (sameEditorialValue(before[fieldId], next)) continue;
    const field = model.document.fields.find((candidate) => candidate.id === fieldId);
    if (!field) {
      if (next !== undefined) diagnostics.push({ fieldId, code: "field-removed", message: "The current definition no longer has this field." });
      continue;
    }
    if (next !== undefined && !isValueValidForField(field, next)) {
      diagnostics.push({ fieldId, code: "invalid-value", message: `The value for "${field.label}" does not match ${field.kind}.` });
    }
  }
  return diagnostics;
}

function translate(error: unknown): unknown {
  if (!(error instanceof ContentPersistenceError)) return error;
  const code = error.code === "conflict" ? "revision-conflict"
    : error.code === "operation-key-reuse" ? "operation-key-reuse"
      : error.code === "not-found" ? "not-found"
        : error.code === "validation" || error.code === "field-in-use" || error.code === "reference-in-use" ? "invalid-value"
          : error.code === "unsupported-transaction" ? "forbidden"
            : "unavailable";
  return new EditorialError(code, error.message);
}
