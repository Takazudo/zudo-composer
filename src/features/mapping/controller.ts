import type { ComponentCatalog, CompositionDocument } from "../../composer/model/types";
import type { ContentCatalog, ContentCatalogEntry, ContentEntryRecord, ContentEntrySnapshot, ContentModelRecord } from "../../content";
import {
  createMappingRecord,
  evaluateCollectionQuery,
  evaluateResolvedMapping,
  evaluateMapping,
  isMappingCompatible,
  resolveMappingDefinition,
  type CompositionCatalog,
  type CompositionCatalogEntry,
  type MappingBinding,
  type MappingCollectionCondition,
  type MappingCollectionEvaluation,
  type MappingCollectionPin,
  type MappingCollectionQuery,
  type MappingDefinitionResolution,
  type MappingEvaluationResult,
  type MappingMode,
  type MappingProvider,
  type MappingRecord,
  type MappingSummary,
  type MappingTarget,
  type MappingTargetDescriptor,
  type MappingTransform,
} from "../../mapping";
import { cloneJson, createUuidIdFactory, isSafeRecordId, type IdFactory } from "../../shared";
import { type MappingDeepLinkRequest, type MappingDeepLinkState } from "./deep-link";
import {
  emptyMappingAttachmentState,
  type MappingAttachmentCallbacks,
  type MappingAttachmentState,
} from "./attachments";
import { materializeCollectionPreview } from "./collection-preview";
import { compatibleTransformsForProjection, sourceProjectionOptions } from "./projection-options";

export type MappingSaveStatus = "saved" | "dirty" | "saving" | "error";

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
  collectionEvaluation: MappingCollectionEvaluation | null;
  collectionEvaluations: readonly MappingEvaluationResult[];
  previewDocument: CompositionDocument | null;
  previewStatus: "empty" | "loading" | "current" | "error";
  saveStatus: MappingSaveStatus;
  message: string;
  recoveryMessage: string | null;
  attachments: MappingAttachmentState;
  deepLink?: MappingDeepLinkState;
}

const initialState: MappingEditorState = {
  phase: "idle", mappings: [], libraryDetails: {}, contentModels: [], compositions: [], catalogFailures: [], mapping: null,
  definition: null, entries: [], entryFailure: null, entry: null, evaluation: null, collectionEvaluation: null, collectionEvaluations: [], previewDocument: null,
  previewStatus: "empty", saveStatus: "saved", message: "", recoveryMessage: null,
  attachments: emptyMappingAttachmentState,
  deepLink: { status: "none" },
};

export interface MappingEditorControllerOptions {
  idFactory?: IdFactory;
  now?: () => string;
  attachments?: MappingAttachmentCallbacks;
}

