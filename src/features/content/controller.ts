import {
  CONTENT_FIELD_KINDS,
  createContentEntryRecord,
  createContentModelRecord,
  createContentValueSchema,
  diagnoseContentEntryCompleteness,
  applyContentInverseMutation,
  contentEntryDigest,
  readContentGraph,
  type ContentEntryRecord,
  type ContentFieldDefinition,
  type ContentFieldKind,
  type ContentInitializationOutcome,
  type ContentModelKind,
  type ContentModelRecord,
  type ContentModelSummary,
  type ContentEntryRef,
  type ContentGraphLocation,
  type ContentRecordRef,
  type ContentSnapshot,
  type ContentProvider,
} from "../../content";
import { createUuidIdFactory, type IdFactory } from "../../shared";
import { createSaveQueue, type SaveQueue } from "../../shared/persistence";

export const CONTENT_ENTRY_PAGE_SIZE = 25;
export type ContentWorkMode = "entries" | "model-fields" | "relationships";
export type ContentSaveStatus = "pristine" | "saved" | "dirty" | "saving" | "error";
export interface ContentMediaCatalogSource { descriptor: { id: string; label: string }; store: { list(): Promise<readonly { id: string; fileName: string; state: "active" | "trash" }[]> } }

export interface ContentAuthoringState {
  viewId: string | null;
  phase: "idle" | "loading" | "ready" | "recovery" | "error";
  models: readonly ContentModelSummary[];
  providerId: string;
  providerLabel: string;
  modelDescriptions: Readonly<Record<string, string>>;
  entryCounts: Readonly<Record<string, number>>;
  /**
   * Entries missing a required value, per model — what the navigator's warn
   * dots read. A model is absent until it has been scanned, and stays absent
   * when its scan fails: the dot is a claim about the whole model, so an
   * unknown model shows none rather than an invented "complete".
   */
  incompleteCounts: Readonly<Record<string, number>>;
  model: ContentModelRecord | null;
  entries: readonly ContentEntryRecord[];
  usedFieldIds: readonly string[];
  entry: ContentEntryRecord | null;
  nextCursor?: string;
  workMode: ContentWorkMode;
  saveStatus: ContentSaveStatus;
  message: string;
  recoveryMessage: string | null;
  graphStatus: "idle" | "ready" | "unavailable";
  graphMessage: string;
  snapshots: readonly ContentSnapshot[];
  incoming: readonly { owner: ContentGraphLocation; ordered: boolean }[];
  publicationState: "draft" | "published" | "published-pending";
}

const initialState: ContentAuthoringState = {
  viewId: null,
  phase: "idle", models: [], providerId: "", providerLabel: "", modelDescriptions: {}, entryCounts: {}, incompleteCounts: {}, model: null, entries: [], usedFieldIds: [], entry: null,
  workMode: "entries", saveStatus: "pristine", message: "", recoveryMessage: null, graphStatus: "idle", graphMessage: "", snapshots: [], incoming: [], publicationState: "draft",
};

function queueStatus(state: { status: Exclude<ContentSaveStatus, "pristine"> }): Exclude<ContentSaveStatus, "pristine"> {
  return state.status;
}

export class ContentAuthoringController {
  private current: ContentAuthoringState = initialState;
  private readonly listeners = new Set<(state: ContentAuthoringState) => void>();
  private readonly idFactory: IdFactory;
  private readonly now: () => string;
  private readonly providers: readonly ContentProvider[];
  private readonly mediaProvider?: ContentMediaCatalogSource;
  private readonly loadActivatedBaseline?: () => Promise<readonly ContentSnapshot[]>;
  private baselineEntry: ContentEntryRecord | null = null;
  private modelQueue: SaveQueue<ContentModelRecord> | null = null;
  private entryQueue: SaveQueue<ContentEntryRecord> | null = null;
  private unsubscribeModel: (() => void) | null = null;
  private unsubscribeEntry: (() => void) | null = null;
  /** Invalidates an in-flight completeness sweep when the library reloads under it. */
  private scanGeneration = 0;

