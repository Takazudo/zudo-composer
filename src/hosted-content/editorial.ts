// Hosted Content behind the shared editorial boundary. Every call goes to the
// site's own HostedService, which keeps its policy, refusals and receipts.
import { EditorialError, type ContentEditorialBoundary, type EditorialEntryView, type EditorialErrorCode, type EditorialProvenance, type EditorialRevision, type EditorialRevisionTarget } from "../content/editorial/types";
import { canonicalSerialize } from "./canonical";
import { HostedContentError } from "./types";
import type { HostedActor, HostedEntryView, HostedIdentities, HostedResult, HostedRevision, HostedService } from "./types";

export interface HostedEditorialOptions {
  /** The site's service for a trusted source label; every service shares the site's storage. */
  service(source: string): HostedService;
  provenance: EditorialProvenance;
}

export function createHostedContentEditorial(options: HostedEditorialOptions): ContentEditorialBoundary {
  const actor = options.provenance.actor;
  if (!actor) throw new EditorialError("forbidden", "Hosted Content requires an authenticated actor.");
  const hostedActor: HostedActor = { id: actor.id };
  const service = options.service(options.provenance.source);
  const expectedOf = (identities: HostedIdentities) => canonicalSerialize({ draftRevision: identities.draftRevision, baseline: identities.baseline, definition: identities.definition });
  function identities(expected: string): HostedIdentities {
    try {
      const parsed = JSON.parse(expected) as HostedIdentities;
      if (parsed && typeof parsed.draftRevision === "string" && typeof parsed.definition === "string" && parsed.baseline) return parsed;
    } catch { /* reported below */ }
    throw new EditorialError("invalid-request", "Malformed precondition.");
  }
  async function call<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) { throw translate(error); }
  }
  function view(value: HostedEntryView): EditorialEntryView {
    return {
      entry: value.entry, perspective: value.perspective, status: value.status, lifecycle: value.lifecycle, updatedAt: value.updatedAt, values: value.values,
      workingRevisionId: value.workingRevisionId,
      valuesIdentity: value.valuesIdentity.perspective === "working"
        ? { perspective: "working", token: value.valuesIdentity.draftRevision, revisionId: value.valuesIdentity.revisionId }
        : { perspective: "published", release: canonicalSerialize(value.valuesIdentity.baseline), fence: value.valuesIdentity.integrationFence },
      expected: expectedOf(value.expected),
    };
  }
  const revision = (value: HostedRevision): EditorialRevision => ({
    id: value.id, entry: value.entry, sequence: value.sequence, parentId: value.parentId, values: value.values, createdAt: value.createdAt,
    actor: value.actor, source: value.source, operation: value.operation, ...(value.restoredFrom ? { restoredFrom: value.restoredFrom } : {}),
  });
  const target = (value: EditorialRevisionTarget) => "revisionId" in value ? { revisionId: value.revisionId } : { perspective: value.perspective };
  async function receipt(operationKey: string, entry: EditorialEntryView["entry"], result: HostedResult) {
    const head = (await service.listRevisions(hostedActor, { entry, limit: 1 })).revisions[0];
    // The receipt's state is the state the command produced, so a replay reports the same head and precondition.
    const appended = head && head.operation.key === operationKey ? head.id : (await findByKey(entry, operationKey)) ?? head?.id ?? null;
    return { operationKey, entry, revisionId: appended, expected: expectedOf(result.state) };
  }
  async function findByKey(entry: EditorialEntryView["entry"], operationKey: string): Promise<string | null> {
    let cursor: string | undefined;
    do {
      const page = await service.listRevisions(hostedActor, { entry, limit: 100, ...(cursor ? { cursor } : {}) });
      const found = page.revisions.find((item) => item.operation.key === operationKey);
      if (found) return found.id;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return null;
  }

  return {
    backend: "hosted",
    readEntry: (query) => call(async () => view(await service.readEntry(hostedActor, query))),
    readFields: (query) => call(async () => {
      const model = (await service.listModels(hostedActor)).find((item) => item.providerId === query.entry.providerId && item.model.id === query.entry.modelId);
      if (!model) throw new EditorialError("not-found", "Entry model is unavailable.");
      return model.model.document.fields.map((field) => ({ id: field.id, key: field.key, label: field.label, kind: field.kind, required: field.required }));
    }),
    listRevisions: (query) => call(async () => {
      const page = await service.listRevisions(hostedActor, { entry: query.entry, ...(query.cursor ? { cursor: query.cursor } : {}), ...(query.limit ? { limit: query.limit } : {}) });
      return { revisions: page.revisions.map(revision), nextCursor: page.nextCursor };
    }),
    readRevision: (query) => call(async () => {
      const value = await service.readRevision(hostedActor, query.revisionId);
      if (canonicalSerialize(value.entry) !== canonicalSerialize(query.entry)) throw new EditorialError("not-found", "Revision is unavailable.");
      return revision(value);
    }),
    compare: (query) => call(async () => {
      const value = await service.compareRevisions(hostedActor, { entry: query.entry, from: target(query.from), to: target(query.to) });
      return { entry: value.entry, from: query.from, to: query.to, differences: value.differences };
    }),
    validateFields: (request) => call(async () => {
      const value = await service.previewFields(hostedActor, { entry: request.entry, values: request.values, clear: request.clear, expected: identities(request.expected) });
      return { entry: value.entry, expected: expectedOf(value.expected), values: value.values, differences: value.differences };
    }),
    saveFields: (request) => call(async () => {
      const result = await service.execute(hostedActor, { kind: "set-fields", operationKey: request.operationKey, expected: identities(request.expected), entry: request.entry, values: request.values, clear: request.clear });
      return receipt(request.operationKey, request.entry, result);
    }),
    restoreRevision: (request) => call(async () => {
      const result = await service.execute(hostedActor, { kind: "restore-revision", operationKey: request.operationKey, expected: identities(request.expected), entry: request.entry, revisionId: request.revisionId });
      return receipt(request.operationKey, request.entry, result);
    }),
    readOperation: (query) => call(async () => {
      const found = await service.readReceipt(hostedActor, query.operationKey);
      if (!found) return null;
      // The revision the operation appended is the one that names its key in this Entry's history.
      const revisionId = await findByKey(query.entry, query.operationKey);
      if (!revisionId) throw new EditorialError("operation-key-reuse", "This operation key belongs to another Entry.");
      return { operationKey: query.operationKey, entry: query.entry, revisionId, expected: expectedOf(found.result.state) };
    }),
    publicationStatus: () => call(async () => {
      const status = await service.readPublicationStatus(hostedActor);
      return {
        activated: { release: canonicalSerialize(status.activated.baseline), fence: status.activated.integrationFence },
        submission: status.submission ? { id: status.submission.publicationId, status: status.submission.status } : null,
        artifact: status.artifact,
        deployed: status.deployed,
      };
    }),
  };
}

function translate(error: unknown): unknown {
  if (!(error instanceof HostedContentError)) return error;
  const map: Partial<Record<HostedContentError["code"], EditorialErrorCode>> = {
    "invalid-request": "invalid-request", "invalid-value": "invalid-value", forbidden: "forbidden", "not-found": "not-found",
    "revision-conflict": "revision-conflict", "baseline-conflict": "revision-conflict", "definition-conflict": "revision-conflict",
    "operation-key-reuse": "operation-key-reuse", "restore-incompatible": "restore-incompatible", "configuration-required": "configuration-required",
  };
  return new EditorialError(map[error.code] ?? "unavailable", error.message,
    (error.restoreDiagnostics ?? []).map((item) => ({ fieldId: item.fieldId, code: item.code, message: item.message })));
}
