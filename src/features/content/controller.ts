import {
  CONTENT_FIELD_KINDS,
  createContentEntryRecord,
  createContentModelRecord,
  diagnoseContentEntryCompleteness,
  type ContentEntryRecord,
  type ContentFieldDefinition,
  type ContentFieldKind,
  type ContentInitializationOutcome,
  type ContentModelKind,
  type ContentModelRecord,
  type ContentModelSummary,
  type ContentProvider,
} from "../../content";
import { createUuidIdFactory, type IdFactory } from "../../shared";
import { createSaveQueue, type SaveQueue, type SaveQueueState } from "../../shared/persistence";

export const CONTENT_ENTRY_PAGE_SIZE = 25;
export type ContentWorkMode = "entries" | "model-fields";
export type ContentSaveStatus = "saved" | "dirty" | "saving" | "error";

export interface ContentAuthoringState {
  phase: "idle" | "loading" | "ready" | "recovery" | "error";
  models: readonly ContentModelSummary[];
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
}

const initialState: ContentAuthoringState = {
  phase: "idle", models: [], entryCounts: {}, incompleteCounts: {}, model: null, entries: [], usedFieldIds: [], entry: null,
  workMode: "entries", saveStatus: "saved", message: "", recoveryMessage: null,
};

function queueStatus(state: SaveQueueState<ContentModelRecord> | SaveQueueState<ContentEntryRecord>): ContentSaveStatus {
  return state.status;
}

export class ContentAuthoringController {
  private current: ContentAuthoringState = initialState;
  private readonly listeners = new Set<(state: ContentAuthoringState) => void>();
  private readonly idFactory: IdFactory;
  private readonly now: () => string;
  private modelQueue: SaveQueue<ContentModelRecord> | null = null;
  private entryQueue: SaveQueue<ContentEntryRecord> | null = null;
  private unsubscribeModel: (() => void) | null = null;
  private unsubscribeEntry: (() => void) | null = null;
  /** Invalidates an in-flight completeness sweep when the library reloads under it. */
  private scanGeneration = 0;