  constructor(readonly provider: ContentProvider, options: { idFactory?: IdFactory; now?: () => string; providers?: readonly ContentProvider[]; mediaProvider?: ContentMediaCatalogSource; loadActivatedBaseline?: () => Promise<readonly ContentSnapshot[]> } = {}) {
    this.idFactory = options.idFactory ?? createUuidIdFactory();
    this.now = options.now ?? (() => new Date().toISOString());
    this.providers = options.providers ?? [provider];
    this.mediaProvider = options.mediaProvider;
    this.loadActivatedBaseline = options.loadActivatedBaseline;
    this.current = { ...initialState, providerId: provider.descriptor.id, providerLabel: provider.descriptor.label };
  }

  get state(): ContentAuthoringState { return this.current; }
  subscribe(listener: (state: ContentAuthoringState) => void): () => void {
    this.listeners.add(listener); listener(this.current); return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> { await this.runInitialization(() => this.provider.initialization.initialize()); }
  async retryInitialization(): Promise<void> { await this.runInitialization(() => this.provider.initialization.retry()); }
  async startFresh(): Promise<void> { await this.runInitialization(() => this.provider.initialization.startFresh()); }

  async createModel(name: string, kind: ContentModelKind): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Model name is required.");
    await this.flushSessions();
    const record = createContentModelRecord({ name: trimmed, kind }, { idFactory: this.idFactory, now: this.now });
    await this.provider.store.putModel(record);
    await this.refreshModels();
    await this.openModel(record.id);
  }

  async openModel(id: string): Promise<void> {
    if (this.current.model?.id === id) return;
    await this.flushSessions();
    const outcome = await this.provider.store.getModel(id);
    if (outcome.status !== "loaded") throw new Error(outcome.status === "not-found" ? "Content model was not found." : "This model is unreadable and has been preserved.");
    await this.closeQueues();
    const [page, snapshot] = await Promise.all([
      this.provider.store.pageEntries(id, { limit: CONTENT_ENTRY_PAGE_SIZE }),
      this.provider.store.scanEntries(id),
    ]);
    this.installModelQueue(outcome.record);
    this.set({ ...this.current, phase: "ready", viewId: null, model: outcome.record, entries: page.entries, entry: null,
      usedFieldIds: usedFields(snapshot.entries), nextCursor: page.nextCursor, workMode: "entries", saveStatus: "pristine", message: "Model loaded.",
      entryCounts: { ...this.current.entryCounts, [id]: snapshot.count },
      incompleteCounts: { ...this.current.incompleteCounts, [id]: incompleteEntryCount(outcome.record, snapshot.entries) } });
    if (outcome.record.document.kind === "single" && page.entries[0]) await this.openEntry(page.entries[0].id);
  }

  async loadMoreEntries(): Promise<void> {
    const model = this.requireModel();
    if (!this.current.nextCursor) return;
    const page = await this.provider.store.pageEntries(model.id, { limit: CONTENT_ENTRY_PAGE_SIZE, cursor: this.current.nextCursor });
    this.set({ ...this.current, entries: [...this.current.entries, ...page.entries], nextCursor: page.nextCursor, message: "More Entries loaded." });
  }

  async reloadEntries(): Promise<void> {
    const model = this.requireModel(); const selectedId = this.current.entry?.id;
    await this.flushSessions();
    if (this.entryQueue) {
      const queue = this.entryQueue;
      this.unsubscribeEntry?.(); this.unsubscribeEntry = null;
      this.entryQueue = null;
      await queue.close();
    }
    const [page, snapshot] = await Promise.all([
      this.provider.store.pageEntries(model.id, { limit: CONTENT_ENTRY_PAGE_SIZE }),
      this.provider.store.scanEntries(model.id),
    ]);
    this.set({ ...this.current, entries: page.entries, usedFieldIds: usedFields(snapshot.entries), entry: null, nextCursor: page.nextCursor, entryCounts: { ...this.current.entryCounts, [model.id]: snapshot.count }, incompleteCounts: { ...this.current.incompleteCounts, [model.id]: incompleteEntryCount(snapshot.model, snapshot.entries) }, message: "Entries reloaded." });
    if (selectedId && page.entries.some((entry) => entry.id === selectedId)) await this.openEntry(selectedId);
  }

  updateModel(patch: (record: ContentModelRecord) => ContentModelRecord): void {
    const model = this.requireModel();
    const updated = { ...patch(model), updatedAt: this.now() };
    this.modelQueue!.edit(this.modelQueue!.ref, updated);
    this.set({ ...this.current, model: updated, models: this.current.models.map((summary) => summary.id === updated.id ? { ...summary, name: updated.document.name, fieldCount: updated.document.fields.length, updatedAt: updated.updatedAt } : summary) });
  }

