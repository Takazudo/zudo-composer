import { buildContentGraphIndex, contentEntryRefKey } from "../content/library/graph";
import { createContentEntryRecord, diagnoseContentEntryCompleteness } from "../content/library/helpers";
import type { ContentCompletenessDiagnostic } from "../content/model/types";
import { canonicalSerialize } from "./canonical";
import { isValueValidForField } from "../content/model/validate";
import { assertFieldChange, assertSafeUrl, parseHostedCommand, parseHostedQuery, sameValue } from "./validation";
import { HostedContentError } from "./types";
import type {
  ContentEntryRecord, ContentEntryRef, HostedActor, HostedAdoptionResult, HostedCollectionPermission, HostedCommand,
  HostedCommit, HostedEditorialStatus, HostedEntryView, HostedValuesIdentity, HostedFieldDifference, HostedHead, HostedIdentities, HostedModelPermission, HostedPerspective, HostedProvider, HostedPublication,
  HostedPublicationStage, HostedRebaseChange, HostedRebaseDropReason, HostedReceipt, HostedRestoreDiagnostic, HostedResult, HostedRevision, HostedRevisionOperation, HostedRevisionTarget,
  HostedService, HostedServiceOptions, HostedSnapshot, HostedState, JsonValue,
} from "./types";

const copy = <T>(value: T): T => structuredClone(value);
function fail(code: ConstructorParameters<typeof HostedContentError>[0], message: string): never { throw new HostedContentError(code, message); }
const identity = (state: HostedIdentities): HostedIdentities => ({ draftRevision: state.draftRevision, baseline: copy(state.baseline), definition: state.definition });
const terminal = (publication: HostedPublication): boolean => ["integrated", "deployed", "failed", "conflict"].includes(publication.status);
const rank: Partial<Record<HostedPublicationStage, number>> = { submitted: 0, building: 1, verified: 2, integrated: 3, deployed: 4 };
const commitAttempts = 16;
const defaultPageSize = 50;
const ref = (providerId: string, entry: ContentEntryRecord): ContentEntryRef => ({ providerId, modelId: entry.modelId, recordId: entry.id });
function lookup(providers: HostedProvider[], target: ContentEntryRef): ContentEntryRecord | undefined {
  return providers.find(provider => provider.providerId === target.providerId)?.entries.find(entry => entry.id === target.recordId && entry.modelId === target.modelId);
}
/** Entries whose values differ, including created ones; lifecycle-only changes are not content changes. */
function changedEntries(before: HostedProvider[], after: HostedProvider[]): { entry: ContentEntryRef; previous?: ContentEntryRecord; next: ContentEntryRecord }[] {
  return after.flatMap(provider => provider.entries.flatMap(next => {
    const entry = ref(provider.providerId, next), previous = lookup(before, entry);
    return previous && sameValue(previous.values, next.values) ? [] : [{ entry, previous, next }];
  }));
}
function editorialStatus(head: HostedHead, target: ContentEntryRef): HostedEditorialStatus {
  const published = lookup(head.baselineProviders, target), working = lookup(head.state.providers, target);
  if (!published) return "new";
  return working && !sameValue(working.values, published.values) ? "changed" : "published";
}
function parseCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return undefined;
  if (!/^[1-9]\d{0,15}$/.test(cursor)) fail("invalid-request", "Malformed cursor.");
  return Number(cursor);
}

