import type { ContentEntryRef, HostedCommand, HostedIdentities, HostedPublication, HostedResult, HostedSnapshot, HostedState, HostedTransport, HostedErrorCode, JsonValue } from "./types";

export type HostedSavePhase = "loading" | "clean" | "dirty" | "saving" | "saved" | "recovering" | "conflict" | "failed";
export interface HostedLocalEdit { entry: ContentEntryRef; fieldId: string; value?: JsonValue; revision: number }
export interface HostedPendingOperation { request: HostedCommand; localRevision: number; rejected: boolean; rejectedCode?: HostedErrorCode }
/** The host persists this detached object. Session memory alone is not reload durability. */
export interface HostedCreationDraft { collectionId: string; values: Record<string, JsonValue>; revision: number }
export interface HostedRecoveryCheckpoint {
  version: 1; acknowledged: HostedState | null; edits: HostedLocalEdit[];
  localRevision: number; pending: HostedPendingOperation | null;
  publication?: HostedPublication | null; creationDraft?: HostedCreationDraft | null;
}
export interface HostedEditorSessionState {
  phase: HostedSavePhase; invalidInputs: readonly string[]; presentationRevision: number; content: HostedState | null; localRevision: number;
  dirty: boolean; pending: HostedPendingOperation | null; error: unknown;
  reviewedSnapshot: HostedSnapshot | null; publication: HostedPublication | null; publicationError: unknown; publicationStale: boolean; creationDraft: HostedCreationDraft | null; lastCreatedEntry: ContentEntryRef | null;
}
export interface HostedPreviewAdapter {
  render(snapshot: HostedSnapshot, routeId: string): Promise<unknown>;
  readonly state?: { status: string; result?: { snapshotId: string; snapshotDigest: string; draftRevision: string; baseline: HostedIdentities["baseline"]; definition: string; routeId: string } };
  subscribe?(listener: () => void): () => void;
  invalidate?(): void; dispose?(): void;
}
export interface HostedSessionOptions {
  transport: HostedTransport; createOperationKey(): string;
  /** Must persist before resolving if reload/crash recovery is required. */
  persistRecovery?(checkpoint: HostedRecoveryCheckpoint): void | Promise<void>;
  recovery?: HostedRecoveryCheckpoint;
  isAuthenticationExpired?(error: unknown): boolean;
  onAuthenticationExpired?(error: unknown): void;
  preview?: HostedPreviewAdapter;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const immutable = <T>(value: T): T => freeze(copy(value));
const sameEntry = (a: ContentEntryRef, b: ContentEntryRef) => a.providerId === b.providerId && a.modelId === b.modelId && a.recordId === b.recordId;
const identities = (state: HostedState): HostedIdentities => ({ draftRevision: state.draftRevision, baseline: copy(state.baseline), definition: state.definition });
const conflicts = new Set(["revision-conflict", "baseline-conflict", "definition-conflict"]);
const rejectionCodes = new Set<HostedErrorCode>(["invalid-request", "invalid-value", "forbidden", "not-found", "revision-conflict", "baseline-conflict", "definition-conflict", "operation-key-reuse", "publication-busy", "incomplete", "configuration-required"]);
function rejectionCode(error: unknown): HostedErrorCode | null {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return typeof code === "string" && rejectionCodes.has(code as HostedErrorCode) ? code as HostedErrorCode : null;
}

/** One active immutable operation; later edits cannot be sent until it is resolved. */
export class HostedContentSession {
  private acknowledged: HostedState | null = null;
  private edits: HostedLocalEdit[] = [];
  private invalidInputs = new Set<string>();
  private presentationRevision = 0;
  private revision = 0;
  private pending: HostedPendingOperation | null = null;
  private phase: HostedSavePhase = "loading";
  private error: unknown = null;
  private reviewed: HostedSnapshot | null = null;
  private reviewedRoute: string | null = null;
  private unsubscribePreview?: () => void;
  private publication: HostedPublication | null = null;
  private publicationError: unknown = null;
  private publicationStale = false;
  private creationDraft: HostedCreationDraft | null = null;
  private lastCreatedEntry: ContentEntryRef | null = null;
  private previewGeneration = 0;
  private flight: Promise<void> | null = null;
  private listeners = new Set<(state: HostedEditorSessionState) => void>();
  private checkpointWrites: Promise<void> = Promise.resolve();
  constructor(private options: HostedSessionOptions) {
    if (options.recovery) {
      const recovered = copy(options.recovery);
      if (recovered.version !== 1) throw new Error("Unsupported recovery checkpoint");
      this.acknowledged = recovered.acknowledged;
      this.edits = recovered.edits;
      this.revision = recovered.localRevision;
      this.pending = recovered.pending ? immutable(recovered.pending) : null;
      this.publication = recovered.publication ?? null; this.publicationStale = !!this.publication;
      this.creationDraft = recovered.creationDraft ?? null;
    }
    this.unsubscribePreview = options.preview?.subscribe?.(() => this.emit());
  }
  get state(): HostedEditorSessionState {
    const content = this.acknowledged ? copy(this.acknowledged) : null;
    if (content) for (const edit of this.edits) {
      const entry = content.providers.find((p) => p.providerId === edit.entry.providerId)?.entries.find((e) => e.id === edit.entry.recordId && e.modelId === edit.entry.modelId);
      if (!entry) continue;
      if (edit.value === undefined) delete entry.values[edit.fieldId]; else entry.values[edit.fieldId] = copy(edit.value);
    }
    return { ...immutable({ phase: this.phase, invalidInputs: [...this.invalidInputs], presentationRevision: this.presentationRevision, content, localRevision: this.revision, dirty: this.edits.length > 0 || !!this.creationDraft || this.invalidInputs.size > 0, pending: this.pending, reviewedSnapshot: this.hasCurrentPreview() ? this.reviewed : null, publication: this.publication, publicationStale: this.publicationStale, creationDraft: this.creationDraft, lastCreatedEntry: this.lastCreatedEntry }), publicationError: this.publicationError, error: this.error };
  }
  private hasCurrentPreview(): boolean {
    if (!this.reviewed) return false;
    const status = this.options.preview?.state;
    if (!status) return true;
    const result = status.result;
    return status.status === "rendered" && !!result && result.snapshotId === this.reviewed.id
      && result.snapshotDigest === this.reviewed.digest && result.draftRevision === this.reviewed.draftRevision
      && result.definition === this.reviewed.definition && result.baseline.gitSha === this.reviewed.baseline.gitSha
      && result.baseline.contentDigest === this.reviewed.baseline.contentDigest && result.routeId === this.reviewedRoute;
  }
  /** Error objects are kept separately from JSON checkpoint data. */
  get currentError(): unknown { return this.error; }
  subscribe(listener: (state: HostedEditorSessionState) => void): () => void {
    this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener);
  }
  private emit() { const state = this.state; for (const listener of this.listeners) listener({ ...state, error: this.error }); }
  checkpoint(): HostedRecoveryCheckpoint { return copy({ version: 1, acknowledged: this.acknowledged, edits: this.edits, localRevision: this.revision, pending: this.pending, publication: this.publication, creationDraft: this.creationDraft }); }
  private persist(): Promise<void> {
    const checkpoint = this.checkpoint();
    const write = this.checkpointWrites.catch(() => undefined).then(() => this.options.persistRecovery?.(checkpoint));
    this.checkpointWrites = write; return write;
  }
  async initialize(): Promise<void> {
    try {
      if (!this.acknowledged) this.acknowledged = copy(await this.options.transport.readState());
      this.phase = this.pending ? (this.pending.rejected ? (conflicts.has(this.pending.rejectedCode ?? "") ? "conflict" : "failed") : "recovering") : this.edits.length || this.creationDraft ? "dirty" : "clean";
      await this.persist();
      if (this.publication) await this.refreshPublication().catch(() => undefined);
      this.emit();
    } catch (error) { this.fail(error); throw error; }
  }
  /** Browser-internal incomplete number text is local only, never a typed draft value. */
  setIncompleteInput(controlId: string, incomplete: boolean): void {
    if (incomplete) this.invalidInputs.add(controlId); else this.invalidInputs.delete(controlId);
    this.revision++; this.reviewed = null; this.options.preview?.invalidate?.();
    if (!this.pending) this.phase = this.edits.length || this.creationDraft || this.invalidInputs.size ? "dirty" : "clean";
    this.emit();
  }
  stageCreation(collectionId: string, values: Record<string, JsonValue>): void {
    this.revision++; this.creationDraft = copy({ collectionId, values, revision: this.revision });
    this.reviewed = null; this.options.preview?.invalidate?.();
    if (!this.pending) this.phase = "dirty"; this.emit(); void this.persist().catch((error) => this.fail(error));
  }
  cancelCreation(): void {
    if (this.pending?.request.kind === "create-entry" && !this.pending.rejected) throw new Error("Recover the original creation first");
    const collectionId = this.creationDraft?.collectionId;
    for (const controlId of this.invalidInputs) if (collectionId && controlId.startsWith(`create/${collectionId}/`)) this.invalidInputs.delete(controlId);
    this.creationDraft = null;
    if (this.pending?.request.kind === "create-entry" && this.pending.rejected) { this.pending = null; this.error = null; }
    if (!this.pending) this.phase = this.edits.length || this.invalidInputs.size ? "dirty" : "clean";
    this.emit(); void this.persist().catch((error) => this.fail(error));
  }
  edit(entry: ContentEntryRef, fieldId: string, value: JsonValue | undefined): void {
    if (!this.acknowledged) throw new Error("Authoritative content has not loaded");
    const target = this.acknowledged.providers.find((p) => p.providerId === entry.providerId)?.entries.find((e) => e.id === entry.recordId && e.modelId === entry.modelId);
    if (!target) throw new Error("Unknown selected entry");
    this.revision++;
    this.edits = this.edits.filter((e) => !(sameEntry(e.entry, entry) && e.fieldId === fieldId));
    this.edits.push(copy({ entry, fieldId, value, revision: this.revision }));
    this.reviewed = null; this.options.preview?.invalidate?.();
    if (!this.pending) this.phase = "dirty";
    this.emit(); void this.persist().catch((error) => this.fail(error));
  }
  private fail(error: unknown, requestRejected = false): void {
    this.error = error;
    const expired = !!this.options.isAuthenticationExpired?.(error);
    // Authentication can fail before receipt recovery; it proves nothing about
    // whether the original operation committed before its response was lost.
    const definite = requestRejected && !expired ? rejectionCode(error) : null;
    if (this.pending && definite) this.pending = immutable({ ...this.pending, rejected: true, rejectedCode: definite });
    this.phase = definite && conflicts.has(definite) ? "conflict" : this.pending && !definite ? "recovering" : "failed";
    if (expired) this.options.onAuthenticationExpired?.(error);
    this.emit(); void this.persist().catch(() => undefined);
  }
  private async resolvePending(): Promise<HostedResult> {
    const active = this.pending!;
    if (active.rejected) throw this.error ?? new Error("Review and reapply rejected changes before saving");
    this.phase = "saving"; this.error = null; this.emit();
    let requestRejected = false;
    try {
      await this.persist();
      // Executing the exact request lets the server verify its fingerprint.
      // A receipt key alone cannot prove that it belongs to this payload.
      let response: HostedResult;
      try { response = await this.options.transport.execute(active.request); }
      catch (error) { requestRejected = !!rejectionCode(error); throw error; }
      const result = copy(response);
      this.acknowledged = result.state;
      if (active.request.kind === "set-fields") {
        const committedEntry = active.request.entry;
        this.edits = this.edits.filter((edit) => !sameEntry(edit.entry, committedEntry) || edit.revision > active.localRevision);
      }
      this.pending = null;
      if (result.publication) { this.publication = result.publication; this.publicationStale = false; }
      if (result.createdEntry) {
        this.lastCreatedEntry = result.createdEntry;
        if (active.request.kind === "create-entry" && this.creationDraft?.collectionId === active.request.collectionId) {
          // A later creation-form edit belongs to the newly assigned Entry.
          if (this.creationDraft.revision > active.localRevision) for (const [fieldId, value] of Object.entries(this.creationDraft.values)) {
            this.edits.push(copy({ entry: result.createdEntry, fieldId, value, revision: this.creationDraft.revision }));
          }
          this.creationDraft = null;
        }
      }
      this.phase = this.edits.length || this.creationDraft || this.invalidInputs.size ? "dirty" : "saved";
      await this.persist(); this.emit(); return result;
    } catch (error) {
      // A checkpoint failure after acknowledgement also retains the exact operation.
      if (!this.pending) this.pending = active;
      this.fail(error, requestRejected); throw error;
    }
  }
  flush(): Promise<void> {
    if (this.flight) return this.flight.then(() => this.flush());
    const work = async () => {
      if (!this.acknowledged) throw new Error("Authoritative content has not loaded");
      if (this.pending) await this.resolvePending();
      if (this.invalidInputs.size) throw new Error("Correct the incomplete number before saving");
      while (this.edits.length) {
        const entry = this.edits[0]!.entry;
        const fields = this.edits.filter((e) => sameEntry(e.entry, entry));
        const values: Record<string, JsonValue> = {}; const clear: string[] = [];
        for (const field of fields) { if (field.value === undefined) clear.push(field.fieldId); else values[field.fieldId] = field.value; }
        this.pending = immutable({ request: { kind: "set-fields", operationKey: this.options.createOperationKey(), expected: identities(this.acknowledged!), entry, values, clear }, localRevision: this.revision, rejected: false });
        await this.resolvePending();
      }
    };
    this.flight = work().finally(() => { this.flight = null; }); return this.flight;
  }
  private async command(command: { [K in HostedCommand["kind"]]: Omit<Extract<HostedCommand, { kind: K }>, "operationKey" | "expected"> }[HostedCommand["kind"]]): Promise<HostedResult> {
    if (this.flight || this.pending || this.edits.length || !this.acknowledged) throw new Error("Resolve local saves before this action");
    this.pending = immutable({ request: { ...command, operationKey: this.options.createOperationKey(), expected: identities(this.acknowledged) } as HostedCommand, localRevision: this.revision, rejected: false });
    let result!: HostedResult;
    this.flight = this.resolvePending().then((value) => { result = value; }).finally(() => { this.flight = null; });
    await this.flight; return result;
  }
  private async collectionAction(action: Extract<Parameters<HostedContentSession["command"]>[0], { kind: "create-entry" | "add-entry" | "reorder" }>): Promise<HostedResult> {
    await this.flush();
    if (this.creationDraft && (action.kind !== "create-entry" || action.collectionId !== this.creationDraft.collectionId)) throw new Error("Save or cancel the new item first");
    // Before allocation/dispatch the staged values may have changed while a
    // prior record save was finishing. Freeze that current intent, then retry it exactly.
    if (action.kind === "create-entry" && this.creationDraft?.collectionId === action.collectionId) action = { ...action, values: copy(this.creationDraft.values) };
    this.revision++; this.reviewed = null; this.options.preview?.invalidate?.();
    return this.command(action);
  }
  createEntry(collectionId: string, values: Record<string, JsonValue>, before: ContentEntryRef | null = null): Promise<HostedResult> {
    return this.collectionAction({ kind: "create-entry", collectionId, values, before });
  }
  addEntry(collectionId: string, entry: ContentEntryRef, before: ContentEntryRef | null = null): Promise<HostedResult> {
    return this.collectionAction({ kind: "add-entry", collectionId, entry, before });
  }
  reorder(collectionId: string, entries: ContentEntryRef[]): Promise<HostedResult> {
    return this.collectionAction({ kind: "reorder", collectionId, entries });
  }
  /** A clean refresh may adopt a confirmed integration; dirty edits need explicit review. */
  async refresh(): Promise<void> {
    if (this.flight || this.pending || this.edits.length || this.creationDraft || this.invalidInputs.size) throw new Error("Review retained changes before loading current content");
    try {
      const authoritative = await this.options.transport.readState();
      if (this.flight || this.pending || this.edits.length || this.creationDraft || this.invalidInputs.size) throw new Error("Content was edited while loading current content");
      this.acknowledged = copy(authoritative); this.invalidInputs.clear(); this.presentationRevision++; this.revision++; this.reviewed = null; this.options.preview?.invalidate?.();
      this.error = null; this.phase = "clean"; await this.persist(); this.emit();
    } catch (error) { this.fail(error); throw error; }
  }
  async refreshPublication(): Promise<HostedPublication> {
    const current = this.publication;
    if (!current) throw new Error("No publication has been submitted");
    try {
      const status = copy(await this.options.transport.getPublication(current.id));
      if (status.id !== current.id || status.snapshotId !== current.snapshotId) throw new Error("Publication status does not match the submitted snapshot");
      if (this.publication?.id === current.id && status.statusVersion >= this.publication.statusVersion) { this.publication = status; this.publicationStale = false; }
      this.publicationError = null; await this.persist(); this.emit(); return immutable(this.publication!);
    } catch (error) { this.publicationError = error; this.publicationStale = true; if (this.options.isAuthenticationExpired?.(error)) this.options.onAuthenticationExpired?.(error); this.emit(); throw error; }
  }
  async captureAndPreview(routeId: string): Promise<HostedSnapshot> {
    if (!this.options.preview) throw new Error("Preview adapter is required");
    const generation = ++this.previewGeneration; this.reviewed = null; this.emit();
    await this.flush();
    if (this.creationDraft || this.invalidInputs.size) throw new Error("Save or cancel the new item before previewing");
    const revision = this.revision;
    const result = await this.command({ kind: "capture-snapshot" });
    if (!result.snapshot) throw new Error("Snapshot result is missing");
    const snapshot = immutable(result.snapshot);
    const stale = () => generation !== this.previewGeneration || this.revision !== revision || this.edits.length > 0 || !!this.pending || this.acknowledged?.draftRevision !== snapshot.draftRevision;
    if (stale()) throw new Error("Preview became stale after a local edit");
    try { await this.options.preview.render(snapshot, routeId); }
    catch (error) { this.error = error; this.emit(); throw error; }
    if (stale()) throw new Error("Preview became stale after a local edit");
    this.reviewed = snapshot; this.reviewedRoute = routeId; this.emit(); return snapshot;
  }
  async submit(): Promise<HostedPublication> {
    const snapshot = this.reviewed;
    if (!snapshot || !this.hasCurrentPreview() || this.edits.length || this.creationDraft || this.invalidInputs.size || this.pending || snapshot.diagnostics.length || this.acknowledged?.draftRevision !== snapshot.draftRevision) throw new Error("Preview the complete current saved draft before submitting");
    const result = await this.command({ kind: "begin-publication", snapshotId: snapshot.id });
    if (!result.publication) throw new Error("Publication result is missing");
    return result.publication;
  }
  /** Read-only conflict review; retained edits remain untouched. */
  reviewAuthoritative(): Promise<HostedState> { return this.options.transport.readState().then(copy); }
  /** Explicit host/user decision after displaying the authoritative difference. */
  async reapply(authoritative: HostedState): Promise<void> {
    if (this.flight || (this.pending && !this.pending.rejected)) throw new Error("Recover the original operation first");
    this.acknowledged = copy(authoritative); this.pending = null; this.reviewed = null; this.options.preview?.invalidate?.(); this.error = null; this.phase = this.edits.length || this.creationDraft || this.invalidInputs.size ? "dirty" : "clean";
    await this.persist(); this.emit();
  }
  /** Explicit discard is unavailable while an operation could still commit. */
  async discard(authoritative: HostedState): Promise<void> {
    if (this.flight || (this.pending && !this.pending.rejected)) throw new Error("Recover the original operation first");
    this.acknowledged = copy(authoritative); this.edits = []; this.invalidInputs.clear(); this.creationDraft = null; this.pending = null;
    this.presentationRevision++; this.revision++; this.reviewed = null; this.options.preview?.invalidate?.();
    this.error = null; this.phase = "clean"; await this.persist(); this.emit();
  }
  /** Presentation disposal leaves recovery and any in-flight operation intact. */
  dispose(): void { this.listeners.clear(); this.unsubscribePreview?.(); this.previewGeneration++; this.reviewed = null; this.options.preview?.dispose?.(); }
}