  renameModel(name: string): void {
    if (!name.trim()) return;
    this.updateModel((record) => ({ ...record, document: { ...record.document, name } }));
  }

  addField(kind: ContentFieldKind = "text"): void {
    if (!CONTENT_FIELD_KINDS.includes(kind)) throw new Error("Unsupported field kind.");
    const field: ContentFieldDefinition = { id: this.idFactory("content-field"), key: this.uniqueFieldKey("field"), label: "New field", required: false, ...createContentValueSchema(kind, { providerId: this.provider.descriptor.id, recordId: this.requireModel().id }) };
    this.updateModel((record) => ({ ...record, document: { ...record.document, fields: [...record.document.fields, field] } }));
  }

  updateField(fieldId: string, patch: Partial<Pick<ContentFieldDefinition, "key" | "label" | "required" | "kind">>): void {
    const model = this.requireModel();
    const old = model.document.fields.find((field) => field.id === fieldId);
    if (!old) throw new Error("Content field was not found.");
    if (patch.kind && patch.kind !== old.kind && this.current.usedFieldIds.includes(fieldId)) {
      throw new Error("Field kind cannot change while stored Entries use this field.");
    }
    const { kind, ...metadata } = patch;
    const next: ContentFieldDefinition = kind && kind !== old.kind
      ? { id: old.id, key: old.key, label: old.label, required: old.required, ...metadata, ...createContentValueSchema(kind, { providerId: this.provider.descriptor.id, recordId: model.id }) }
      : { ...old, ...metadata };
    this.updateModel((record) => ({ ...record, document: { ...record.document, fields: record.document.fields.map((field) => field.id === fieldId ? next : field) } }));
  }

  moveField(fieldId: string, direction: -1 | 1): void {
    const model = this.requireModel(); const index = model.document.fields.findIndex((field) => field.id === fieldId);
    const target = index + direction; if (index < 0 || target < 0 || target >= model.document.fields.length) return;
    const fields = [...model.document.fields]; [fields[index], fields[target]] = [fields[target]!, fields[index]!];
    this.updateModel((record) => ({ ...record, document: { ...record.document, fields } }));
  }

  async removeField(fieldId: string): Promise<void> {
    const model = this.requireModel();
    await this.flushSessions();
    await this.provider.store.removeField(model.id, fieldId);
    const outcome = await this.provider.store.getModel(model.id);
    if (outcome.status !== "loaded") throw new Error("The updated model could not be reloaded.");
    const entryQueue = this.entryQueue;
    this.unsubscribeEntry?.(); this.unsubscribeEntry = null;
    this.entryQueue = null;
    await entryQueue?.close();
    this.installModelQueue(outcome.record);
    const [page, snapshot] = await Promise.all([
      this.provider.store.pageEntries(model.id, { limit: CONTENT_ENTRY_PAGE_SIZE }),
      this.provider.store.scanEntries(model.id),
    ]);
    this.set({ ...this.current, model: outcome.record, entries: page.entries, usedFieldIds: usedFields(snapshot.entries), entry: null, nextCursor: page.nextCursor, incompleteCounts: { ...this.current.incompleteCounts, [model.id]: incompleteEntryCount(outcome.record, snapshot.entries) }, message: "Field removed and stored values scrubbed." });
  }

  async createEntry(): Promise<void> {
    const model = this.requireModel();
    if (model.document.kind === "single" && this.current.entries.length > 0) throw new Error("A Single model has exactly one Entry workspace.");
    await this.flushSessions();
    const entry = createContentEntryRecord(model.id, {}, { idFactory: this.idFactory, now: this.now });
    await this.provider.store.putEntry(entry);
    this.admitEntry(model, entry);
    await this.openEntry(entry.id);
  }

  /**
   * A Collection Entry copied whole, minus its identity. Creation prepends, so
   * the copy lands at the head of the list beside the Entry it came from.
   */
  async duplicateEntry(id: string): Promise<void> {
    const model = this.requireModel();
    if (model.document.kind === "single") throw new Error("A Single model has exactly one Entry workspace.");
    await this.flushSessions();
    const outcome = await this.provider.store.getEntry(id);
    if (outcome.status !== "loaded") throw new Error(outcome.status === "not-found" ? "Entry was not found." : "This Entry is unreadable and has been preserved.");
    const copy = createContentEntryRecord(model.id, structuredClone(outcome.record.values), { idFactory: this.idFactory, now: this.now });
    await this.provider.store.putEntry(copy);
    this.admitEntry(model, copy);
    await this.openEntry(copy.id);
  }