function attachmentSelectionKey(attachment: { id: string; composition: { providerId: string; recordId: string }; target: { nodeId: string; slotId: string }; mapping: { providerId: string; recordId: string } }): string {
  return `${attachment.id}\u0000${attachment.composition.providerId}\u0000${attachment.composition.recordId}\u0000${attachment.target.nodeId}\u0000${attachment.target.slotId}\u0000${attachment.mapping.providerId}\u0000${attachment.mapping.recordId}`;
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
  private readonly attachmentCallbacks?: MappingAttachmentCallbacks;
  private refreshRevision = 0;
  private pendingFlush: Promise<void> | null = null;
  private attachmentListRequestRevision = 0;
  private attachmentPreviewRequestRevision = 0;

  constructor(
    readonly provider: MappingProvider,
    readonly catalogs: { content: ContentCatalog; compositions: CompositionCatalog },
    readonly contentEntries: MappingContentEntryCatalog,
    readonly manifest: ComponentCatalog,
    options: MappingEditorControllerOptions = {},
  ) {
    this.idFactory = options.idFactory ?? createUuidIdFactory();
    this.now = options.now ?? (() => new Date().toISOString());
    this.attachmentCallbacks = options.attachments;
  }

  get state(): MappingEditorState { return this.current; }
  subscribe(listener: (state: MappingEditorState) => void): () => void {
    this.listeners.add(listener); listener(this.current); return () => this.listeners.delete(listener);
  }

  async initialize(deepLink?: MappingDeepLinkRequest): Promise<void> { await this.runInitialization(() => this.provider.initialization.initialize(), deepLink); }
  async retryInitialization(): Promise<void> { await this.runInitialization(() => this.provider.initialization.retry()); }
  async startFresh(): Promise<void> {
    const attachments = this.requireAttachmentMutation("Mapping start fresh is blocked because collection attachments could not be verified.");
    await attachments.withMappingMutation(null, () => this.runInitialization(() => this.provider.initialization.startFresh()));
  }

  /** Creates the record and returns its id; the route navigates to it. */
  async create(name: string, contentModel: ContentCatalogEntry["ref"], composition: CompositionCatalogEntry["ref"]): Promise<string> {
    const trimmed = name.trim(); if (!trimmed) throw new Error("Mapping name is required.");
    await this.flush();
    const timestamp = this.now();
    const record = createMappingRecord({ id: this.idFactory("mapping"), name: trimmed, contentModel, composition, createdAt: timestamp });
    await this.requireFreshRecordId(record.id);
    await this.provider.store.put(record);
    await this.refreshLibrary();
    return record.id;
  }

  /** Copies a stored record under a fresh id and returns it. */
  async duplicate(id: string): Promise<string> {
    await this.flush();
    const outcome = await this.provider.store.get(id);
    if (outcome.status !== "loaded") throw new Error("This Mapping could not be duplicated.");
    const source = outcome.record.document;
    const duplicateId = this.idFactory(source.name);
    const timestamp = this.now();
    const record = createMappingRecord({ id: duplicateId, name: `${source.name} copy`, contentModel: source.contentModel, composition: source.composition, mode: cloneJson(source.mode), bindings: cloneJson(source.bindings), createdAt: timestamp });
    await this.requireFreshRecordId(duplicateId);
    await this.provider.store.put(record);
    await this.refreshLibrary();
    return duplicateId;
  }

  async open(id: string): Promise<void> {
    if (this.current.mapping?.id === id) return;
    await this.flush();
    const outcome = await this.provider.store.get(id);
    if (outcome.status !== "loaded") throw new Error(outcome.status === "not-found" ? "Mapping was not found." : "This Mapping is unreadable and has been preserved.");
    await this.openLoadedRecord(outcome.record);
  }

  async close(): Promise<void> { await this.flush(); this.refreshRevision += 1; this.set({ ...this.current, mapping: null, definition: null, entries: [], entryFailure: null, entry: null, evaluation: null, collectionEvaluation: null, collectionEvaluations: [], previewDocument: null, previewStatus: "empty", message: "Mapping library ready.", deepLink: { status: "none" } }); }

  /**
   * Resolve a route request against the named provider only. A provider
   * mismatch is intentionally not treated as a library lookup: opening a
   * same-named record from another provider would make a copied deep link
   * point at the wrong document.
   */
  async openDeepLink(request: MappingDeepLinkRequest): Promise<MappingDeepLinkState> {
    const loading: MappingDeepLinkState = { status: "loading", request };
    this.set({ ...this.current, deepLink: loading, message: "Opening linked Mapping…" });
    if (!isSafeRecordId(request.providerId) || !isSafeRecordId(request.mappingId)) {
      return this.finishDeepLink({ status: "invalid", message: "The Mapping link contains a malformed provider or record id." });
    }
    if (request.providerId !== this.provider.descriptor.id) {
      return this.finishDeepLink({ status: "provider-failure", request, message: `Mapping provider "${request.providerId}" is unavailable.` });
    }
    if (this.current.phase !== "ready") {
      return this.finishDeepLink({ status: "provider-failure", request, message: "The Mapping provider is not ready. Return to the library and retry." });
    }

    let outcome: Awaited<ReturnType<MappingProvider["store"]["get"]>>;
    try { outcome = await this.provider.store.get(request.mappingId); }
    catch (reason) {
      return this.finishDeepLink({ status: "provider-failure", request, message: reason instanceof Error ? reason.message : "The Mapping provider could not open this record." });
    }
    if (outcome.status === "not-found") {
      return this.finishDeepLink({ status: "missing", request, message: `Mapping record "${request.mappingId}" was not found in provider "${request.providerId}".` });
    }
    if (outcome.status !== "loaded" || outcome.record.id !== request.mappingId) {
      const detail = outcome.status === "invalid"
        ? outcome.issue.message
        : outcome.status === "future-schema"
          ? `unsupported schema version ${outcome.foundSchemaVersion}`
          : "the provider returned an unexpected record";
      return this.finishDeepLink({ status: "provider-failure", request, message: `Mapping provider "${request.providerId}" could not open "${request.mappingId}": ${detail}.` });
    }
    try { await this.openLoadedRecord(outcome.record); }
    catch (reason) {
      return this.finishDeepLink({ status: "provider-failure", request, message: reason instanceof Error ? reason.message : "The linked Mapping could not be resolved." });
    }
    return this.finishDeepLink({ status: "ready", request });
  }

  setDeepLinkOutcome(outcome: MappingDeepLinkState): void {
    if (outcome.status === "none") this.set({ ...this.current, deepLink: outcome });
    else this.finishDeepLink(outcome);
  }

  async delete(id: string): Promise<void> {
    const attachments = this.requireAttachmentMutation("Mapping deletion is blocked because collection attachments could not be verified.");
    await attachments.withMappingMutation({ providerId: this.provider.descriptor.id, recordId: id }, async () => {
      await this.flush(); await this.provider.store.delete(id); await this.refreshLibrary();
      if (this.current.mapping?.id === id) await this.close();
      this.set({ ...this.current, message: "Mapping deleted." });
    });
  }

  async clear(): Promise<void> {
    const attachments = this.requireAttachmentMutation("Clearing Mappings is blocked because collection attachments could not be verified.");
    await attachments.withMappingMutation(null, async () => {
      await this.flush();
      await this.provider.store.clear();
      await this.refreshLibrary();
      this.set({ ...this.current, phase: "ready", recoveryMessage: null, message: "Mapping library ready." });
    });
  }

  rename(name: string): void { if (name.trim()) this.edit((record) => ({ ...record, document: { ...record.document, name } })); }

  /** Switches the current Mapping between a singleton and deterministic collection query. */
  async setMode(kind: MappingMode["kind"]): Promise<void> {
    const mapping = this.requireMapping();
    if (kind === mapping.document.mode.kind) return;
    const mode: MappingMode = kind === "single"
      ? { kind: "single" }
      : { kind: "collection", query: defaultCollectionQuery() };
    const attachments = this.requireAttachmentMutation("Mapping mode changes are blocked because collection attachments could not be verified.");
    await attachments.withMappingMutation({ providerId: this.provider.descriptor.id, recordId: mapping.id }, async () => {
      this.edit((record) => ({ ...record, document: { ...record.document, mode } }));
      await this.refreshResolution();
      await this.flush();
    });
  }

  async updateCollectionQuery(change: Partial<MappingCollectionQuery> | ((query: MappingCollectionQuery) => MappingCollectionQuery)): Promise<void> {
    const mapping = this.requireMapping();
    const current = mapping.document.mode.kind === "collection" ? mapping.document.mode.query : defaultCollectionQuery();
    const next = typeof change === "function" ? change(cloneJson(current)) : { ...current, ...cloneJson(change) };
    if (!Number.isSafeInteger(next.limit) || next.limit < 1) next.limit = 1;
    if (next.limit > 1000) next.limit = 1000;
    this.edit((record) => ({ ...record, document: { ...record.document, mode: { kind: "collection", query: cloneJson(next) } } }));
    await this.refreshResolution();
  }

  async setCollectionPublication(publication: MappingCollectionQuery["publication"]): Promise<void> {
    await this.updateCollectionQuery((query) => ({ ...query, publication }));
  }

  async setCollectionLimit(limit: number): Promise<void> {
    await this.updateCollectionQuery((query) => ({ ...query, limit }));
  }

  async addCollectionCondition(condition: MappingCollectionCondition): Promise<void> {
    await this.updateCollectionQuery((query) => ({ ...query, conditions: [...query.conditions, cloneJson(condition)] }));
  }

  async updateCollectionCondition(index: number, patch: Partial<MappingCollectionCondition>): Promise<void> {
    await this.updateCollectionQuery((query) => ({
      ...query,
      conditions: query.conditions.map((condition, candidate) => candidate === index ? { ...condition, ...cloneJson(patch) } : condition),
    }));
  }

  async removeCollectionCondition(index: number): Promise<void> {
    await this.updateCollectionQuery((query) => ({ ...query, conditions: query.conditions.filter((_, candidate) => candidate !== index) }));
  }

  async addCollectionSort(sort: MappingCollectionQuery["sort"][number]): Promise<void> {
    await this.updateCollectionQuery((query) => ({ ...query, sort: [...query.sort, cloneJson(sort)] }));
  }

  async updateCollectionSort(index: number, patch: Partial<MappingCollectionQuery["sort"][number]>): Promise<void> {
    await this.updateCollectionQuery((query) => ({
      ...query,
      sort: query.sort.map((sort, candidate) => candidate === index ? { ...sort, ...cloneJson(patch) } : sort),
    }));
  }

  async removeCollectionSort(index: number): Promise<void> {
    await this.updateCollectionQuery((query) => ({ ...query, sort: query.sort.filter((_, candidate) => candidate !== index) }));
  }

  async setCollectionPins(pins: readonly MappingCollectionPin[]): Promise<void> {
    await this.updateCollectionQuery((query) => ({ ...query, pins: [...pins].map((pin) => cloneJson(pin)) }));
  }

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
    const projection = sourceProjectionOptions(source).find((candidate) => compatibleTransformsForProjection(candidate, descriptor).length > 0);
    const kind = projection ? compatibleTransformsForProjection(projection, descriptor)[0] : undefined;
    if (!projection || !kind) throw new Error(`${source.kind} is not compatible with ${descriptor.kind}.`);
    const transform: MappingTransform = kind === "prefix" ? { kind, prefix: "" } : { kind };
    const binding: MappingBinding = { id: this.idFactory("binding"), sourceFieldId, projection: cloneJson(projection.projection), target: { ...target }, transform };
    this.edit((record) => ({ ...record, document: { ...record.document, bindings: [...record.document.bindings, binding] } }));
    await this.refreshResolution();
  }

  async updateBinding(bindingId: string, patch: Partial<Pick<MappingBinding, "sourceFieldId" | "target" | "transform" | "projection">>): Promise<void> {
    this.edit((record) => ({ ...record, document: { ...record.document, bindings: record.document.bindings.map((binding) => binding.id === bindingId ? { ...binding, ...patch, ...(patch.target ? { target: { ...patch.target } } : {}), ...(patch.transform ? { transform: { ...patch.transform } } : {}) } : binding) } }));
    await this.refreshResolution();
  }

  async updateBindingProjection(bindingId: string, projection: MappingBinding["projection"]): Promise<void> {
    this.edit((record) => ({ ...record, document: { ...record.document, bindings: record.document.bindings.map((binding) => binding.id === bindingId ? { ...binding, projection: cloneJson(projection) } : binding) } }));
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
    if (this.current.mapping?.document.mode.kind === "collection" && this.current.definition && this.current.collectionEvaluation) {
      await this.evaluateCollection(this.current.definition, this.current.collectionEvaluation, revision);
    } else {
      await this.evaluateCurrent(entry, revision);
    }
  }

  async testDefinition(): Promise<void> { await this.refreshResolution(); }
  setPreviewError(message: string): void { this.set({ ...this.current, previewStatus: "error", message }); }
  setPreviewCurrent(): void { if (this.current.previewDocument) this.set({ ...this.current, previewStatus: "current", message: "Preview is current." }); }

  async flush(): Promise<void> {
    if (this.pendingFlush) return this.pendingFlush;
    const drain = async () => {
      while (this.current.mapping && this.current.saveStatus !== "saved") {
        const record = this.current.mapping;
        this.set({ ...this.current, saveStatus: "saving", message: "Saving Mapping…" });
        try {
          await this.provider.store.put(record);
          await this.refreshLibrary();
          if (this.current.mapping === record) this.set({ ...this.current, saveStatus: "saved", message: "All changes saved." });
        } catch (reason) { this.set({ ...this.current, saveStatus: "error", message: reason instanceof Error ? reason.message : "Mapping save failed." }); throw reason; }
      }
    };
    this.pendingFlush = drain();
    try { await this.pendingFlush; } finally { this.pendingFlush = null; }
  }

  async retrySave(): Promise<void> { if (this.current.mapping) { this.set({ ...this.current, saveStatus: "dirty" }); await this.flush(); } }

  get hasAttachmentService(): boolean { return this.attachmentCallbacks !== undefined; }

  private requireAttachmentMutation(message: string): MappingAttachmentCallbacks {
    if (!this.attachmentCallbacks?.withMappingMutation) throw new Error(message);
    return this.attachmentCallbacks;
  }

  async refreshAttachments(): Promise<void> {
    const requestRevision = ++this.attachmentListRequestRevision;
    if (!this.attachmentCallbacks) {
      this.attachmentPreviewRequestRevision += 1;
      this.set({ ...this.current, attachments: { ...emptyMappingAttachmentState, phase: "unavailable", message: "Collection attachment service is unavailable." } });
      return;
    }
    this.set({ ...this.current, attachments: { ...this.current.attachments, phase: "loading", message: null } });
    try {
      const snapshot = await this.attachmentCallbacks.list();
      if (requestRevision !== this.attachmentListRequestRevision) return;
      this.attachmentPreviewRequestRevision += 1;
      this.set({ ...this.current, attachments: { phase: "ready", snapshot, preview: null, message: null } });
    } catch (reason) {
      if (requestRevision !== this.attachmentListRequestRevision) return;
      this.attachmentPreviewRequestRevision += 1;
      const message = reason instanceof Error ? reason.message : "Collection attachments could not be loaded.";
      this.set({ ...this.current, attachments: { phase: "error", snapshot: null, preview: null, message } });
    }
  }

  async attachCollection(request: Parameters<NonNullable<MappingAttachmentCallbacks>["attach"]>[0]): Promise<void> {
    if (!this.attachmentCallbacks) throw new Error("Collection attachment service is unavailable.");
    await this.flush();
    await this.attachmentCallbacks.attach(request);
    await this.attachmentCallbacks.flush?.();
    await this.refreshAttachments();
  }

  async detachCollection(attachmentId: string): Promise<void> {
    if (!this.attachmentCallbacks) throw new Error("Collection attachment service is unavailable.");
    const attachment = this.current.attachments.snapshot?.attachments.find((item) => item.attachment.id === attachmentId)?.attachment;
    if (!attachment) throw new Error("This collection attachment is no longer available.");
    await this.flush();
    await this.attachmentCallbacks.detach(attachment);
    await this.attachmentCallbacks.flush?.();
    await this.refreshAttachments();
  }

  async previewCollectionAttachment(attachmentId: string): Promise<void> {
    if (!this.attachmentCallbacks) throw new Error("Collection attachment service is unavailable.");
    const attachment = this.current.attachments.snapshot?.attachments.find((item) => item.attachment.id === attachmentId)?.attachment;
    if (!attachment) throw new Error("This collection attachment is no longer available.");
    const requestRevision = ++this.attachmentPreviewRequestRevision;
    const selectionKey = attachmentSelectionKey(attachment);
    const preview = await this.attachmentCallbacks.preview(attachment);
    const current = this.current.attachments.snapshot?.attachments.find((item) => item.attachment.id === attachmentId)?.attachment;
    if (requestRevision !== this.attachmentPreviewRequestRevision || !current || attachmentSelectionKey(current) !== selectionKey) return;
    this.set({ ...this.current, attachments: { ...this.current.attachments, phase: "ready", preview, message: preview.status === "ready" ? "Materialized attachment preview is current." : "Attachment preview has diagnostics." } });
  }

  private async runInitialization(load: () => ReturnType<MappingProvider["initialization"]["initialize"]>, deepLink?: MappingDeepLinkRequest): Promise<void> {
    const deepLinkState: MappingDeepLinkState = deepLink ? { status: "loading", request: deepLink } : { status: "none" };
    this.set({ ...initialState, phase: "loading", message: "Loading Mapping library…", deepLink: deepLinkState });
    try {
      const [outcome, content, compositions] = await Promise.all([load(), this.catalogs.content.listModels(), this.catalogs.compositions.list()]);
      const failures = [...content.failures, ...compositions.failures].map((failure) => `${failure.providerLabel}: ${failure.reason}`);
      if (outcome.status === "ready") {
        this.set({ ...initialState, phase: "ready", mappings: outcome.summaries, contentModels: content.entries, compositions: compositions.entries, catalogFailures: failures, message: "Mapping library ready.", deepLink: deepLinkState });
        await this.refreshLibraryDetails();
        await this.refreshAttachments();
        if (deepLink) await this.openDeepLink(deepLink);
      } else if (outcome.status === "recovery-required") {
        this.set({
          ...initialState,
          phase: "recovery",
          mappings: outcome.summaries,
          contentModels: content.entries,
          compositions: compositions.entries,
          catalogFailures: failures,
          recoveryMessage: outcome.recovery.message,
          message: "Recovery required. Source data was preserved.",
          deepLink: deepLink
            ? { status: "provider-failure", request: deepLink, message: outcome.recovery.message }
            : deepLinkState,
        });
      } else {
        this.set({ ...initialState, phase: "error", contentModels: content.entries, compositions: compositions.entries, catalogFailures: failures, message: outcome.error.message, deepLink: deepLink ? { status: "provider-failure", request: deepLink, message: outcome.error.message } : { status: "none" } });
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Mapping initialization failed.";
      this.set({ ...initialState, phase: "error", message, deepLink: deepLink ? { status: "provider-failure", request: deepLink, message } : { status: "none" } });
    }
  }

  private async openLoadedRecord(record: MappingRecord): Promise<void> {
    if (this.current.mapping?.id === record.id) return;
    await this.flush();
    this.set({ ...this.current, mapping: record, definition: null, entries: [], entryFailure: null, entry: null, evaluation: null, collectionEvaluation: null, collectionEvaluations: [], previewDocument: null, previewStatus: "loading", saveStatus: "saved", message: "Mapping loaded." });
    await this.refreshResolution();
  }

  private finishDeepLink(outcome: MappingDeepLinkState): MappingDeepLinkState {
    const message = outcome.status === "ready"
      ? "Linked Mapping opened."
      : outcome.status === "missing"
        ? "Linked Mapping was not found."
        : "message" in outcome
          ? outcome.message
          : "Mapping link could not be opened.";
    this.set({ ...this.current, deepLink: outcome, message });
    return outcome;
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
    const collectionEvaluation = definition.contentModel && mapping.document.mode.kind === "collection"
      ? evaluateCollectionQuery({ model: definition.contentModel, providerId: mapping.document.contentModel.providerId, entries, query: mapping.document.mode.query })
      : null;
    const effectiveEntries = collectionEvaluation?.entries ?? entries;
    const effectiveSelected = effectiveEntries.find((entry) => entry.id === this.current.entry?.id) ?? effectiveEntries[0] ?? selected;
    this.set({ ...this.current, definition, entries, entryFailure, entry: effectiveSelected, evaluation: null, collectionEvaluation, collectionEvaluations: [], previewDocument: definition.composition?.document ?? null, previewStatus: definition.composition ? "loading" : "empty", message: entryFailure ? `Entry provider unavailable: ${entryFailure}` : definition.status === "ready" ? "Mapping definition is ready." : `${definition.diagnostics.length} readiness issue${definition.diagnostics.length === 1 ? "" : "s"}.` });
    if (collectionEvaluation && definition.status === "ready") await this.evaluateCollection(definition, collectionEvaluation, revision);
    else if (selected) await this.evaluateCurrent(selected, revision);
  }

  private async evaluateCurrent(entry: ContentEntryRecord, expectedRevision = this.refreshRevision): Promise<void> {
    const mapping = this.requireMapping(); const evaluation = await evaluateMapping(mapping, entry, this.catalogs, this.manifest);
    if (expectedRevision !== this.refreshRevision) return;
    this.set({ ...this.current, evaluation, previewDocument: evaluation.document ?? null, previewStatus: evaluation.document ? "loading" : "empty", message: evaluation.status === "ready" ? `Entry test passed. ${evaluation.appliedBindingCount} binding${evaluation.appliedBindingCount === 1 ? "" : "s"} applied.` : "Entry test found blocking diagnostics." });
  }

  private async evaluateCollection(definition: MappingDefinitionResolution, query: MappingCollectionEvaluation, expectedRevision: number): Promise<void> {
    if (!definition.composition) return;
    const evaluations = query.entries.map((entry) => ({ entryId: entry.id, evaluation: evaluateResolvedMapping(definition, entry) }));
    if (expectedRevision !== this.refreshRevision) return;
    const materialized = materializeCollectionPreview(mappingPreviewIdentity(definition.mapping.id), definition.composition.document, evaluations);
    const blocking = evaluations.flatMap(({ evaluation }) => evaluation.entryDiagnostics).filter((diagnostic) => diagnostic.severity === "blocking");
    const first = evaluations[0]?.evaluation ?? null;
    this.set({
      ...this.current,
      collectionEvaluations: evaluations.map(({ evaluation }) => evaluation),
      evaluation: first,
      previewDocument: materialized,
      previewStatus: materialized ? "loading" : "empty",
      message: blocking.length ? `${blocking.length} collection Entry diagnostic${blocking.length === 1 ? "" : "s"}.` : `Collection preview contains ${query.entries.length} ordered Entr${query.entries.length === 1 ? "y" : "ies"}.`,
    });
  }

  private async loadEntry(id: string): Promise<ContentEntryRecord> {
    const outcome = await this.contentEntries.get(this.requireMapping().document.contentModel, id);
    if (outcome.status === "resolved") return outcome.entry;
    throw new Error(outcome.status === "not-found" ? "Sample Entry could not be found in the selected Content provider." : outcome.reason);
  }
  private async refreshLibrary(): Promise<void> { const mappings = await this.provider.store.list(); this.set({ ...this.current, mappings }); await this.refreshLibraryDetails(); }
  private async refreshLibraryDetails(): Promise<void> {
    const details: Record<string, MappingLibraryDetail> = {};
    await Promise.all(this.current.mappings.map(async (summary) => {
      const outcome = await this.provider.store.get(summary.id); if (outcome.status !== "loaded") return;
      details[summary.id] = { record: outcome.record, definition: await resolveMappingDefinition(outcome.record, this.catalogs, this.manifest) };
    }));
    this.set({ ...this.current, libraryDetails: details });
  }
  /**
   * A new record must not land on an id that already exists: `put` overwrites,
   * so a colliding id factory would silently destroy a stored Mapping.
   */
  private async requireFreshRecordId(id: string): Promise<void> {
    const existing = await this.provider.store.get(id);
    if (existing.status !== "not-found") throw new Error(`Mapping "${id}" already exists; no data was overwritten.`);
  }
  private requireMapping(): MappingRecord { if (!this.current.mapping) throw new Error("No Mapping is open."); return this.current.mapping; }
  private set(state: MappingEditorState): void { this.current = state; for (const listener of [...this.listeners]) listener(state); }
}

function defaultCollectionQuery(): MappingCollectionQuery {
  return { publication: "published-only", conditions: [], sort: [], pins: [], limit: 100 };
}

function mappingPreviewIdentity(mappingId: string): string { return `mapping-preview-${mappingId}`; }

export function createMappingEditorController(
  provider: MappingProvider,
  catalogs: { content: ContentCatalog; compositions: CompositionCatalog },
  contentEntries: MappingContentEntryCatalog,
  manifest: ComponentCatalog,
  options?: MappingEditorControllerOptions,
): MappingEditorController { return new MappingEditorController(provider, catalogs, contentEntries, manifest, options); }
