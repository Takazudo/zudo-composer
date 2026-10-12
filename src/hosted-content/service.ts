import { buildContentGraphIndex, contentEntryRefKey } from "../content/library/graph";
import { createContentEntryRecord, diagnoseContentEntryCompleteness } from "../content/library/helpers";
import type { ContentCompletenessDiagnostic } from "../content/model/types";
import { canonicalSerialize } from "./canonical";
import { assertFieldChange, assertSafeUrl, parseHostedCommand, sameValue } from "./validation";
import { HostedContentError } from "./types";
import type {
  ContentEntryRecord, ContentEntryRef, HostedActor, HostedCollectionPermission, HostedCommand,
  HostedDatabase, HostedIdentities, HostedModelPermission, HostedProvider, HostedPublication,
  HostedPublicationStage, HostedResult, HostedService, HostedServiceOptions, HostedSnapshot, HostedState, JsonValue,
} from "./types";

const copy = <T>(value: T): T => structuredClone(value);
function fail(code: ConstructorParameters<typeof HostedContentError>[0], message: string): never { throw new HostedContentError(code, message); }
const identity = (state: HostedIdentities): HostedIdentities => ({ draftRevision: state.draftRevision, baseline: copy(state.baseline), definition: state.definition });
const terminal = (publication: HostedPublication): boolean => ["integrated", "deployed", "failed", "conflict"].includes(publication.status);
const rank: Partial<Record<HostedPublicationStage, number>> = { submitted: 0, building: 1, verified: 2, integrated: 3, deployed: 4 };

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
  function permitted(providers: HostedProvider[], ref: ContentEntryRef): boolean {
    const model = options.policy.models.find(item => item.providerId === ref.providerId && item.modelId === ref.modelId);
    if (!model) return false;
    return model.entryIds.includes(ref.recordId) || options.policy.collections.some(collection => collection.target.providerId === ref.providerId && collection.target.modelId === ref.modelId && membership(providers, collection).some(item => contentEntryRefKey(item) === contentEntryRefKey(ref)));
  }
  function visible(providers: HostedProvider[], ref: ContentEntryRef): boolean {
    return permitted(providers, ref) || options.policy.collections.some(collection => contentEntryRefKey(collection.owner) === contentEntryRefKey(ref));
  }
  function publicState(state: HostedState): HostedState {
    const providers = state.providers.map(provider => ({ ...provider,
      models: provider.models.filter(model => options.policy.models.some(permission => permission.providerId === provider.providerId && permission.modelId === model.id) || options.policy.collections.some(collection => collection.owner.providerId === provider.providerId && collection.owner.modelId === model.id)),
      entries: provider.entries.filter(entry => visible(state.providers, { providerId: provider.providerId, modelId: entry.modelId, recordId: entry.id })),
    })).filter(provider => provider.models.length || provider.entries.length);
    return copy({ ...state, providers });
  }
  function checkExpected(state: HostedState, expected: HostedIdentities): void {
    if (state.definition !== options.definition || expected.definition !== state.definition) fail("definition-conflict", "Hosted definition changed; explicit reconciliation is required.");
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
  function assertDefinitions(database: HostedDatabase): void {
    if (database.state.providers.length !== database.baselineProviders.length) fail("definition-conflict", "Working providers differ from the canonical baseline.");
    for (const provider of database.state.providers) {
      const baseline = database.baselineProviders.find(item => item.providerId === provider.providerId);
      if (!baseline || !sameValue(provider.models, baseline.models)) fail("definition-conflict", "Working model definitions differ from the canonical baseline.");
    }
  }
  function deliveryProviders(database: HostedDatabase): HostedProvider[] {
    const providers = copy(database.baselineProviders);
    // Definitions and protected records come from the canonical baseline, never request data.
    for (const current of database.state.providers) {
      const baseline = providers.find(provider => provider.providerId === current.providerId);
      if (!baseline || !sameValue(baseline.models, current.models)) fail("definition-conflict", "Working model definitions differ from the canonical baseline.");
      for (const entry of current.entries) {
        const ref = { providerId: current.providerId, modelId: entry.modelId, recordId: entry.id };
        if (!visible(database.state.providers, ref)) continue;
        const delivered = { ...copy(entry), lifecycle: "published" as const };
        const index = baseline.entries.findIndex(item => item.id === entry.id);
        if (index < 0) baseline.entries.push(delivered); else baseline.entries[index] = delivered;
      }
    }
    return providers;
  }
  function receipt(database: HostedDatabase, actorId: string, command: HostedCommand, fingerprint: string): HostedResult | undefined {
    const existing = database.receipts.find(item => item.actorId === actorId && item.operationKey === command.operationKey);
    if (!existing) return;
    if (existing.fingerprint !== fingerprint) fail("operation-key-reuse", "Operation key is already bound to another immutable request.");
    return copy(existing.result);
  }
  const service: HostedService = {
    async readState(actor) { await authorize(actor); return publicState((await options.storage.read()).state); },
    async readReceipt(actor, operationKey) {
      const trusted = copy(actor);
      await authorize(trusted);
      return copy((await options.storage.read()).receipts.find(item => item.actorId === trusted.id && item.operationKey === operationKey) ?? null);
    },
    async readSnapshot(actor, snapshotId) {
      await authorize(actor);
      return copy((await options.storage.read()).snapshots.find(snapshot => snapshot.id === snapshotId) ?? fail("not-found", "Snapshot is unavailable."));
    },
    async getPublication(actor, publicationId) {
      await authorize(actor);
      return copy((await options.storage.read()).publications.find(publication => publication.id === publicationId) ?? fail("not-found", "Publication is unavailable."));
    },
    async execute(actor, request) {
      const command = parseHostedCommand(request);
      // Authenticate before reading any actor-scoped receipt. The actor never comes from the command.
      const authenticated = copy(actor);
      await authorize(authenticated);
      const actorId = authenticated.id;
      const fingerprint = await options.digest(canonicalSerialize({ siteId: options.siteId, actorId, command }));
      const recovered = receipt(await options.storage.read(), actorId, command, fingerprint);
      if (recovered) return recovered;
      return copy(await options.storage.transaction(async database => {
        const replay = receipt(database, actorId, command, fingerprint);
        if (replay) return replay;
        checkExpected(database.state, command.expected);
        assertDefinitions(database);
        let createdEntry: ContentEntryRef | undefined, snapshot: HostedSnapshot | undefined, publication: HostedPublication | undefined;
        switch (command.kind) {
          case "set-fields": setFields(database.state.providers, command.entry, command.values, command.clear); break;
          case "create-entry": case "add-entry": case "reorder": createdEntry = changeCollection(database.state.providers, command); break;
          case "capture-snapshot": {
            const providers = deliveryProviders(database), assets = copy(options.policy.assets), diagnostics = checkGraph(providers);
            const renderData = copy(options.project(copy(providers), copy(assets)));
            const digest = await options.digest(canonicalSerialize({ providers, assets, renderData }));
            snapshot = { ...identity(database.state), id: options.createId(), digest, providers, assets, diagnostics, renderData };
            if (database.snapshots.some(item => item.id === snapshot!.id)) fail("configuration-required", "Host ID factory returned an existing snapshot identity.");
            database.snapshots.push(copy(snapshot));
            break;
          }
          case "begin-publication": {
            snapshot = database.snapshots.find(item => item.id === command.snapshotId) ?? fail("not-found", "Snapshot is unavailable.");
            checkExpected(database.state, snapshot);
            if (database.publications.some(item => !terminal(item))) fail("publication-busy", "A publication is already active; recover its authoritative status.");
            if (snapshot.diagnostics.length) throw new HostedContentError("incomplete", "Complete required and accessible values before submission.", copy(snapshot.diagnostics));
            await options.validateSubmission(copy(snapshot));
            publication = { id: options.createId(), snapshotId: snapshot.id, expectedBaseline: copy(snapshot.baseline), status: "submitted", lastProvenStatus: "submitted", statusVersion: 1 };
            if (database.publications.some(item => item.id === publication!.id)) fail("configuration-required", "Host ID factory returned an existing publication identity.");
            database.publications.push(copy(publication));
            break;
          }
        }
        if (command.kind !== "capture-snapshot" && command.kind !== "begin-publication") {
          checkGraph(database.state.providers);
          database.state.draftRevision = options.createId();
        }
        const result: HostedResult = { state: publicState(database.state), ...(createdEntry ? { createdEntry } : {}), ...(snapshot ? { snapshot: copy(snapshot) } : {}), ...(publication ? { publication: copy(publication) } : {}) };
        database.receipts.push({ actorId, operationKey: command.operationKey, fingerprint, result: copy(result) });
        return result;
      }));
    },
    async recordStatus(evidence) {
      const input = copy(evidence);
      if (!Number.isSafeInteger(input.statusVersion) || input.statusVersion < 1 || !["submitted", "building", "verified", "integrated", "deployed", "failed", "conflict", "unavailable"].includes(input.status)) fail("invalid-request", "Malformed host status evidence.");
      return copy(await options.storage.transaction(async database => {
        const publication = database.publications.find(item => item.id === input.publicationId) ?? fail("not-found", "Publication is unavailable.");
        if (publication.snapshotId !== input.snapshotId) fail("invalid-request", "Status evidence names a different snapshot.");
        if (input.statusVersion <= publication.statusVersion) return publication;
        // Integration must first reconcile the baseline through exact privileged evidence.
        if ((input.status === "integrated" || input.status === "deployed") && publication.integratedFence === undefined) fail("invalid-request", "Confirmed integration evidence is required first.");
        if (terminal(publication) && !(publication.status === "integrated" && input.status === "deployed")) return publication;
        if ((rank[input.status] ?? Infinity) < (rank[publication.lastProvenStatus ?? publication.status] ?? -1)) return publication;
        publication.status = input.status;
        if (input.status === "submitted" || input.status === "building" || input.status === "verified" || input.status === "integrated" || input.status === "deployed") publication.lastProvenStatus = input.status;
        publication.statusVersion = input.statusVersion;
        if (input.message !== undefined) publication.message = input.message;
        if (input.facts !== undefined) publication.facts = copy(input.facts);
        return publication;
      }));
    },
    async recordConfirmedIntegration(evidence) {
      const input = copy(evidence);
      return copy(await options.storage.transaction(async database => {
        const publication = database.publications.find(item => item.id === input.publicationId) ?? fail("not-found", "Publication is unavailable.");
        const snapshot = database.snapshots.find(item => item.id === publication.snapshotId) ?? fail("not-found", "Publication snapshot is unavailable.");
        if (input.snapshotId !== snapshot.id || !sameValue(input.expectedBaseline, publication.expectedBaseline) || input.contentDigest !== snapshot.digest || !input.gitSha) fail("baseline-conflict", "Integration evidence must identify the exact submitted baseline and content.");
        if (publication.integratedFence !== undefined) {
          if (publication.gitSha !== input.gitSha) fail("baseline-conflict", "Publication was integrated at another commit.");
          return publicState(database.state);
        }
        if (["failed", "conflict"].includes(publication.status)) fail("baseline-conflict", "Terminal publication cannot be reconciled without host recovery.");
        if (database.state.definition !== snapshot.definition || database.state.definition !== options.definition) fail("definition-conflict", "Definition changed before integration.");
        if (!sameValue(database.state.baseline, input.expectedBaseline)) fail("baseline-conflict", "Canonical baseline advanced outside this operation.");
        database.baselineProviders = copy(snapshot.providers);
        for (const provider of database.state.providers) for (const entry of provider.entries) {
          const submitted = snapshot.providers.find(item => item.providerId === provider.providerId)?.entries.find(item => item.id === entry.id && item.modelId === entry.modelId);
          if (submitted && submitted.generation === entry.generation && sameValue(submitted.values, entry.values) && entry.lifecycle !== submitted.lifecycle) {
            entry.lifecycle = submitted.lifecycle;
            entry.generation += 1;
          }
        }
        database.state.baseline = { gitSha: input.gitSha, contentDigest: input.contentDigest };
        database.state.integrationFence += 1;
        database.state.draftRevision = options.createId();
        publication.integratedFence = database.state.integrationFence;
        publication.gitSha = input.gitSha;
        publication.status = "integrated";
        publication.lastProvenStatus = "integrated";
        publication.statusVersion += 1;
        return publicState(database.state);
      }));
    },
  };
  return service;
}