  async openEntry(id: string): Promise<void> {
    if (this.current.entry?.id === id) return;
    if (this.entryQueue) {
      const queue = this.entryQueue;
      await queue.flush();
      this.unsubscribeEntry?.(); this.unsubscribeEntry = null;
      this.entryQueue = null;
      await queue.close();
    }
    const outcome = await this.provider.store.getEntry(id);
    if (outcome.status !== "loaded") throw new Error(outcome.status === "not-found" ? "Entry was not found." : "This Entry is unreadable and has been preserved.");
    this.entryQueue = createSaveQueue({ ref: { providerId: this.provider.descriptor.id, recordId: outcome.record.id }, initialRecord: outcome.record,
      write: ({ record }) => this.provider.store.putEntry(record) });
    this.unsubscribeEntry = this.subscribeQueue(this.entryQueue);
    // Queue construction publishes its initial `saved` state synchronously;
    // that only says the persisted record was loaded, not that this route has
    // authored a change during this session.
    this.baselineEntry = null;
    this.set({ ...this.current, entry: outcome.record, workMode: "entries", saveStatus: "pristine", message: "Entry loaded.", incoming: [], publicationState: outcome.record.lifecycle });
    void this.refreshGraph(outcome.record);
    void this.refreshPublication(outcome.record);
  }

  async inspectSchema(): Promise<void> {
    if (this.entryQueue) {
      const queue = this.entryQueue;
      await queue.flush();
      this.unsubscribeEntry?.(); this.unsubscribeEntry = null;
      this.entryQueue = null;
      await queue.close();
    }
    this.set({ ...this.current, entry: null, workMode: "model-fields", message: "Model fields ready." });
  }

  browseEntries(): void {
    this.set({ ...this.current, workMode: "entries", message: "Entries ready." });
  }

  async inspectRelationships(): Promise<void> {
    await this.flushSessions();
    if (this.current.entry) await this.refreshGraph(this.current.entry);
    this.set({ ...this.current, workMode: "relationships", message: "Relationships ready." });
  }

  selectView(viewId: string | null): void {
    if (viewId !== null && !this.requireModel().document.presentation?.views.some((view) => view.id === viewId)) throw new Error(`Content view "${viewId}" is unavailable for this model.`);
    this.set({ ...this.current, viewId });
  }

  updateEntryValue(fieldId: string, value: ContentEntryRecord["values"][string] | undefined): void {
    const entry = this.current.entry; if (!entry || !this.entryQueue) throw new Error("No Entry is open.");
    const values = { ...entry.values }; if (value === undefined || value === "") delete values[fieldId]; else values[fieldId] = value;
    const updated = { ...entry, updatedAt: this.now(), values };
    this.entryQueue.edit(this.entryQueue.ref, updated);
    // The model's warn dot is a running total rather than a rescan: an edit can
    // only change this one Entry's completeness, so the delta is exact.
    const model = this.current.model;
    const delta = model ? Number(this.completeness(updated).length > 0) - Number(this.completeness(entry).length > 0) : 0;
    this.set({ ...this.current, entry: updated, entries: this.current.entries.map((item) => item.id === updated.id ? updated : item), publicationState: this.publicationState(updated),
      ...(model && delta !== 0 ? { incompleteCounts: shiftCount(this.current.incompleteCounts, model.id, delta) } : {}),
      usedFieldIds: value === undefined || value === "" ? this.current.usedFieldIds : [...new Set([...this.current.usedFieldIds, fieldId])] });
  }

  /** Updates one nested canonical value without introducing a parallel form model. */
  updateEntryValueAtPath(fieldId: string, path: readonly (string | number)[], value: ContentEntryRecord["values"][string] | undefined): void {
    if (path.length === 0) { this.updateEntryValue(fieldId, value); return; }
    const entry = this.current.entry;
    if (!entry) throw new Error("No Entry is open.");
    const root = structuredClone(entry.values[fieldId] ?? (typeof path[0] === "number" ? [] : {})) as unknown;
    let cursor = root as Record<string | number, unknown>;
    for (let index = 0; index < path.length - 1; index++) {
      const segment = path[index]!, next = path[index + 1]!;
      const child = cursor[segment];
      cursor[segment] = child !== null && typeof child === "object" ? child : typeof next === "number" ? [] : {};
      cursor = cursor[segment] as Record<string | number, unknown>;
    }
    const last = path[path.length - 1]!;
    if (value === undefined || value === "") {
      if (Array.isArray(cursor) && typeof last === "number") cursor.splice(last, 1);
      else delete cursor[last];
    } else cursor[last] = value;
    this.updateEntryValue(fieldId, root as ContentEntryRecord["values"][string]);
  }

