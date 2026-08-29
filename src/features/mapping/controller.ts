import type { ComponentCatalog, CompositionDocument } from "../../composer/model/types";
import type { ContentCatalog, ContentCatalogEntry, ContentEntryRecord, ContentEntrySnapshot, ContentModelRecord } from "../../content";
import {
  createMappingRecord,
  evaluateMapping,
  isMappingCompatible,
  resolveMappingDefinition,
  type CompositionCatalog,
  type CompositionCatalogEntry,
  type MappingBinding,
  type MappingDefinitionResolution,
  type MappingEvaluationResult,
  type MappingProvider,
  type MappingRecord,
  type MappingSummary,
  type MappingTarget,
  type MappingTargetDescriptor,
  type MappingTransform,
} from "../../mapping";
import { createUuidIdFactory, type IdFactory } from "../../shared";

export type MappingPane = "source" | "bindings" | "preview";
export type MappingSaveStatus = "saved" | "dirty" | "saving" | "error";

export interface MappingUsage { mappingId: string; sitemapNames: readonly string[] }
export interface MappingLibraryDetail { record: MappingRecord; definition: MappingDefinitionResolution }
export type MappingContentSnapshotOutcome =
  | { status: "resolved"; snapshot: ContentEntrySnapshot }
  | { status: "not-found" }
  | { status: "invalid"; reason: string }
  | { status: "provider-error"; reason: string };
export type MappingContentEntryOutcome =
  | { status: "resolved"; entry: ContentEntryRecord }
  | { status: "not-found" }
  | { status: "invalid"; reason: string }
  | { status: "provider-error"; reason: string };
export interface MappingContentEntryCatalog {
  scan(ref: ContentCatalogEntry["ref"]): Promise<MappingContentSnapshotOutcome>;
  get(ref: ContentCatalogEntry["ref"], entryId: string): Promise<MappingContentEntryOutcome>;
}

export interface MappingEditorState {
  phase: "idle" | "loading" | "ready" | "recovery" | "error";
  mappings: readonly MappingSummary[];
  libraryDetails: Readonly<Record<string, MappingLibraryDetail>>;
  contentModels: readonly ContentCatalogEntry[];
  compositions: readonly CompositionCatalogEntry[];
  catalogFailures: readonly string[];
  mapping: MappingRecord | null;
  definition: MappingDefinitionResolution | null;
  entries: readonly ContentEntryRecord[];
  entryFailure: string | null;
  entry: ContentEntryRecord | null;
  evaluation: MappingEvaluationResult | null;
  previewDocument: CompositionDocument | null;
  previewStatus: "empty" | "loading" | "current" | "error";
  activePane: MappingPane;
  saveStatus: MappingSaveStatus;
  message: string;
  recoveryMessage: string | null;
}

const initialState: MappingEditorState = {
  phase: "idle", mappings: [], libraryDetails: {}, contentModels: [], compositions: [], catalogFailures: [], mapping: null,
  definition: null, entries: [], entryFailure: null, entry: null, evaluation: null, previewDocument: null,
  previewStatus: "empty", activePane: "source", saveStatus: "saved", message: "", recoveryMessage: null,
};

export interface MappingEditorControllerOptions {
  idFactory?: IdFactory;
  now?: () => string;
}

export function compatibleTransforms(sourceKind: ContentModelRecord["document"]["fields"][number]["kind"], target: MappingTargetDescriptor): readonly MappingTransform["kind"][] {
  const candidates: readonly MappingTransform[] = [
    { kind: "identity" }, { kind: "date-medium" }, { kind: "truncate-160" }, { kind: "prefix", prefix: "" },
  ];
  return candidates.filter((transform) => isMappingCompatible(sourceKind, target.kind, transform)).map((transform) => transform.kind);
}

export class MappingEditorController {
  private current: MappingEditorState = initialState;
  private readonly listeners = new Set<(state: MappingEditorState) => void>();
  private readonly idFactory: IdFactory;
  private readonly now: () => string;
  private refreshRevision = 0;

