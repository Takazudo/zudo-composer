import { isValueValidForField, traverseContentSchema, traverseContentValues, validateContentEntryRecord, validateContentModelRecord } from "../model";
import type { ContentEntryRef, ContentMediaUse, ContentModelRecord, ContentRecordRef } from "../model";
import { diagnoseContentEntryCompleteness } from "./helpers";
import { ContentPersistenceError } from "./types";
import type { ContentMutation, ContentSnapshot, ContentStore } from "./types";

export const contentRefKey = (ref: ContentRecordRef): string => JSON.stringify([ref.providerId, ref.recordId]);
export const contentEntryRefKey = (ref: ContentEntryRef): string => JSON.stringify([ref.providerId, ref.modelId, ref.recordId]);
export interface ContentGraphLocation { entry: ContentEntryRef; fieldId: string; path: readonly (string | number)[] }
export interface ContentRelationEdge { owner: ContentGraphLocation; target: ContentEntryRef; ordered: boolean }
export interface ContentGraphDiagnostic { code: "invalid-record" | "invalid-value" | "missing-model" | "missing-entry" | "missing-provider" | "single-cardinality" | "invalid-inverse" | "incomplete"; message: string; providerId: string; recordId: string; path?: readonly (string | number)[] }
export interface ContentGraphIndex {
  /** False means at least one provider/record could not be resolved. Destructive claims are unsafe. */
  complete: boolean;
  diagnostics: ContentGraphDiagnostic[];
  relations: ContentRelationEdge[];
  mediaUses: { location: ContentGraphLocation; use: ContentMediaUse }[];
  modelDependencies: { source: ContentRecordRef; target: ContentRecordRef; fieldId: string; path: readonly string[] }[];
  fieldDependencies: { source: ContentRecordRef; target: ContentRecordRef; fieldId: string; reason: string }[];
  incoming(ref: ContentEntryRef): readonly ContentRelationEdge[];
}