  updateModelDescription(description: string): void {
    this.updateModel((record) => ({ ...record, document: { ...record.document, description } }));
    const model = this.requireModel();
    this.set({ ...this.current, modelDescriptions: { ...this.current.modelDescriptions, [model.id]: description } });
  }

  replaceField(fieldId: string, next: ContentFieldDefinition): void {
    this.requireModel();
    if (next.id !== fieldId) throw new Error("Field identity cannot change.");
    this.updateModel((record) => ({ ...record, document: { ...record.document, fields: record.document.fields.map((field) => field.id === fieldId ? structuredClone(next) : field) } }));
  }

  async referenceEntries(target: ContentRecordRef): Promise<{ ref: ContentEntryRef; label: string; lifecycle: ContentEntryRecord["lifecycle"] }[]> {
    const owner = this.providers.find((candidate) => candidate.descriptor.id === target.providerId);
    if (!owner) throw new Error(`Content provider “${target.providerId}” is unavailable.`);
    const snapshot = await owner.store.scanEntries(target.recordId);
    return snapshot.entries.map((entry) => ({ ref: { providerId: target.providerId, modelId: target.recordId, recordId: entry.id }, label: entryLabel(entry, snapshot.model), lifecycle: entry.lifecycle }));
  }

  async referenceModels(): Promise<{ ref: ContentRecordRef; label: string; providerLabel: string }[]> {
    const results = await Promise.allSettled(this.providers.map(async (provider) => ({ provider, models: await provider.store.listModels() })));
    return results.flatMap((result) => result.status === "fulfilled" ? result.value.models.map((model) => ({ ref: { providerId: result.value.provider.descriptor.id, recordId: model.id }, label: model.name, providerLabel: result.value.provider.descriptor.label })) : []);
  }

  async mediaAssets(): Promise<{ providerId: string; assetId: string; label: string }[]> {
    if (!this.mediaProvider) throw new Error("The Media provider is unavailable. Open Media after connecting a provider.");
    const assets = await this.mediaProvider.store.list();
    return assets.filter((asset) => asset.state === "active").map((asset) => ({ providerId: this.mediaProvider!.descriptor.id, assetId: asset.id, label: asset.fileName }));
  }

  async applyInverse(inverseId: string, selectedOwnerIds: readonly string[]): Promise<void> {
    const model = this.requireModel(), target = this.current.entry;
    if (!target) throw new Error("No Entry is open.");
    const inverse = model.document.presentation?.inverses.find((item) => item.id === inverseId);
    if (!inverse) throw new Error("Inverse relationship is unavailable.");
    await this.flushSessions();
    const read = await readContentGraph(this.providers.map((provider) => provider.store));
    if (read.status !== "ready") throw new Error(read.message);
    const ownerSnapshot = read.snapshots.find((snapshot) => snapshot.providerId === inverse.source.providerId);
    const ownerStore = this.providers.find((provider) => provider.descriptor.id === inverse.source.providerId)?.store;
    if (!ownerSnapshot || !ownerStore) throw new Error("The inverse relationship owner provider is unavailable.");
    const owners = ownerSnapshot.entries.filter((entry) => entry.modelId === inverse.source.recordId);
    const targetRef = { providerId: this.provider.descriptor.id, modelId: model.id, recordId: target.id };
    const edits = owners.flatMap((owner) => {
      const field = ownerSnapshot.models.find((item) => item.id === owner.modelId)?.document.fields.find((item) => item.id === inverse.fieldId);
      if (!field || (field.kind !== "reference" && field.kind !== "reference-list")) throw new Error("The inverse owning field is unavailable.");
      const selected = selectedOwnerIds.includes(owner.id);
      const current = field.kind === "reference" ? (owner.values[field.id] ? [owner.values[field.id] as unknown as ContentEntryRef] : []) : (owner.values[field.id] ?? []) as unknown as ContentEntryRef[];
      const wasSelected = current.some((ref) => ref.providerId === targetRef.providerId && ref.modelId === targetRef.modelId && ref.recordId === targetRef.recordId);
      if (wasSelected === selected) return [];
      const targets = selected ? [...current.filter((ref) => ref.recordId !== target.id), targetRef] : current.filter((ref) => ref.recordId !== target.id);
      return [{ owner: { providerId: inverse.source.providerId, modelId: inverse.source.recordId, recordId: owner.id }, fieldId: inverse.fieldId, targets }];
    });
    if (edits.length === 0) return;
    await applyContentInverseMutation(ownerStore, read.snapshots, edits);
    await this.refreshGraph(target);
  }