  constructor(
    readonly provider: MappingProvider,
    readonly catalogs: { content: ContentCatalog; compositions: CompositionCatalog },
    readonly contentEntries: MappingContentEntryCatalog,
    readonly manifest: ComponentCatalog,
    options: MappingEditorControllerOptions = {},
  ) {
    this.idFactory = options.idFactory ?? createUuidIdFactory();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get state(): MappingEditorState { return this.current; }
  subscribe(listener: (state: MappingEditorState) => void): () => void {
    this.listeners.add(listener); listener(this.current); return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> { await this.runInitialization(() => this.provider.initialization.initialize()); }
  async retryInitialization(): Promise<void> { await this.runInitialization(() => this.provider.initialization.retry()); }
  async startFresh(): Promise<void> { await this.runInitialization(() => this.provider.initialization.startFresh()); }

  async create(name: string, contentModel: ContentCatalogEntry["ref"], composition: CompositionCatalogEntry["ref"]): Promise<void> {
    const trimmed = name.trim(); if (!trimmed) throw new Error("Mapping name is required.");
    await this.flush();
    const timestamp = this.now();
    const record = createMappingRecord({ id: this.idFactory("mapping"), name: trimmed, contentModel, composition, createdAt: timestamp });
    await this.provider.store.put(record);
    await this.refreshLibrary();
    await this.open(record.id);
  }

  async open(id: string): Promise<void> {
    if (this.current.mapping?.id === id) return;
    await this.flush();
    const outcome = await this.provider.store.get(id);
    if (outcome.status !== "loaded") throw new Error(outcome.status === "not-found" ? "Mapping was not found." : "This Mapping is unreadable and has been preserved.");
    this.set({ ...this.current, mapping: outcome.record, definition: null, entries: [], entryFailure: null, entry: null, evaluation: null, previewDocument: null, previewStatus: "loading", activePane: "source", saveStatus: "saved", message: "Mapping loaded." });
    await this.refreshResolution();
  }

  async close(): Promise<void> { await this.flush(); this.refreshRevision += 1; this.set({ ...this.current, mapping: null, definition: null, entries: [], entryFailure: null, entry: null, evaluation: null, previewDocument: null, previewStatus: "empty", activePane: "source", message: "Mapping library ready." }); }

  async delete(id: string): Promise<void> {
    await this.flush(); await this.provider.store.delete(id); await this.refreshLibrary();
    if (this.current.mapping?.id === id) await this.close();
    this.set({ ...this.current, message: "Mapping deleted." });
  }

  rename(name: string): void { if (name.trim()) this.edit((record) => ({ ...record, document: { ...record.document, name } })); }

  async selectContentModel(ref: ContentCatalogEntry["ref"]): Promise<void> {
    this.edit((record) => ({ ...record, document: { ...record.document, contentModel: { ...ref } } }));
    await this.refreshResolution();
  }

  async selectComposition(ref: CompositionCatalogEntry["ref"]): Promise<void> {
    this.edit((record) => ({ ...record, document: { ...record.document, composition: { ...ref } } }));
    await this.refreshResolution();
  }

  async addBinding(sourceFieldId: string, target: MappingTarget): Promise<void> {
    const definition = this.current.definition;
    const source = definition?.contentModel?.document.fields.find((field) => field.id === sourceFieldId);
    const descriptor = definition?.targets.find((item) => item.target.nodeId === target.nodeId && item.target.prop === target.prop);
    if (!source || !descriptor) throw new Error("Choose a current source and target field.");
    const kind = compatibleTransforms(source.kind, descriptor)[0];
    if (!kind) throw new Error(`${source.kind} is not compatible with ${descriptor.kind}.`);
    const transform: MappingTransform = kind === "prefix" ? { kind, prefix: "" } : { kind };
    const binding: MappingBinding = { id: this.idFactory("binding"), sourceFieldId, target: { ...target }, transform };
    this.edit((record) => ({ ...record, document: { ...record.document, bindings: [...record.document.bindings, binding] } }));
    await this.refreshResolution();
  }

  async updateBinding(bindingId: string, patch: Partial<Pick<MappingBinding, "sourceFieldId" | "target" | "transform">>): Promise<void> {
    this.edit((record) => ({ ...record, document: { ...record.document, bindings: record.document.bindings.map((binding) => binding.id === bindingId ? { ...binding, ...patch, ...(patch.target ? { target: { ...patch.target } } : {}), ...(patch.transform ? { transform: { ...patch.transform } } : {}) } : binding) } }));
    await this.refreshResolution();
  }

  async moveBinding(bindingId: string, direction: -1 | 1): Promise<void> {
    const record = this.requireMapping(); const index = record.document.bindings.findIndex((binding) => binding.id === bindingId); const next = index + direction;
    if (index < 0 || next < 0 || next >= record.document.bindings.length) return;
    const bindings = [...record.document.bindings]; [bindings[index], bindings[next]] = [bindings[next]!, bindings[index]!];
    this.edit((item) => ({ ...item, document: { ...item.document, bindings } })); await this.refreshResolution();
  }

  async removeBinding(bindingId: string): Promise<void> {
    this.edit((record) => ({ ...record, document: { ...record.document, bindings: record.document.bindings.filter((binding) => binding.id !== bindingId) } })); await this.refreshResolution();
  }

  async selectEntry(id: string): Promise<void> {
    const entry = this.current.entries.find((item) => item.id === id) ?? await this.loadEntry(id);
    const revision = ++this.refreshRevision;
    this.set({ ...this.current, entry, evaluation: null, previewStatus: "loading", message: "Testing sample Entry…" });
    await this.evaluateCurrent(entry, revision);
  }

  async testDefinition(): Promise<void> { await this.refreshResolution(); }
  setActivePane(activePane: MappingPane): void { this.set({ ...this.current, activePane }); }
  setPreviewError(message: string): void { this.set({ ...this.current, previewStatus: "error", message }); }
  setPreviewCurrent(): void { if (this.current.previewDocument) this.set({ ...this.current, previewStatus: "current", message: "Preview is current." }); }

  async flush(): Promise<void> {
    const record = this.current.mapping; if (!record || this.current.saveStatus === "saved") return;
    this.set({ ...this.current, saveStatus: "saving", message: "Saving Mapping…" });
    try { await this.provider.store.put(record); await this.refreshLibrary(); this.set({ ...this.current, saveStatus: "saved", message: "All changes saved." }); }
    catch (reason) { this.set({ ...this.current, saveStatus: "error", message: reason instanceof Error ? reason.message : "Mapping save failed." }); throw reason; }
  }

  async retrySave(): Promise<void> { if (this.current.mapping) { this.set({ ...this.current, saveStatus: "dirty" }); await this.flush(); } }

  private async runInitialization(load: () => ReturnType<MappingProvider["initialization"]["initialize"]>): Promise<void> {
    this.set({ ...initialState, phase: "loading", message: "Loading Mapping library…" });
    try {
      const [outcome, content, compositions] = await Promise.all([load(), this.catalogs.content.listModels(), this.catalogs.compositions.list()]);
      const failures = [...content.failures, ...compositions.failures].map((failure) => `${failure.providerLabel}: ${failure.reason}`);
      if (outcome.status === "ready") { this.set({ ...initialState, phase: "ready", mappings: outcome.summaries, contentModels: content.entries, compositions: compositions.entries, catalogFailures: failures, message: "Mapping library ready." }); await this.refreshLibraryDetails(); }
      else if (outcome.status === "recovery-required") this.set({ ...initialState, phase: "recovery", mappings: outcome.summaries, contentModels: content.entries, compositions: compositions.entries, catalogFailures: failures, recoveryMessage: outcome.recovery.message, message: "Recovery required. Source data was preserved." });
      else this.set({ ...initialState, phase: "error", contentModels: content.entries, compositions: compositions.entries, catalogFailures: failures, message: outcome.error.message });
    } catch (reason) { this.set({ ...initialState, phase: "error", message: reason instanceof Error ? reason.message : "Mapping initialization failed." }); }
  }

  private edit(change: (record: MappingRecord) => MappingRecord): void {
    const updated = { ...change(this.requireMapping()), updatedAt: this.now() };
    this.set({ ...this.current, mapping: updated, saveStatus: "dirty", message: "Unsaved Mapping changes." });
  }

  private async refreshResolution(): Promise<void> {
    const mapping = this.requireMapping(); const revision = ++this.refreshRevision;
    this.set({ ...this.current, previewStatus: "loading", message: "Checking Mapping readiness…" });
    const definition = await resolveMappingDefinition(mapping, this.catalogs, this.manifest);
    if (revision !== this.refreshRevision) return;
    let entries: readonly ContentEntryRecord[] = []; let entryFailure: string | null = null;
    if (definition.contentModel) {
      const outcome = await this.contentEntries.scan(mapping.document.contentModel);
      if (outcome.status === "resolved") entries = outcome.snapshot.entries;
      else entryFailure = outcome.status === "not-found" ? "The selected Content model was not found." : outcome.reason;
    }
    if (revision !== this.refreshRevision) return;
    const selected = entries.find((entry) => entry.id === this.current.entry?.id) ?? entries[0] ?? null;
    this.set({ ...this.current, definition, entries, entryFailure, entry: selected, evaluation: null, previewDocument: definition.composition?.document ?? null, previewStatus: definition.composition ? "loading" : "empty", message: entryFailure ? `Entry provider unavailable: ${entryFailure}` : definition.status === "ready" ? "Mapping definition is ready." : `${definition.diagnostics.length} readiness issue${definition.diagnostics.length === 1 ? "" : "s"}.` });
    if (selected) await this.evaluateCurrent(selected, revision);
  }

  private async evaluateCurrent(entry: ContentEntryRecord, expectedRevision = this.refreshRevision): Promise<void> {
    const mapping = this.requireMapping(); const evaluation = await evaluateMapping(mapping, entry, this.catalogs, this.manifest);
    if (expectedRevision !== this.refreshRevision) return;
    this.set({ ...this.current, evaluation, previewDocument: evaluation.document ?? null, previewStatus: evaluation.document ? "loading" : "empty", message: evaluation.status === "ready" ? `Entry test passed. ${evaluation.appliedBindingCount} binding${evaluation.appliedBindingCount === 1 ? "" : "s"} applied.` : "Entry test found blocking diagnostics." });
  }

  private async loadEntry(id: string): Promise<ContentEntryRecord> {
    const outcome = await this.contentEntries.get(this.requireMapping().document.contentModel, id);
    if (outcome.status === "resolved") return outcome.entry;
    throw new Error(outcome.status === "not-found" ? "Sample Entry could not be found in the selected Content provider." : outcome.reason);
  }
  private async refreshLibrary(): Promise<void> { this.set({ ...this.current, mappings: await this.provider.store.list() }); await this.refreshLibraryDetails(); }
  private async refreshLibraryDetails(): Promise<void> {
    const details: Record<string, MappingLibraryDetail> = {};
    await Promise.all(this.current.mappings.map(async (summary) => {
      const outcome = await this.provider.store.get(summary.id); if (outcome.status !== "loaded") return;
      details[summary.id] = { record: outcome.record, definition: await resolveMappingDefinition(outcome.record, this.catalogs, this.manifest) };
    }));
    this.set({ ...this.current, libraryDetails: details });
  }
  private requireMapping(): MappingRecord { if (!this.current.mapping) throw new Error("No Mapping is open."); return this.current.mapping; }
  private set(state: MappingEditorState): void { this.current = state; for (const listener of [...this.listeners]) listener(state); }
}

export function createMappingEditorController(
  provider: MappingProvider,
  catalogs: { content: ContentCatalog; compositions: CompositionCatalog },
  contentEntries: MappingContentEntryCatalog,
  manifest: ComponentCatalog,
  options?: MappingEditorControllerOptions,
): MappingEditorController { return new MappingEditorController(provider, catalogs, contentEntries, manifest, options); }