  constructor(readonly provider: ContentProvider, options: { idFactory?: IdFactory; now?: () => string } = {}) {
    this.idFactory = options.idFactory ?? createUuidIdFactory();
    this.now = options.now ?? (() => new Date().toISOString());
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
    this.set({ ...this.current, phase: "ready", model: outcome.record, entries: page.entries, entry: null,
      usedFieldIds: usedFields(snapshot.entries), nextCursor: page.nextCursor, workMode: "entries", message: "Model loaded.",
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
    if (this.entryQueue) { await this.entryQueue.close(); this.unsubscribeEntry?.(); this.entryQueue = null; this.unsubscribeEntry = null; }
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
    const field: ContentFieldDefinition = { id: this.idFactory("content-field"), key: this.uniqueFieldKey("field"), label: "New field", required: false, kind };
    this.updateModel((record) => ({ ...record, document: { ...record.document, fields: [...record.document.fields, field] } }));
  }

  updateField(fieldId: string, patch: Partial<Pick<ContentFieldDefinition, "key" | "label" | "required" | "kind">>): void {
    const model = this.requireModel();
    const old = model.document.fields.find((field) => field.id === fieldId);
    if (!old) throw new Error("Content field was not found.");
    if (patch.kind && patch.kind !== old.kind && this.current.usedFieldIds.includes(fieldId)) {
      throw new Error("Field kind cannot change while stored Entries use this field.");
    }
    this.updateModel((record) => ({ ...record, document: { ...record.document, fields: record.document.fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field) } }));
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
    await this.entryQueue?.close(); this.entryQueue = null; this.unsubscribeEntry?.(); this.unsubscribeEntry = null;
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
    if (this.entryQueue) { await this.entryQueue.flush(); await this.entryQueue.close(); this.unsubscribeEntry?.(); }
    const outcome = await this.provider.store.getEntry(id);
    if (outcome.status !== "loaded") throw new Error(outcome.status === "not-found" ? "Entry was not found." : "This Entry is unreadable and has been preserved.");
    this.entryQueue = createSaveQueue({ ref: { providerId: this.provider.descriptor.id, recordId: outcome.record.id }, initialRecord: outcome.record,
      write: ({ record }) => this.provider.store.putEntry(record) });
    this.unsubscribeEntry = this.entryQueue.subscribe((state) => this.set({ ...this.current, saveStatus: queueStatus(state),
      message: state.status === "error" ? state.error.message : state.status === "saved" ? "All changes saved." : state.status === "saving" ? "Saving changes…" : "Unsaved changes." }));
    this.set({ ...this.current, entry: outcome.record, workMode: "entries" });
  }

  async inspectSchema(): Promise<void> {
    if (this.entryQueue) { await this.entryQueue.flush(); await this.entryQueue.close(); this.unsubscribeEntry?.(); }
    this.entryQueue = null; this.unsubscribeEntry = null;
    this.set({ ...this.current, entry: null, workMode: "model-fields", message: "Model fields ready." });
  }

  browseEntries(): void {
    this.set({ ...this.current, workMode: "entries", message: "Entries ready." });
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
    this.set({ ...this.current, entry: updated, entries: this.current.entries.map((item) => item.id === updated.id ? updated : item),
      ...(model && delta !== 0 ? { incompleteCounts: shiftCount(this.current.incompleteCounts, model.id, delta) } : {}),
      usedFieldIds: value === undefined || value === "" ? this.current.usedFieldIds : [...new Set([...this.current.usedFieldIds, fieldId])] });
  }

  async deleteEntry(id: string): Promise<void> {
    if (this.current.entry?.id === id && this.entryQueue) { await this.entryQueue.flush(); await this.entryQueue.close(); this.entryQueue = null; this.unsubscribeEntry?.(); }
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
        this.set({ ...initialState, phase: "ready", models: outcome.models, entryCounts: Object.fromEntries(counts), message: "Content library ready." });
        void this.sweepIncompleteCounts(outcome.models);
      }
      else if (outcome.status === "recovery-required") this.set({ ...initialState, phase: "recovery", models: outcome.models, recoveryMessage: outcome.recovery.message, message: "Recovery required. Source data was preserved." });
      else this.set({ ...initialState, phase: "error", message: outcome.error.message });
    } catch (reason) {
      this.set({ ...initialState, phase: "error", message: reason instanceof Error ? reason.message : "Content library initialization failed." });
    }
  }
  private installModelQueue(record: ContentModelRecord): void {
    this.unsubscribeModel?.(); void this.modelQueue?.close();
    this.modelQueue = createSaveQueue({ ref: { providerId: this.provider.descriptor.id, recordId: record.id }, initialRecord: record,
      write: ({ record: draft }) => this.provider.store.putModel(draft) });
    this.unsubscribeModel = this.modelQueue.subscribe((state) => this.set({ ...this.current, saveStatus: queueStatus(state),
      message: state.status === "error" ? state.error.message : state.status === "saved" ? "All changes saved." : state.status === "saving" ? "Saving changes…" : "Unsaved changes." }));
  }
  private async closeQueues(): Promise<void> {
    await this.entryQueue?.close(); await this.modelQueue?.close(); this.unsubscribeEntry?.(); this.unsubscribeModel?.();
    this.entryQueue = null; this.modelQueue = null; this.unsubscribeEntry = null; this.unsubscribeModel = null;
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
  private async refreshModels(): Promise<void> { const models = await this.provider.store.listModels(); const counts = await Promise.all(models.map(async (model) => [model.id, await this.provider.store.countEntries(model.id)] as const)); this.set({ ...this.current, models, entryCounts: Object.fromEntries(counts) }); }
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

export function createContentAuthoringController(provider: ContentProvider, options?: { idFactory?: IdFactory; now?: () => string }): ContentAuthoringController {
  return new ContentAuthoringController(provider, options);
}