  async requestUnpublish(): Promise<void> {
    const entry = this.current.entry;
    if (!entry) throw new Error("No Entry is open.");
    if (entry.lifecycle === "draft") return;
    await this.flushSessions();
    const snapshot = await this.provider.store.readAll();
    await this.provider.store.transact({ expectedMutationToken: snapshot.mutationToken, operations: [{ kind: "unpublish-entry", id: entry.id }] });
    await this.reloadEntries();
    await this.openEntry(entry.id);
  }

  async deleteEntry(id: string): Promise<void> {
    if (this.current.entry?.id === id && this.entryQueue) {
      const queue = this.entryQueue;
      await queue.flush();
      this.unsubscribeEntry?.(); this.unsubscribeEntry = null;
      this.entryQueue = null;
      await queue.close();
    }
    await this.provider.store.deleteEntry(id);
    const model = this.current.model;
    const snapshot = model ? await this.provider.store.scanEntries(model.id) : null;
    this.set({ ...this.current, entries: this.current.entries.filter((entry) => entry.id !== id), entry: this.current.entry?.id === id ? null : this.current.entry,
      usedFieldIds: snapshot ? usedFields(snapshot.entries) : this.current.usedFieldIds,
      entryCounts: model ? { ...this.current.entryCounts, [model.id]: Math.max(0, (this.current.entryCounts[model.id] ?? 1) - 1) } : this.current.entryCounts,
      incompleteCounts: model && snapshot ? { ...this.current.incompleteCounts, [model.id]: incompleteEntryCount(model, snapshot.entries) } : this.current.incompleteCounts,
      message: "Entry deleted." });
  }

  async deleteModel(id: string): Promise<void> {
    if (this.current.model?.id === id) { await this.flushSessions(); await this.closeQueues(); }
    await this.provider.store.deleteModel(id); await this.refreshModels();
    const entryCounts = { ...this.current.entryCounts }; delete entryCounts[id];
    const incompleteCounts = { ...this.current.incompleteCounts }; delete incompleteCounts[id];
    const deletingCurrentModel = this.current.model?.id === id;
    this.set({ ...this.current, entryCounts, incompleteCounts, model: deletingCurrentModel ? null : this.current.model, entries: deletingCurrentModel ? [] : this.current.entries, usedFieldIds: deletingCurrentModel ? [] : this.current.usedFieldIds, entry: deletingCurrentModel ? null : this.current.entry, workMode: "entries", message: "Model and its Entries deleted." });
  }

  retrySave(): void { (this.entryQueue ?? this.modelQueue)?.retry(); }
  async flushSessions(): Promise<void> { await this.entryQueue?.flush(); await this.modelQueue?.flush(); }

  completeness(entry = this.current.entry) { return entry && this.current.model ? diagnoseContentEntryCompleteness(this.current.model, entry) : []; }