/** Every supplied provider snapshot must come from readAll, never a loaded UI page. */
export function buildContentGraphIndex(snapshots: readonly ContentSnapshot[]): ContentGraphIndex {
  const diagnostics: ContentGraphDiagnostic[] = [], relations: ContentRelationEdge[] = [];
  const mediaUses: ContentGraphIndex["mediaUses"] = [], modelDependencies: ContentGraphIndex["modelDependencies"] = [];
  const fieldDependencies: ContentGraphIndex["fieldDependencies"] = [];
  const providers = new Map<string, ContentSnapshot>();
  const modelsByRef = new Map<string, ContentModelRecord>(), entryRefs = new Set<string>();
  for (const snapshot of snapshots) {
    if (providers.has(snapshot.providerId)) diagnostics.push({ code: "invalid-record", providerId: snapshot.providerId, recordId: "", message: "Duplicate provider snapshot." });
    providers.set(snapshot.providerId, snapshot);
    for (const model of snapshot.models) modelsByRef.set(contentRefKey({ providerId: snapshot.providerId, recordId: model.id }), model);
    for (const entry of snapshot.entries) entryRefs.add(contentEntryRefKey({ providerId: snapshot.providerId, modelId: entry.modelId, recordId: entry.id }));
  }
  const modelFor = (ref: ContentRecordRef) => modelsByRef.get(contentRefKey(ref));
  for (const snapshot of snapshots) {
    const add = (code: ContentGraphDiagnostic["code"], recordId: string, message: string, path?: readonly (string | number)[]) => diagnostics.push({ code, recordId, providerId: snapshot.providerId, message, ...(path ? { path } : {}) });
    const ids = new Set<string>();
    const validModels = new Set<ContentModelRecord>();
    for (const model of snapshot.models) {
      if (ids.has(model.id) || !validateContentModelRecord(model).ok) { add("invalid-record", model.id, "Duplicate or malformed model."); continue; } ids.add(model.id);
      validModels.add(model);
      for (const { schema, field, path } of traverseContentSchema(model.document.fields)) {
        if (schema.kind !== "reference" && schema.kind !== "reference-list") continue;
        modelDependencies.push({ source: { providerId: snapshot.providerId, recordId: model.id }, target: schema.target, fieldId: field.id, path });
        if (!modelFor(schema.target)) add(providers.has(schema.target.providerId) ? "missing-model" : "missing-provider", model.id, "Reference schema target cannot be resolved.", path);
      }
      for (const inverse of model.document.presentation?.inverses ?? []) {
        fieldDependencies.push({ source: { providerId: snapshot.providerId, recordId: model.id }, target: inverse.source, fieldId: inverse.fieldId, reason: `Inverse ${inverse.id}` });
        if (!providers.has(inverse.source.providerId)) { add("missing-provider", model.id, `Inverse ${inverse.id} provider is unavailable.`); continue; }
        const sourceModel = modelFor(inverse.source);
        const field = sourceModel && validateContentModelRecord(sourceModel).ok ? sourceModel.document.fields.find((field) => field.id === inverse.fieldId) : undefined;
        if (!field || (field.kind !== "reference" && field.kind !== "reference-list") || field.target.providerId !== snapshot.providerId || field.target.recordId !== model.id) add("invalid-inverse", model.id, `Inverse ${inverse.id} must name an owning reference field targeting this model.`);
      }
      for (const item of [...(model.document.presentation?.groups ?? []), ...(model.document.presentation?.views ?? [])]) for (const fieldId of item.fieldIds) fieldDependencies.push({ source: { providerId: snapshot.providerId, recordId: model.id }, target: { providerId: snapshot.providerId, recordId: model.id }, fieldId, reason: `Presentation ${item.id}` });
    }
    const entryIds = new Set<string>(), counts = new Map<string, number>();
    for (const entry of snapshot.entries) {
      if (entryIds.has(entry.id) || !validateContentEntryRecord(entry).ok) { add("invalid-record", entry.id, "Duplicate or malformed entry."); continue; } entryIds.add(entry.id);
      const model = modelFor({ providerId: snapshot.providerId, recordId: entry.modelId });
      if (!model) { add("missing-model", entry.id, "Entry model cannot be resolved."); continue; }
      if (!validModels.has(model)) continue;
      const count = (counts.get(model.id) ?? 0) + 1; counts.set(model.id, count);
      if (model.document.kind === "single" && count > 1) add("single-cardinality", entry.id, "Single model permits at most one entry.");
      for (const [id, value] of Object.entries(entry.values)) {
        const field = model.document.fields.find((field) => field.id === id);
        if (!field || !isValueValidForField(field, value)) add("invalid-value", entry.id, "Value does not match its field schema.", [id]);
      }
      for (const issue of diagnoseContentEntryCompleteness(model, entry)) add("incomplete", entry.id, issue.message, issue.path);
      for (const { schema, field, path, value } of traverseContentValues(model, entry)) {
        if (!isValueValidForField(schema, value)) continue;
        const location = { entry: { providerId: snapshot.providerId, modelId: entry.modelId, recordId: entry.id }, fieldId: field.id, path };
        if (schema.kind === "media-use") mediaUses.push({ location, use: value as unknown as ContentMediaUse });
        if (schema.kind !== "reference" && schema.kind !== "reference-list") continue;
        const targets = (schema.kind === "reference" ? [value] : value) as unknown as ContentEntryRef[];
        targets.forEach((target, index) => {
          relations.push({ owner: { ...location, path: schema.kind === "reference-list" ? [...path, index] : path }, target, ordered: schema.kind === "reference-list" && schema.ordered });
          const provider = providers.get(target.providerId);
          if (!provider) add("missing-provider", entry.id, "Reference target provider is unavailable.", path);
          else if (!entryRefs.has(contentEntryRefKey(target))) add("missing-entry", entry.id, "Reference target entry is missing or has the wrong model.", path);
        });
      }
    }
  }
  return { complete: diagnostics.every((issue) => issue.code === "incomplete"), diagnostics, relations, mediaUses, modelDependencies, fieldDependencies, incoming: (ref) => relations.filter((edge) => contentEntryRefKey(edge.target) === contentEntryRefKey(ref)) };
}

export type ContentDeletionTarget = { kind: "entry"; ref: ContentEntryRef } | { kind: "model"; ref: ContentRecordRef } | { kind: "field"; ref: ContentRecordRef; fieldId: string };
/** Read-only explanation for callers. The owning store MUST repeat guards in its transaction. */
export function getContentDeletionBlockers(index: ContentGraphIndex, target: ContentDeletionTarget): { code: "unknown" | "incoming-reference" | "schema-dependency"; message: string }[] {
  if (!index.complete) return [{ code: "unknown", message: "The full Content graph could not be resolved; absence of references is unknown." }];
  if (target.kind === "entry") return index.incoming(target.ref).filter((edge) => contentEntryRefKey(edge.owner.entry) !== contentEntryRefKey(target.ref)).map((edge) => ({ code: "incoming-reference", message: `${edge.owner.entry.providerId}/${edge.owner.entry.recordId} references this entry.` }));
  const key = contentRefKey(target.ref);
  const dependencies = index.fieldDependencies.filter((dependency) => contentRefKey(dependency.target) === key && (target.kind === "field" ? dependency.fieldId === target.fieldId : contentRefKey(dependency.source) !== key));
  return [
    ...dependencies.map((dependency) => ({ code: "schema-dependency" as const, message: `${dependency.reason} in ${dependency.source.providerId}/${dependency.source.recordId} depends on this ${target.kind}.` })),
    ...(target.kind === "model" ? index.modelDependencies.filter((dependency) => contentRefKey(dependency.target) === key && contentRefKey(dependency.source) !== key).map((dependency) => ({ code: "schema-dependency" as const, message: `${dependency.source.providerId}/${dependency.source.recordId}/${dependency.fieldId} targets this model.` })) : []),
  ];
}