/** Trusted, site-bound service. Host callbacks are privileged; never expose them as client verbs. */
export function createHostedContentService(supplied: HostedServiceOptions): HostedService {
  // Capture policy configuration so a caller cannot change authorization during an awaited transaction.
  const options = { ...supplied, policy: copy(supplied.policy) };
  for (const asset of options.policy.assets) {
    assertSafeUrl(asset.url);
    if (!asset.versionId || !asset.checksum) fail("configuration-required", "Approved assets require exact versions and checksums.");
  }
  const authorize = async (actor: HostedActor): Promise<void> => {
    if (!actor || typeof actor.id !== "string" || !actor.id.trim()) fail("forbidden", "An authenticated actor is required.");
    await options.authorize(copy(actor));
  };
  function findEntry(providers: HostedProvider[], ref: ContentEntryRef): ContentEntryRecord {
    return providers.find(provider => provider.providerId === ref.providerId)?.entries.find(entry => entry.id === ref.recordId && entry.modelId === ref.modelId) ?? fail("not-found", "Entry is unavailable.");
  }
  function modelPermission(ref: Pick<ContentEntryRef, "providerId" | "modelId">): HostedModelPermission {
    return options.policy.models.find(model => model.providerId === ref.providerId && model.modelId === ref.modelId) ?? fail("forbidden", "Model is outside the hosted policy.");
  }
  function membership(providers: HostedProvider[], collection: HostedCollectionPermission): ContentEntryRef[] {
    const owner = findEntry(providers, collection.owner);
    const field = providers.find(provider => provider.providerId === collection.owner.providerId)?.models.find(model => model.id === owner.modelId)?.document.fields.find(field => field.id === collection.fieldId);
    if (!field || field.kind !== "reference-list" || !field.ordered || field.target.providerId !== collection.target.providerId || field.target.recordId !== collection.target.modelId) fail("configuration-required", "Collection must name a Content-owned ordered reference list.");
    const value = owner.values[collection.fieldId];
    if (value === undefined) return [];
    if (!Array.isArray(value)) fail("invalid-value", "Collection membership is malformed.");
    return value as unknown as ContentEntryRef[];
  }
  function ownerExists(providers: HostedProvider[], collection: HostedCollectionPermission): boolean {
    return !!providers.find(provider => provider.providerId === collection.owner.providerId)?.entries.some(entry => entry.id === collection.owner.recordId && entry.modelId === collection.owner.modelId);
  }
  function permitted(providers: HostedProvider[], ref: ContentEntryRef): boolean {
    const model = options.policy.models.find(item => item.providerId === ref.providerId && item.modelId === ref.modelId);
    if (!model) return false;
    // An absent owner Entry grants no membership; it must not lock every actor out.
    return model.entryIds.includes(ref.recordId) || options.policy.collections.some(collection => collection.target.providerId === ref.providerId && collection.target.modelId === ref.modelId && ownerExists(providers, collection) && membership(providers, collection).some(item => contentEntryRefKey(item) === contentEntryRefKey(ref)));
  }
  function visible(providers: HostedProvider[], ref: ContentEntryRef): boolean {
    return permitted(providers, ref) || options.policy.collections.some(collection => contentEntryRefKey(collection.owner) === contentEntryRefKey(ref));
  }
  function publicProviders(providers: HostedProvider[]): HostedProvider[] {
    return copy(providers.map(provider => ({ ...provider,
      models: provider.models.filter(model => options.policy.models.some(permission => permission.providerId === provider.providerId && permission.modelId === model.id) || options.policy.collections.some(collection => collection.owner.providerId === provider.providerId && collection.owner.modelId === model.id)),
      entries: provider.entries.filter(entry => visible(providers, { providerId: provider.providerId, modelId: entry.modelId, recordId: entry.id })),
    })).filter(provider => provider.models.length || provider.entries.length));
  }
  function publicState(state: HostedState): HostedState {
    return copy({ ...state, providers: publicProviders(state.providers) });
  }
  /** Browser read projection only. The digest still binds the complete immutable stored candidate,
   * including protected baseline records; it is not a hash of these scoped providers. The trusted
   * host's approved renderData is shared unchanged with preview and delivery. */
  function publicSnapshot(snapshot: HostedSnapshot): HostedSnapshot {
    const providers = publicProviders(snapshot.providers);
    // Completeness diagnostics lack provider IDs; recomputing avoids collisions with a hidden provider.
    const diagnostics = providers.flatMap(provider => provider.entries.flatMap(entry => diagnoseContentEntryCompleteness(provider.models.find(model => model.id === entry.modelId)!, entry)));
    return copy({ ...snapshot, providers, diagnostics });
  }
  function checkExpected(state: HostedState, expected: HostedIdentities): void {
    // Stored content written under another definition needs the host to adopt the canonical baseline first.
    if (state.definition !== options.definition) fail("configuration-required", "The hosted definition changed; the host must adopt the canonical baseline before edits continue.");
    if (expected.definition !== state.definition) fail("definition-conflict", "Hosted definition changed; reload and review the retained draft.");
    if (!sameValue(expected.baseline, state.baseline)) fail("baseline-conflict", "Canonical baseline changed; reload and review the retained draft.");
    if (expected.draftRevision !== state.draftRevision) fail("revision-conflict", "The draft changed; reload and review before reapplying.");
  }
  function checkGraph(providers: HostedProvider[]): ContentCompletenessDiagnostic[] {
    const graph = buildContentGraphIndex(providers.map(provider => ({ ...provider, mutationToken: 0 })));
    if (!graph.complete) fail("invalid-value", graph.diagnostics.filter(issue => issue.code !== "incomplete").map(issue => `${issue.recordId}: ${issue.message}`).join(" "));
    for (const { use } of graph.assetUses) if (!options.policy.assets.some(asset => asset.providerId === use.asset.providerId && asset.assetId === use.asset.assetId)) fail("forbidden", "Content references an unapproved asset.");
    for (const collection of options.policy.collections) {
      const entries = membership(providers, collection);
      if (entries.length > collection.maxItems || new Set(entries.map(contentEntryRefKey)).size !== entries.length) fail("invalid-value", "Collection cardinality or membership is invalid.");
    }
    return providers.flatMap(provider => provider.entries.flatMap(entry => diagnoseContentEntryCompleteness(provider.models.find(model => model.id === entry.modelId)!, entry)));
  }
  function setFields(providers: HostedProvider[], ref: ContentEntryRef, values: Record<string, JsonValue>, clear: string[], creating = false): void {
    const permission = modelPermission(ref);
    if (!creating && !permitted(providers, ref)) fail("forbidden", "Entry is outside the hosted policy.");
    const entry = findEntry(providers, ref), model = providers.find(provider => provider.providerId === ref.providerId)!.models.find(model => model.id === ref.modelId);
    if (!model) fail("not-found", "Entry model is unavailable.");
    for (const fieldId of [...Object.keys(values), ...clear]) {
      const field = model.document.fields.find(item => item.id === fieldId);
      if (!field) fail("forbidden", `Unknown field ${fieldId}.`);
      // Collection ownership has one dedicated operation, never an alternate set-fields path.
      if (options.policy.collections.some(collection => contentEntryRefKey(collection.owner) === contentEntryRefKey(ref) && collection.fieldId === fieldId)) fail("forbidden", "Use the declared collection operation to change ordering.");
      const next = Object.hasOwn(values, fieldId) ? values[fieldId] : undefined;
      const fieldPermission = permission.fields.find(item => item.fieldId === fieldId) ?? fail("forbidden", `Field ${fieldId} is outside the hosted policy.`);
      assertFieldChange(field, fieldPermission, entry.values[fieldId], next, options.policy, fieldId, options.validateMarkdown);
      if (next === undefined) delete entry.values[fieldId]; else entry.values[fieldId] = copy(next);
    }
    entry.generation += 1;
    entry.updatedAt = options.now();
  }
  function changeCollection(providers: HostedProvider[], command: Extract<HostedCommand, { kind: "create-entry" | "add-entry" | "reorder" }>): ContentEntryRef | undefined {
    const collection = options.policy.collections.find(item => item.id === command.collectionId) ?? fail("forbidden", "Collection is outside the hosted policy.");
    const refs = copy(membership(providers, collection));
    let created: ContentEntryRef | undefined;
    if (command.kind === "reorder") {
      if (!collection.reorder) fail("forbidden", "Collection does not permit reorder.");
      const before = refs.map(contentEntryRefKey).sort(), after = command.entries.map(contentEntryRefKey).sort();
      if (!sameValue(before, after) || new Set(after).size !== after.length) fail("invalid-value", "Reorder must preserve exact collection membership.");
      refs.splice(0, refs.length, ...copy(command.entries));
    } else {
      if (command.kind === "create-entry" ? !collection.create : !collection.add) fail("forbidden", "Collection does not permit this operation.");
      if (refs.length >= collection.maxItems) fail("invalid-value", "Collection has reached its limit.");
      let ref: ContentEntryRef;
      if (command.kind === "create-entry") {
        const provider = providers.find(item => item.providerId === collection.target.providerId) ?? fail("not-found", "Collection provider is unavailable.");
        const model = provider.models.find(item => item.id === collection.target.modelId);
        if (!model || model.document.kind !== "collection") fail("configuration-required", "Creation requires a collection Content model.");
        const id = options.createId();
        if (provider.entries.some(entry => entry.id === id)) fail("configuration-required", "Host ID factory returned an existing entry identity.");
        ref = { ...collection.target, recordId: id };
        provider.entries.push(createContentEntryRecord(ref.modelId, collection.initialValues, { id, timestamp: options.now() }));
        setFields(providers, ref, command.values, [], true);
        created = ref;
      } else {
        ref = command.entry;
        if (ref.providerId !== collection.target.providerId || ref.modelId !== collection.target.modelId || !permitted(providers, ref)) fail("forbidden", "Entry is outside the permitted collection target.");
        findEntry(providers, ref);
      }
      if (refs.some(item => contentEntryRefKey(item) === contentEntryRefKey(ref))) fail("invalid-value", "Entry is already a collection member.");
      const index = command.before === null ? refs.length : refs.findIndex(item => contentEntryRefKey(item) === contentEntryRefKey(command.before!));
      if (index < 0) fail("invalid-value", "Placement must name an existing collection member.");
      refs.splice(index, 0, copy(ref));
    }
    const owner = findEntry(providers, collection.owner);
    owner.values[collection.fieldId] = refs as unknown as JsonValue;
    owner.generation += 1;
    owner.updatedAt = options.now();
    return created;
  }
  function assertDefinitions(head: HostedHead): void {
    if (head.state.providers.length !== head.baselineProviders.length) fail("configuration-required", "Working providers differ from the canonical baseline.");
    for (const provider of head.state.providers) {
      const baseline = head.baselineProviders.find(item => item.providerId === provider.providerId);
      if (!baseline || !sameValue(provider.models, baseline.models)) fail("configuration-required", "Working model definitions differ from the canonical baseline.");
    }
  }
  function deliveryProviders(head: HostedHead): HostedProvider[] {
    const providers = copy(head.baselineProviders);
    // Definitions and protected records come from the canonical baseline, never request data.
    for (const current of head.state.providers) {
      const baseline = providers.find(provider => provider.providerId === current.providerId);
      if (!baseline || !sameValue(baseline.models, current.models)) fail("configuration-required", "Working model definitions differ from the canonical baseline.");
      for (const entry of current.entries) {
        const ref = { providerId: current.providerId, modelId: entry.modelId, recordId: entry.id };
        if (!visible(head.state.providers, ref)) continue;
        const delivered = { ...copy(entry), lifecycle: "published" as const };
        const index = baseline.entries.findIndex(item => item.id === entry.id);
        if (index < 0) baseline.entries.push(delivered); else baseline.entries[index] = delivered;
      }
    }
    return providers;
  }
  function receipt(existing: HostedReceipt | null, fingerprint: string): HostedResult | undefined {
    if (!existing) return;
    if (existing.fingerprint !== fingerprint) fail("operation-key-reuse", "Operation key is already bound to another immutable request.");
    // Results were scoped before their atomic receipt commit. Recovery must preserve those exact
    // acknowledged bytes even when a later definition or policy cannot validate a fresh mutation.
    return copy(existing.result);
  }
  /** Working fields that differ from the stored canonical baseline, i.e. the retained draft. */
  function authoredChanges(head: HostedHead) {
    return head.state.providers.flatMap(working => working.entries.flatMap(entry => {
      const ref = { providerId: working.providerId, modelId: entry.modelId, recordId: entry.id };
      const base = head.baselineProviders.find(provider => provider.providerId === ref.providerId)?.entries.find(item => item.id === entry.id && item.modelId === entry.modelId);
      const fieldIds = [...new Set([...Object.keys(entry.values), ...Object.keys(base?.values ?? {})])].filter(fieldId => !sameValue(entry.values[fieldId], base?.values[fieldId]));
      return fieldIds.length ? [{ ref, entry, base, fieldIds }] : [];
    }));
  }
  /** Carry each retained change onto new canonical content only where it still validates; report every drop. */
  function rebaseDraft(head: HostedHead, canonical: HostedProvider[]): { providers: HostedProvider[]; carried: HostedRebaseChange[]; dropped: HostedAdoptionResult["dropped"] } {
    const providers = copy(canonical), carried: HostedRebaseChange[] = [], dropped: HostedAdoptionResult["dropped"] = [], createdRefs: ContentEntryRef[] = [];
    for (const { ref, entry, base, fieldIds } of authoredChanges(head)) {
      const drop = (reason: HostedRebaseDropReason, ids = fieldIds) => { for (const fieldId of ids) dropped.push({ entry: ref, fieldId, reason }); };
      const provider = providers.find(item => item.providerId === ref.providerId);
      const model = provider?.models.find(item => item.id === ref.modelId);
      let target = provider?.entries.find(item => item.id === entry.id && item.modelId === entry.modelId);
      if (!provider || !model) { drop("model-removed"); continue; }
      if (base && !target) { drop("entry-removed"); continue; }
      // A draft-created Entry can only be carried into a still-permitted collection target.
      if (!base && !target && !options.policy.collections.some(collection => collection.target.providerId === ref.providerId && collection.target.modelId === ref.modelId)) { drop("forbidden"); continue; }
      const created = !target;
      target ??= { ...copy(entry), values: {} };
      let applied = false;
      for (const fieldId of fieldIds) {
        const field = model.document.fields.find(item => item.id === fieldId), next = entry.values[fieldId];
        const owned = options.policy.collections.some(collection => contentEntryRefKey(collection.owner) === contentEntryRefKey(ref) && collection.fieldId === fieldId);
        if (!field) drop("field-removed", [fieldId]);
        // Never overwrite a value canonical Git changed too; an Entry canonical already holds keeps its value.
        else if (base ? !sameValue(target.values[fieldId], base.values[fieldId]) : !created && !sameValue(target.values[fieldId], next)) drop("canonical-changed", [fieldId]);
        else if (!owned && !options.policy.models.some(allowed => allowed.providerId === ref.providerId && allowed.modelId === ref.modelId && allowed.fields.some(permission => permission.fieldId === fieldId))) drop("forbidden", [fieldId]);
        else if (next !== undefined && !isValueValidForField(field, next)) drop("invalid-value", [fieldId]);
        else {
          if (next === undefined) delete target.values[fieldId]; else target.values[fieldId] = copy(next);
          carried.push({ entry: ref, fieldId }); applied = true;
        }
      }
      if (!applied) continue;
      if (created) { provider.entries.push(target); createdRefs.push(ref); }
      target.generation = Math.max(target.generation, entry.generation) + 1;
      target.updatedAt = options.now();
    }
    // A created Entry whose owner membership change was dropped would be an unlisted orphan.
    for (const ref of createdRefs) {
      if (permitted(providers, ref)) continue;
      const provider = providers.find(item => item.providerId === ref.providerId)!;
      provider.entries = provider.entries.filter(entry => !(entry.id === ref.recordId && entry.modelId === ref.modelId));
      const orphaned = carried.filter(change => contentEntryRefKey(change.entry) === contentEntryRefKey(ref));
      carried.splice(0, carried.length, ...carried.filter(change => !orphaned.includes(change)));
      dropped.push(...orphaned.map(change => ({ ...change, reason: "canonical-changed" as const })));
    }
    return { providers, carried, dropped };
  }
  /**
   * The revisions one commit appends: an `initial` revision of the prior values when an Entry has no history yet,
   * then one revision per changed Entry. The head CAS and the (entry, sequence) uniqueness both refuse a racing append.
   */
  async function revisionsFor(head: HostedHead, after: HostedProvider[], definition: string, actor: HostedActor | null, operation: { kind: HostedRevisionOperation; key: string | null }, restoredFrom?: string): Promise<HostedRevision[]> {
    const revisions: HostedRevision[] = [], source = options.source ?? "hosted-content", createdAt = options.now();
    for (const { entry, previous, next } of changedEntries(head.state.providers, after)) {
      let parent: HostedRevision | null = (await options.storage.listRevisions(entry, { limit: 1 }))[0] ?? null;
      if (!parent && previous) {
        parent = { id: options.createId(), entry: copy(entry), sequence: 1, parentId: null, values: copy(previous.values), definition: head.state.definition, createdAt, actor: null, source, operation: { kind: "initial", key: null } };
        revisions.push(parent);
      }
      revisions.push({ id: options.createId(), entry: copy(entry), sequence: (parent?.sequence ?? 0) + 1, parentId: parent?.id ?? null, values: copy(next.values), definition, createdAt,
        actor: actor ? { id: actor.id } : null, source, operation, ...(restoredFrom ? { restoredFrom } : {}) });
    }
    for (const revision of revisions) if (await options.storage.readRevision(revision.id)) fail("configuration-required", "Host ID factory returned an existing revision identity.");
    return revisions;
  }
  /** Apply a revision's values as ordinary validated field changes, or refuse with every incompatibility. */
  function restoreValues(providers: HostedProvider[], target: ContentEntryRef, values: Record<string, JsonValue>): void {
    if (!permitted(providers, target)) fail("forbidden", "Entry is outside the hosted policy.");
    const permission = modelPermission(target), entry = findEntry(providers, target);
    const model = providers.find(provider => provider.providerId === target.providerId)?.models.find(item => item.id === target.modelId) ?? fail("not-found", "Entry model is unavailable.");
    const diagnostics: HostedRestoreDiagnostic[] = [], set: Record<string, JsonValue> = {}, clear: string[] = [];
    const diagnose = (fieldId: string, code: HostedRestoreDiagnostic["code"], message: string) => diagnostics.push({ entry: copy(target), fieldId, code, message });
    for (const fieldId of [...new Set([...Object.keys(entry.values), ...Object.keys(values)])].sort()) {
      const previous = entry.values[fieldId], next = Object.hasOwn(values, fieldId) ? values[fieldId] : undefined;
      if (sameValue(previous, next)) continue;
      const field = model.document.fields.find(item => item.id === fieldId);
      if (!field) { diagnose(fieldId, "field-removed", "The current definition no longer has this field."); continue; }
      if (options.policy.collections.some(collection => contentEntryRefKey(collection.owner) === contentEntryRefKey(target) && collection.fieldId === fieldId)) { diagnose(fieldId, "collection-owned", "Collection membership changes only through its collection operation."); continue; }
      try { assertFieldChange(field, permission.fields.find(item => item.fieldId === fieldId), previous, next, options.policy, fieldId, options.validateMarkdown); }
      catch (error) {
        if (!(error instanceof HostedContentError)) throw error;
        diagnose(fieldId, error.code === "forbidden" ? "forbidden" : "invalid-value", error.message);
        continue;
      }
      if (next === undefined) clear.push(fieldId); else set[fieldId] = next;
    }
    if (diagnostics.length) throw new HostedContentError("restore-incompatible", "The revision cannot be restored under the current definition and policy; nothing was written.", undefined, diagnostics);
    if (Object.keys(set).length || clear.length) setFields(providers, target, set, clear);
  }
  function entryView(head: HostedHead, perspective: HostedPerspective, entry: ContentEntryRecord, target: ContentEntryRef, workingRevisionId: string | null): HostedEntryView {
    const valuesIdentity: HostedValuesIdentity = perspective === "working"
      ? { perspective, draftRevision: head.state.draftRevision, revisionId: workingRevisionId }
      : { perspective, baseline: head.state.baseline, integrationFence: head.state.integrationFence };
    return copy({ entry: target, perspective, status: editorialStatus(head, target), lifecycle: entry.lifecycle, generation: entry.generation, updatedAt: entry.updatedAt, values: entry.values, workingRevisionId, valuesIdentity, expected: identity(head.state) });
  }
  const perspectiveProviders = (head: HostedHead, perspective: HostedPerspective): HostedProvider[] => perspective === "working" ? head.state.providers : head.baselineProviders;
  /** Current read permissions apply to every perspective and to historical data. */
  function assertReadable(head: HostedHead, target: ContentEntryRef): void {
    if (!visible(head.state.providers, target)) fail("forbidden", "Entry is outside the hosted policy.");
  }
  async function readRevisionFor(target: ContentEntryRef, revisionId: string): Promise<HostedRevision> {
    const revision = await options.storage.readRevision(revisionId);
    if (!revision || contentEntryRefKey(revision.entry) !== contentEntryRefKey(target)) fail("not-found", "Revision is unavailable.");
    return revision;
  }
  async function targetValues(head: HostedHead, target: ContentEntryRef, at: HostedRevisionTarget): Promise<Record<string, JsonValue>> {
    if ("revisionId" in at) return (await readRevisionFor(target, at.revisionId)).values;
    // An Entry absent from a perspective compares as empty, so every value shows as added or removed.
    return lookup(perspectiveProviders(head, at.perspective), target)?.values ?? {};
  }
  /** Field-level differences in definition order, then fields the current definition no longer has. */
  function differencesFor(providers: HostedProvider[], target: ContentEntryRef, before: Record<string, JsonValue>, after: Record<string, JsonValue>): HostedFieldDifference[] {
    const fields = providers.find(provider => provider.providerId === target.providerId)?.models.find(model => model.id === target.modelId)?.document.fields ?? [];
    const known = new Set(fields.map(field => field.id));
    const removed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(fieldId => !known.has(fieldId)).sort();
    return [...fields.map(field => ({ fieldId: field.id, key: field.key, label: field.label, removedFromDefinition: false })),
      ...removed.map(fieldId => ({ fieldId, key: fieldId, label: fieldId, removedFromDefinition: true }))].flatMap(field => {
      const previous = before[field.fieldId], next = after[field.fieldId];
      if (sameValue(previous, next)) return [];
      return [{ ...field, change: previous === undefined ? "added" as const : next === undefined ? "removed" as const : "changed" as const,
        ...(previous !== undefined ? { before: previous } : {}), ...(next !== undefined ? { after: next } : {}) }];
    });
  }
  /** Prepare from detached reads, then commit conditionally; a refused commit is retried from fresh reads. */
  async function mutate<T>(work: (head: HostedHead) => Promise<{ value: T; write?: Omit<HostedCommit, "expectedVersion"> }>): Promise<T> {
    for (let attempt = 0; attempt < commitAttempts; attempt++) {
      const head = copy(await options.storage.readHead());
      const { value, write } = await work(copy(head));
      if (!write) return copy(value);
      if (await options.storage.commit(copy({ ...write, expectedVersion: head.version, head: { ...write.head, version: options.createId() } }))) return copy(value);
    }
    return fail("unavailable", "Storage kept refusing the commit; nothing was written. Retry the same request.");
  }
  async function readSnapshot(snapshotId: string): Promise<HostedSnapshot> {
    return await options.storage.readSnapshot(snapshotId) ?? fail("not-found", "Snapshot is unavailable.");
  }
  async function readPublication(publicationId: string): Promise<HostedPublication> {
    return await options.storage.readPublication(publicationId) ?? fail("not-found", "Publication is unavailable.");
  }
  const service: HostedService = {
    async readState(actor) { await authorize(actor); return publicState((await options.storage.readHead()).state); },
    async listModels(actor) {
      await authorize(actor);
      const head = await options.storage.readHead();
      const working = publicProviders(head.state.providers);
      return copy(working.flatMap(provider => provider.models.map(model => ({ providerId: provider.providerId, model,
        workingEntries: provider.entries.filter(entry => entry.modelId === model.id).length,
        publishedEntries: head.baselineProviders.find(item => item.providerId === provider.providerId)?.entries.filter(entry => entry.modelId === model.id && visible(head.state.providers, ref(provider.providerId, entry))).length ?? 0 }))));
    },
    async listEntries(actor, request) {
      const query = parseHostedQuery("entries", request);
      await authorize(actor);
      const head = await options.storage.readHead(), limit = query.limit ?? defaultPageSize;
      const entries = (perspectiveProviders(head, query.perspective).find(provider => provider.providerId === query.providerId)?.entries ?? [])
        .filter(entry => entry.modelId === query.modelId && visible(head.state.providers, ref(query.providerId, entry)) && (query.cursor === undefined || entry.id > query.cursor))
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      const page = entries.slice(0, limit);
      const views = await Promise.all(page.map(async entry => entryView(head, query.perspective, entry, ref(query.providerId, entry),
        (await options.storage.listRevisions(ref(query.providerId, entry), { limit: 1 }))[0]?.id ?? null)));
      return { entries: views, nextCursor: entries.length > limit ? page.at(-1)!.id : null };
    },
    async readEntry(actor, request) {
      const query = parseHostedQuery("entry", request);
      await authorize(actor);
      const head = await options.storage.readHead();
      assertReadable(head, query.entry);
      const entry = lookup(perspectiveProviders(head, query.perspective), query.entry) ?? fail("not-found", `Entry has no ${query.perspective} version.`);
      return entryView(head, query.perspective, entry, query.entry, (await options.storage.listRevisions(query.entry, { limit: 1 }))[0]?.id ?? null);
    },
    async listRevisions(actor, request) {
      const query = parseHostedQuery("revisions", request);
      await authorize(actor);
      assertReadable(await options.storage.readHead(), query.entry);
      const limit = query.limit ?? defaultPageSize, beforeSequence = parseCursor(query.cursor);
      const revisions = await options.storage.listRevisions(query.entry, { ...(beforeSequence ? { beforeSequence } : {}), limit: limit + 1 });
      const page = revisions.slice(0, limit);
      return copy({ revisions: page, nextCursor: revisions.length > limit ? String(page.at(-1)!.sequence) : null });
    },
    async readRevision(actor, request) {
      const revisionId = parseHostedQuery("revision", request);
      await authorize(actor);
      const head = await options.storage.readHead(), revision = await options.storage.readRevision(revisionId);
      // An unreadable Entry's revision is reported exactly like a missing one.
      if (!revision || !visible(head.state.providers, revision.entry)) fail("not-found", "Revision is unavailable.");
      return copy(revision);
    },
    async compareRevisions(actor, request) {
      const query = parseHostedQuery("compare", request);
      await authorize(actor);
      const head = await options.storage.readHead();
      assertReadable(head, query.entry);
      const [before, after] = [await targetValues(head, query.entry, query.from), await targetValues(head, query.entry, query.to)];
      return copy({ entry: query.entry, from: query.from, to: query.to, differences: differencesFor(head.state.providers, query.entry, before, after) });
    },
    async previewFields(actor, request) {
      const query = parseHostedQuery("preview", request);
      await authorize(actor);
      const head = copy(await options.storage.readHead());
      checkExpected(head.state, query.expected);
      assertDefinitions(head);
      const before = copy(findEntry(head.state.providers, query.entry).values);
      setFields(head.state.providers, query.entry, query.values, query.clear);
      checkGraph(head.state.providers);
      const after = findEntry(head.state.providers, query.entry).values;
      return copy({ entry: query.entry, expected: identity(head.state), values: after, differences: differencesFor(head.state.providers, query.entry, before, after) });
    },
    async readPublicationStatus(actor) {
      await authorize(actor);
      const head = await options.storage.readHead();
      const publication = head.activePublicationId ? await options.storage.readPublication(head.activePublicationId) : null;
      return copy({
        activated: { baseline: head.state.baseline, definition: head.state.definition, integrationFence: head.state.integrationFence },
        submission: publication ? { publicationId: publication.id, snapshotId: publication.snapshotId, status: publication.status, statusVersion: publication.statusVersion, ...(publication.message !== undefined ? { message: publication.message } : {}) } : null,
        artifact: publication?.facts?.artifact ?? null,
        deployed: publication?.status === "deployed",
      });
    },
    async readReceipt(actor, operationKey) {
      const trusted = copy(actor);
      await authorize(trusted);
      return copy(await options.storage.readReceipt(trusted.id, operationKey));
    },
    async readSnapshot(actor, snapshotId) {
      await authorize(actor);
      return publicSnapshot(await readSnapshot(snapshotId));
    },
    async getPublication(actor, publicationId) {
      await authorize(actor);
      return copy(await readPublication(publicationId));
    },
    async execute(actor, request) {
      const command = parseHostedCommand(request);
      // Authenticate before reading any actor-scoped receipt. The actor never comes from the command.
      const authenticated = copy(actor);
      await authorize(authenticated);
      const actorId = authenticated.id;
      const fingerprint = await options.digest(canonicalSerialize({ siteId: options.siteId, actorId, command }));
      return mutate(async head => {
        const replay = receipt(await options.storage.readReceipt(actorId, command.operationKey), fingerprint);
        if (replay) return { value: replay };
        checkExpected(head.state, command.expected);
        assertDefinitions(head);
        const before = copy(head.state.providers);
        let restoredFrom: string | undefined;
        let createdEntry: ContentEntryRef | undefined, snapshot: HostedSnapshot | undefined, captured: HostedSnapshot | undefined, publication: HostedPublication | undefined;
        switch (command.kind) {
          case "set-fields": setFields(head.state.providers, command.entry, command.values, command.clear); break;
          case "create-entry": case "add-entry": case "reorder": createdEntry = changeCollection(head.state.providers, command); break;
          case "restore-revision": {
            const revision = await readRevisionFor(command.entry, command.revisionId);
            restoreValues(head.state.providers, command.entry, revision.values);
            restoredFrom = revision.id;
            break;
          }
          case "capture-snapshot": {
            const providers = deliveryProviders(head), assets = copy(options.policy.assets), diagnostics = checkGraph(providers);
            const renderData = copy(await options.project(copy(providers), copy(assets)));
            const digest = await options.digest(canonicalSerialize({ providers, assets, renderData }));
            snapshot = captured = { ...identity(head.state), id: options.createId(), digest, providers, assets, diagnostics, renderData };
            if (await options.storage.readSnapshot(captured.id)) fail("configuration-required", "Host ID factory returned an existing snapshot identity.");
            break;
          }
          case "begin-publication": {
            snapshot = await readSnapshot(command.snapshotId);
            checkExpected(head.state, snapshot);
            const active = head.activePublicationId ? await options.storage.readPublication(head.activePublicationId) : null;
            if (active && !terminal(active)) fail("publication-busy", "A publication is already active; recover its authoritative status.");
            if (snapshot.diagnostics.length) throw new HostedContentError("incomplete", "Complete required and accessible values before submission.", publicSnapshot(snapshot).diagnostics);
            await options.validateSubmission(copy(snapshot));
            publication = { id: options.createId(), snapshotId: snapshot.id, expectedBaseline: copy(snapshot.baseline), status: "submitted", lastProvenStatus: "submitted", statusVersion: 1 };
            if (await options.storage.readPublication(publication.id)) fail("configuration-required", "Host ID factory returned an existing publication identity.");
            head.activePublicationId = publication.id;
            break;
          }
        }
        let revisions: HostedRevision[] = [];
        if (command.kind !== "capture-snapshot" && command.kind !== "begin-publication") {
          revisions = await revisionsFor({ ...head, state: { ...head.state, providers: before } }, head.state.providers, head.state.definition, authenticated, { kind: command.kind, key: command.operationKey }, restoredFrom);
          // A no-op save keeps the stored draft and revision: only its receipt is recorded.
          if (!revisions.length) head.state.providers = before;
          else {
            checkGraph(head.state.providers);
            head.state.draftRevision = options.createId();
          }
        }
        const result: HostedResult = { state: publicState(head.state), ...(createdEntry ? { createdEntry } : {}), ...(snapshot ? { snapshot: publicSnapshot(snapshot) } : {}), ...(publication ? { publication: copy(publication) } : {}) };
        return { value: result, write: { head, receipt: { actorId, operationKey: command.operationKey, fingerprint, result: copy(result) }, ...(captured ? { snapshot: captured } : {}), ...(publication ? { publication } : {}), ...(revisions.length ? { revisions } : {}) } };
      });
    },
    async recordStatus(evidence) {
      const input = copy(evidence);
      if (!Number.isSafeInteger(input.statusVersion) || input.statusVersion < 1 || !["submitted", "building", "verified", "integrated", "deployed", "failed", "conflict", "unavailable"].includes(input.status)) fail("invalid-request", "Malformed host status evidence.");
      return mutate(async head => {
        const publication = await readPublication(input.publicationId);
        if (publication.snapshotId !== input.snapshotId) fail("invalid-request", "Status evidence names a different snapshot.");
        if (input.statusVersion <= publication.statusVersion) return { value: publication };
        // Integration must first reconcile the baseline through exact privileged evidence.
        if ((input.status === "integrated" || input.status === "deployed") && publication.integratedFence === undefined) fail("invalid-request", "Confirmed integration evidence is required first.");
        if (terminal(publication) && !(publication.status === "integrated" && input.status === "deployed")) return { value: publication };
        if ((rank[input.status] ?? Infinity) < (rank[publication.lastProvenStatus ?? publication.status] ?? -1)) return { value: publication };
        publication.status = input.status;
        if (input.status === "submitted" || input.status === "building" || input.status === "verified" || input.status === "integrated" || input.status === "deployed") publication.lastProvenStatus = input.status;
        publication.statusVersion = input.statusVersion;
        if (input.message !== undefined) publication.message = input.message;
        if (input.facts !== undefined) publication.facts = copy(input.facts);
        return { value: publication, write: { head, publication } };
      });
    },
    async recordConfirmedIntegration(evidence) {
      const input = copy(evidence);
      return mutate(async head => {
        const publication = await readPublication(input.publicationId);
        const snapshot = await options.storage.readSnapshot(publication.snapshotId) ?? fail("not-found", "Publication snapshot is unavailable.");
        if (input.snapshotId !== snapshot.id || !sameValue(input.expectedBaseline, publication.expectedBaseline) || input.contentDigest !== snapshot.digest || !input.gitSha) fail("baseline-conflict", "Integration evidence must identify the exact submitted baseline and content.");
        if (publication.integratedFence !== undefined) {
          if (publication.gitSha !== input.gitSha) fail("baseline-conflict", "Publication was integrated at another commit.");
          return { value: publicState(head.state) };
        }
        if (["failed", "conflict"].includes(publication.status)) fail("baseline-conflict", "Terminal publication cannot be reconciled without host recovery.");
        if (head.state.definition !== options.definition) fail("configuration-required", "The hosted definition changed; the host must adopt the canonical baseline first.");
        if (head.state.definition !== snapshot.definition) fail("definition-conflict", "Definition changed before integration.");
        if (!sameValue(head.state.baseline, input.expectedBaseline)) fail("baseline-conflict", "Canonical baseline advanced outside this operation.");
        head.baselineProviders = copy(snapshot.providers);
        for (const provider of head.state.providers) for (const entry of provider.entries) {
          const submitted = snapshot.providers.find(item => item.providerId === provider.providerId)?.entries.find(item => item.id === entry.id && item.modelId === entry.modelId);
          if (submitted && submitted.generation === entry.generation && sameValue(submitted.values, entry.values) && entry.lifecycle !== submitted.lifecycle) {
            entry.lifecycle = submitted.lifecycle;
            entry.generation += 1;
          }
        }
        head.state.baseline = { gitSha: input.gitSha, contentDigest: input.contentDigest };
        head.state.integrationFence += 1;
        head.state.draftRevision = options.createId();
        publication.integratedFence = head.state.integrationFence;
        publication.gitSha = input.gitSha;
        publication.status = "integrated";
        publication.lastProvenStatus = "integrated";
        publication.statusVersion += 1;
        return { value: publicState(head.state), write: { head, publication } };
      });
    },
    async adoptCanonicalBaseline(evidence) {
      const input = copy(evidence);
      if (!input || !Array.isArray(input.providers) || !input.baseline?.gitSha || !input.baseline.contentDigest || !input.expected?.baseline || typeof input.expected.definition !== "string" || !["rebase", "discard"].includes(input.draft) || typeof input.apply !== "boolean") fail("invalid-request", "Malformed canonical adoption evidence.");
      return mutate(async head => {
        if (!sameValue(head.state.baseline, input.expected.baseline) || head.state.definition !== input.expected.definition) fail("baseline-conflict", "The stored canonical identity changed; read it again before adopting.");
        const active = head.activePublicationId ? await options.storage.readPublication(head.activePublicationId) : null;
        // A remote integration may have produced this very commit; record its outcome first.
        if (active && !terminal(active)) fail("publication-busy", "Record the active publication's outcome before adopting another canonical baseline.");
        try { checkGraph(input.providers); }
        catch (error) { fail("configuration-required", `Canonical content does not satisfy the hosted definition. ${error instanceof Error ? error.message : ""}`.trim()); }
        const rebased = input.draft === "rebase" ? rebaseDraft(head, input.providers)
          : { providers: copy(input.providers), carried: [], dropped: authoredChanges(head).flatMap(({ ref, fieldIds }) => fieldIds.map(fieldId => ({ entry: ref, fieldId, reason: "discarded" as const }))) };
        checkGraph(rebased.providers);
        const state: HostedState = { draftRevision: options.createId(), baseline: copy(input.baseline), definition: options.definition, integrationFence: head.state.integrationFence + 1, providers: rebased.providers };
        const value: HostedAdoptionResult = { applied: input.apply, state: publicState(state), carried: rebased.carried, dropped: rebased.dropped };
        if (!input.apply) return { value };
        const revisions = await revisionsFor(head, state.providers, state.definition, null, { kind: "adopt-canonical-baseline", key: null });
        head.state = state;
        head.baselineProviders = copy(input.providers);
        return { value, write: { head, ...(revisions.length ? { revisions } : {}) } };
      });
    },
  };
  return service;
}