  private async runInitialization(load: () => Promise<ContentInitializationOutcome>): Promise<void> {
    this.scanGeneration += 1;
    this.set({ ...this.current, phase: "loading", message: "Loading Content library…" });
    try {
      const outcome = await load();
      if (outcome.status === "ready") {
        const counts = await Promise.all(outcome.models.map(async (model) => [model.id, await this.provider.store.countEntries(model.id)] as const));
        const descriptions = await this.loadModelDescriptions(outcome.models);
        this.set({ ...initialState, providerId: this.provider.descriptor.id, providerLabel: this.provider.descriptor.label, phase: "ready", models: outcome.models, modelDescriptions: descriptions, entryCounts: Object.fromEntries(counts), message: "Content library ready." });
        void this.sweepIncompleteCounts(outcome.models);
      }
      else if (outcome.status === "recovery-required") this.set({ ...initialState, providerId: this.provider.descriptor.id, providerLabel: this.provider.descriptor.label, phase: "recovery", models: outcome.models, recoveryMessage: outcome.recovery.message, message: "Recovery required. Source data was preserved." });
      else this.set({ ...initialState, providerId: this.provider.descriptor.id, providerLabel: this.provider.descriptor.label, phase: "error", message: outcome.error.message });
    } catch (reason) {
      this.set({ ...initialState, providerId: this.provider.descriptor.id, providerLabel: this.provider.descriptor.label, phase: "error", message: reason instanceof Error ? reason.message : "Content library initialization failed." });
    }
  }
  private installModelQueue(record: ContentModelRecord): void {
    this.unsubscribeModel?.(); void this.modelQueue?.close();
    this.modelQueue = createSaveQueue({ ref: { providerId: this.provider.descriptor.id, recordId: record.id }, initialRecord: record,
      write: ({ record: draft }) => this.provider.store.putModel(draft) });
    this.unsubscribeModel = this.subscribeQueue(this.modelQueue);
  }
  private async closeQueues(): Promise<void> {
    const entryQueue = this.entryQueue;
    const modelQueue = this.modelQueue;
    this.unsubscribeEntry?.(); this.unsubscribeEntry = null;
    this.unsubscribeModel?.(); this.unsubscribeModel = null;
    this.entryQueue = null;
    this.modelQueue = null;
    await entryQueue?.close(); await modelQueue?.close();
  }

  /**
   * Queue subscriptions deliver `saved` immediately for revision zero. That
   * initial delivery is a load acknowledgement, not an authored save, so the
   * Content route exposes it as pristine. Every later queue transition keeps
   * the normal saved/dirty/saving/error vocabulary.
   */
  private subscribeQueue<TRecord extends ContentModelRecord | ContentEntryRecord>(queue: SaveQueue<TRecord>): () => void {
    let initial = true;
    return queue.subscribe((state) => {
      if (initial) {
        initial = false;
        this.set({ ...this.current, saveStatus: "pristine" });
        return;
      }
      this.set({ ...this.current, saveStatus: queueStatus(state),
        message: state.status === "error" ? state.error.message : state.status === "saved" ? "All changes saved." : state.status === "saving" ? "Saving changes…" : "Unsaved changes." });
    });
  }
  /**
   * Fill in the navigator's warn dots after the library is already usable.
   *
   * Counting Entries is an index count; deciding whether any of them is
   * incomplete means reading them all, so this runs model by model *after*
   * `phase: "ready"` rather than holding the route behind a full scan. It is
   * best effort in both directions: a stale sweep stops as soon as the library
   * reloads under it, and a model that cannot be scanned simply keeps no dot
   * instead of failing the route the way a blocking scan would.
   */
  private async sweepIncompleteCounts(models: readonly ContentModelSummary[]): Promise<void> {
    const generation = this.scanGeneration;
    for (const summary of models) {
      // Opening a model and editing an Entry both keep an exact tally, so a
      // model that already has one is skipped — checked again after the scan,
      // because an author can open a model while this loop is awaiting.
      if (this.current.incompleteCounts[summary.id] !== undefined) continue;
      let count: number;
      try {
        const snapshot = await this.provider.store.scanEntries(summary.id);
        count = incompleteEntryCount(snapshot.model, snapshot.entries);
      } catch { continue; }
      if (generation !== this.scanGeneration) return;
      if (this.current.incompleteCounts[summary.id] !== undefined) continue;
      this.set({ ...this.current, incompleteCounts: { ...this.current.incompleteCounts, [summary.id]: count } });
    }
  }

  /** Records a freshly stored Entry in the open model's list and its counts. */
  private admitEntry(model: ContentModelRecord, entry: ContentEntryRecord): void {
    this.set({
      ...this.current,
      entries: [entry, ...this.current.entries],
      entryCounts: { ...this.current.entryCounts, [model.id]: (this.current.entryCounts[model.id] ?? 0) + 1 },
      ...(diagnoseContentEntryCompleteness(model, entry).length > 0
        ? { incompleteCounts: shiftCount(this.current.incompleteCounts, model.id, 1) }
        : {}),
    });
  }

