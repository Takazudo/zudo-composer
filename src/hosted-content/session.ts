import type { ContentEntryRef, HostedCommand, HostedIdentities, HostedPublication, HostedResult, HostedSnapshot, HostedState, HostedTransport, HostedErrorCode, JsonValue } from "./types";

export type HostedSavePhase = "loading" | "clean" | "dirty" | "saving" | "saved" | "recovering" | "conflict" | "failed";
export interface HostedLocalEdit { entry: ContentEntryRef; fieldId: string; value?: JsonValue; revision: number }
export interface HostedPendingOperation { request: HostedCommand; localRevision: number; rejected: boolean; rejectedCode?: HostedErrorCode }
/** The host persists this detached object. Session memory alone is not reload durability. */
export interface HostedRecoveryCheckpoint {
  version: 1; acknowledged: HostedState | null; edits: HostedLocalEdit[];
  localRevision: number; pending: HostedPendingOperation | null;
}
export interface HostedEditorSessionState {
  phase: HostedSavePhase; content: HostedState | null; localRevision: number;
  dirty: boolean; pending: HostedPendingOperation | null; error: unknown;
  reviewedSnapshot: HostedSnapshot | null; publication: HostedPublication | null;
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
  private revision = 0;
  private pending: HostedPendingOperation | null = null;
  private phase: HostedSavePhase = "loading";
  private error: unknown = null;
  private reviewed: HostedSnapshot | null = null;
  private reviewedRoute: string | null = null;
  private unsubscribePreview?: () => void;
  private publication: HostedPublication | null = null;
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
    return { ...immutable({ phase: this.phase, content, localRevision: this.revision, dirty: this.edits.length > 0, pending: this.pending, reviewedSnapshot: this.hasCurrentPreview() ? this.reviewed : null, publication: this.publication }), error: this.error };
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
  checkpoint(): HostedRecoveryCheckpoint { return copy({ version: 1, acknowledged: this.acknowledged, edits: this.edits, localRevision: this.revision, pending: this.pending }); }
  private persist(): Promise<void> {
    const checkpoint = this.checkpoint();
    const write = this.checkpointWrites.catch(() => undefined).then(() => this.options.persistRecovery?.(checkpoint));
    this.checkpointWrites = write; return write;
  }
  async initialize(): Promise<void> {
    try {
      if (!this.acknowledged) this.acknowledged = copy(await this.options.transport.readState());
      this.phase = this.pending ? (this.pending.rejected ? (conflicts.has(this.pending.rejectedCode ?? "") ? "conflict" : "failed") : "recovering") : this.edits.length ? "dirty" : "clean";
      await this.persist(); this.emit();
    } catch (error) { this.fail(error); throw error; }
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
    const definite = requestRejected ? rejectionCode(error) : null;
    if (this.pending && definite) this.pending = immutable({ ...this.pending, rejected: true, rejectedCode: definite });
    this.phase = definite && conflicts.has(definite) ? "conflict" : this.pending && !definite ? "recovering" : "failed";
    if (this.options.isAuthenticationExpired?.(error)) this.options.onAuthenticationExpired?.(error);
    this.emit(); void this.persist().catch(() => undefined);
  }
  private async resolvePending(): Promise<HostedResult> {
    const active = this.pending!;
    if (active.rejected) throw this.error ?? new Error("Review and reapply rejected changes before saving");
    this.phase = "saving"; this.error = null; this.emit();
    let requestRejected = false;
    try {
      await this.persist();
      const receipt = await this.options.transport.readReceipt(active.request.operationKey);
      let response: HostedResult;
      if (receipt) response = receipt.result;
      else {
        try { response = await this.options.transport.execute(active.request); }
        catch (error) { requestRejected = !!rejectionCode(error); throw error; }
      }
      const result = copy(response);
      this.acknowledged = result.state;
      if (active.request.kind === "set-fields") {
        const committedEntry = active.request.entry;
        this.edits = this.edits.filter((edit) => !sameEntry(edit.entry, committedEntry) || edit.revision > active.localRevision);
      }
      this.pending = null;
      if (result.publication) this.publication = result.publication;
      this.phase = this.edits.length ? "dirty" : "saved";
      await this.persist(); this.emit(); return result;
    } catch (error) {
      // A checkpoint failure after acknowledgement also retains the exact operation.
      if (!this.pending) this.pending = active;
      this.fail(error, requestRejected); throw error;
    }
  }
  flush(): Promise<void> {
    if (this.flight) return this.flight;
    const work = async () => {
      if (!this.acknowledged) throw new Error("Authoritative content has not loaded");
      if (this.pending) await this.resolvePending();
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
  private async command(command: Omit<Extract<HostedCommand, { kind: "capture-snapshot" }>, "operationKey" | "expected"> | Omit<Extract<HostedCommand, { kind: "begin-publication" }>, "operationKey" | "expected">): Promise<HostedResult> {
    if (this.flight || this.pending || this.edits.length || !this.acknowledged) throw new Error("Resolve local saves before this action");
    this.pending = immutable({ request: { ...command, operationKey: this.options.createOperationKey(), expected: identities(this.acknowledged) } as HostedCommand, localRevision: this.revision, rejected: false });
    let result!: HostedResult;
    this.flight = this.resolvePending().then((value) => { result = value; }).finally(() => { this.flight = null; });
    await this.flight; return result;
  }
  async captureAndPreview(routeId: string): Promise<HostedSnapshot> {
    if (!this.options.preview) throw new Error("Preview adapter is required");
    const generation = ++this.previewGeneration; this.reviewed = null; this.emit();
    await this.flush(); const revision = this.revision;
    const result = await this.command({ kind: "capture-snapshot" });
    if (!result.snapshot) throw new Error("Snapshot result is missing");
    const snapshot = immutable(result.snapshot);
    await this.options.preview.render(snapshot, routeId);
    if (generation !== this.previewGeneration || this.revision !== revision || this.edits.length || this.pending || this.acknowledged?.draftRevision !== snapshot.draftRevision) throw new Error("Preview became stale after a local edit");
    this.reviewed = snapshot; this.reviewedRoute = routeId; this.emit(); return snapshot;
  }
  async submit(): Promise<HostedPublication> {
    const snapshot = this.reviewed;
    if (!snapshot || !this.hasCurrentPreview() || this.edits.length || this.pending || snapshot.diagnostics.length || this.acknowledged?.draftRevision !== snapshot.draftRevision) throw new Error("Preview the complete current saved draft before submitting");
    const result = await this.command({ kind: "begin-publication", snapshotId: snapshot.id });
    if (!result.publication) throw new Error("Publication result is missing");
    return result.publication;
  }
  /** Read-only conflict review; retained edits remain untouched. */
  reviewAuthoritative(): Promise<HostedState> { return this.options.transport.readState().then(copy); }
  /** Explicit host/user decision after displaying the authoritative difference. */
  async reapply(authoritative: HostedState): Promise<void> {
    if (this.flight || (this.pending && !this.pending.rejected)) throw new Error("Recover the original operation first");
    this.acknowledged = copy(authoritative); this.pending = null; this.reviewed = null; this.options.preview?.invalidate?.(); this.error = null; this.phase = this.edits.length ? "dirty" : "clean";
    await this.persist(); this.emit();
  }
  /** Explicit discard is unavailable while an operation could still commit. */
  async discard(authoritative: HostedState): Promise<void> {
    if (this.flight || (this.pending && !this.pending.rejected)) throw new Error("Recover the original operation first");
    this.acknowledged = copy(authoritative); this.edits = []; this.pending = null;
    this.revision++; this.reviewed = null; this.options.preview?.invalidate?.();
    this.error = null; this.phase = "clean"; await this.persist(); this.emit();
  }
  /** Presentation disposal leaves recovery and any in-flight operation intact. */
  dispose(): void { this.listeners.clear(); this.unsubscribePreview?.(); this.previewGeneration++; this.reviewed = null; this.options.preview?.dispose?.(); }
}