export type ContentGraphReadOutcome =
  | { status: "ready"; snapshots: readonly ContentSnapshot[]; index: ContentGraphIndex }
  | { status: "unavailable" | "changed"; providerIds: readonly string[]; message: string };

/** Captures full snapshots then verifies durable tokens, without relying on notifications. */
export async function readContentGraph(stores: readonly Pick<ContentStore, "provider" | "readAll">[]): Promise<ContentGraphReadOutcome> {
  if (new Set(stores.map((store) => store.provider.id)).size !== stores.length) throw new TypeError("Duplicate Content provider.");
  const reads = await Promise.allSettled(stores.map((store) => store.readAll()));
  const unavailable = reads.flatMap((read, index) => read.status === "rejected" ? [stores[index]!.provider.id] : []);
  if (unavailable.length) return { status: "unavailable", providerIds: unavailable, message: "Content graph is incomplete because a provider could not be read." };
  const snapshots = reads.map((read) => (read as PromiseFulfilledResult<ContentSnapshot>).value);
  const verified = await Promise.allSettled(stores.map((store) => store.readAll()));
  const failures = verified.flatMap((read, index) => read.status === "rejected" ? [stores[index]!.provider.id] : []);
  if (failures.length) return { status: "unavailable", providerIds: failures, message: "Content graph tokens could not be verified." };
  const changed = verified.flatMap((read, index) => read.status === "fulfilled" && (read.value.providerId !== stores[index]!.provider.id || snapshots[index]!.providerId !== stores[index]!.provider.id || read.value.mutationToken !== snapshots[index]!.mutationToken) ? [stores[index]!.provider.id] : []);
  if (changed.length) return { status: "changed", providerIds: changed, message: "Content changed during graph capture; retry the complete scan." };
  return { status: "ready", snapshots, index: buildContentGraphIndex(snapshots) };
}

export interface ContentInverseEdit { owner: ContentEntryRef; fieldId: string; targets: readonly ContentEntryRef[] }
/** Inverse UI supplies the final owning values. All owners must share one atomic store. */
export function planContentInverseMutation(snapshots: readonly ContentSnapshot[], edits: readonly ContentInverseEdit[]): { providerId: string; mutation: ContentMutation } {
  const ownerProviders = new Set(edits.map((edit) => edit.owner.providerId));
  if (ownerProviders.size !== 1) throw new ContentPersistenceError("transact", "unsupported-transaction", "Inverse edits require exactly one owning provider transaction.", false);
  const providerId = edits[0]!.owner.providerId, snapshot = snapshots.find((snapshot) => snapshot.providerId === providerId);
  if (!snapshot || !buildContentGraphIndex(snapshots).complete) throw new ContentPersistenceError("transact", "validation", "A complete valid provider graph is required for inverse edits.", false);
  const entries = new Map<string, (typeof snapshot.entries)[number]>();
  for (const edit of edits) {
    const stored = entries.get(edit.owner.recordId) ?? snapshot.entries.find((entry) => entry.id === edit.owner.recordId && entry.modelId === edit.owner.modelId);
    const field = snapshot.models.find((model) => model.id === edit.owner.modelId)?.document.fields.find((field) => field.id === edit.fieldId);
    if (!stored || stored.modelId !== edit.owner.modelId || !field || (field.kind !== "reference" && field.kind !== "reference-list") || (field.kind === "reference" && edit.targets.length > 1)) throw new ContentPersistenceError("transact", "validation", "Inverse edit must address a top-level owning reference field.", false);
    const values = structuredClone(stored.values);
    if (field.kind === "reference" && edit.targets.length === 0) delete values[field.id];
    else values[field.id] = structuredClone(field.kind === "reference" ? edit.targets[0]! : [...edit.targets]) as unknown as (typeof values)[string];
    entries.set(stored.id, { ...stored, values });
  }
  const next = { ...snapshot, entries: snapshot.entries.map((entry) => entries.get(entry.id) ?? entry) };
  if (!buildContentGraphIndex(snapshots.map((snapshot) => snapshot.providerId === providerId ? next : snapshot)).complete) throw new ContentPersistenceError("transact", "validation", "Inverse edit would invalidate the relation graph.", false);
  return { providerId, mutation: { expectedMutationToken: snapshot.mutationToken, operations: [...entries.values()].map((record) => ({ kind: "put-entry", record })) } };
}

export async function applyContentInverseMutation(store: ContentStore, snapshots: readonly ContentSnapshot[], edits: readonly ContentInverseEdit[]): Promise<ContentSnapshot> {
  const plan = planContentInverseMutation(snapshots, edits);
  if (store.provider.id !== plan.providerId || store.transactionScope !== "provider" || typeof store.transact !== "function") throw new ContentPersistenceError("transact", "unsupported-transaction", "Owning provider does not support this atomic transaction.", false);
  return store.transact(plan.mutation);
}