  private requireModel(): ContentModelRecord { if (!this.current.model) throw new Error("No Content model is open."); return this.current.model; }
  private uniqueFieldKey(base: string): string { const keys = new Set(this.requireModel().document.fields.map((field) => field.key)); let key = base; let i = 2; while (keys.has(key)) key = `${base}${i++}`; return key; }
  private async refreshModels(): Promise<void> { const models = await this.provider.store.listModels(); const counts = await Promise.all(models.map(async (model) => [model.id, await this.provider.store.countEntries(model.id)] as const)); this.set({ ...this.current, models, modelDescriptions: await this.loadModelDescriptions(models), entryCounts: Object.fromEntries(counts) }); }
  private async loadModelDescriptions(models: readonly ContentModelSummary[]): Promise<Record<string, string>> {
    const pairs = await Promise.all(models.map(async (summary) => { const result = await this.provider.store.getModel(summary.id); return [summary.id, result.status === "loaded" ? result.record.document.description : ""] as const; }));
    return Object.fromEntries(pairs);
  }
  private async refreshGraph(entry: ContentEntryRecord): Promise<void> {
    const read = await readContentGraph(this.providers.map((provider) => provider.store));
    if (this.current.entry?.id !== entry.id) return;
    if (read.status !== "ready") { this.set({ ...this.current, graphStatus: "unavailable", graphMessage: read.message, snapshots: [], incoming: [] }); return; }
    const ref = { providerId: this.provider.descriptor.id, modelId: entry.modelId, recordId: entry.id };
    this.set({ ...this.current, graphStatus: read.index.complete ? "ready" : "unavailable", graphMessage: read.index.complete ? "" : "Some providers or records could not be resolved.", snapshots: read.snapshots, incoming: read.index.incoming(ref).map(({ owner, ordered }) => ({ owner, ordered })) });
  }
  private async refreshPublication(entry: ContentEntryRecord): Promise<void> {
    if (!this.loadActivatedBaseline) return;
    try {
      const snapshots = await this.loadActivatedBaseline();
      if (this.current.entry?.id !== entry.id) return;
      this.baselineEntry = snapshots.find((snapshot) => snapshot.providerId === this.provider.descriptor.id)?.entries.find((candidate) => candidate.id === entry.id && candidate.modelId === entry.modelId) ?? null;
      this.set({ ...this.current, publicationState: this.publicationState(this.current.entry) });
    } catch { /* An unavailable release baseline cannot justify a pending-change claim. */ }
  }
  private publicationState(entry: ContentEntryRecord): ContentAuthoringState["publicationState"] {
    if (entry.lifecycle === "draft") return "draft";
    return this.baselineEntry && contentEntryDigest(this.baselineEntry) !== contentEntryDigest(entry) ? "published-pending" : "published";
  }
  private set(state: ContentAuthoringState): void { this.current = state; for (const listener of [...this.listeners]) listener(state); }
}

function usedFields(entries: readonly ContentEntryRecord[]): string[] {
  return [...new Set(entries.flatMap((entry) => Object.keys(entry.values)))].sort();
}

function incompleteEntryCount(model: ContentModelRecord, entries: readonly ContentEntryRecord[]): number {
  return entries.reduce((total, entry) => total + Number(diagnoseContentEntryCompleteness(model, entry).length > 0), 0);
}

/** Moves one model's tally by an exactly known delta, clamped at zero. */
function shiftCount(counts: Readonly<Record<string, number>>, modelId: string, delta: number): Record<string, number> {
  return { ...counts, [modelId]: Math.max(0, (counts[modelId] ?? 0) + delta) };
}

export function createContentAuthoringController(provider: ContentProvider, options?: { idFactory?: IdFactory; now?: () => string; providers?: readonly ContentProvider[]; mediaProvider?: ContentMediaCatalogSource; loadActivatedBaseline?: () => Promise<readonly ContentSnapshot[]> }): ContentAuthoringController {
  return new ContentAuthoringController(provider, options);
}

function entryLabel(entry: ContentEntryRecord, model: ContentModelRecord): string {
  const preferred = model.document.fields.find((field) => field.kind === "text" && (field.key === "title" || field.key === "name")) ?? model.document.fields.find((field) => field.kind === "text");
  const value = preferred && entry.values[preferred.id];
  return typeof value === "string" && value.trim() ? value : `Untitled Entry · ${entry.id}`;
}
