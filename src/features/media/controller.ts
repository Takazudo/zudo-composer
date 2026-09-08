import { summarizeMedia, type MediaProvider, type MediaSummary, type MediaSnapshot, type MediaRecord, type MediaMetadataPatch, type MediaFolderPatch } from "../../media";
import type { MediaFileProviderStore } from "../../media/storage/file-provider";
import type { MediaContentServices, MediaUsageScan, MediaInsertionTarget, MediaUse } from "../../media/integration/content";

export interface MediaLibraryControllerOptions {
  writeClipboard?: (text: string) => void | Promise<void>;
  contentServices?: MediaContentServices;
}
export interface MediaLibraryState {
  phase: "idle" | "loading" | "ready" | "recovery" | "error";
  records: readonly MediaSummary[];
  snapshot: MediaSnapshot | null;
  errorMessage: string | null;
  recoveryMessage: string | null;
  notice: { tone: "info" | "err"; text: string } | null;
  busy: boolean;
  operation: string | null;
  generation: number;
  uncertain: boolean;
}
export function versionedMediaStore(provider: MediaProvider): MediaFileProviderStore | undefined {
  const store = provider.store as Partial<MediaFileProviderStore>;
  return store.capabilities?.snapshot && typeof store.snapshot === "function" ? store as MediaFileProviderStore : undefined;
}
export function mediaPublicFileName(record: Pick<MediaSummary, "url">): string { return record.url.split("/").at(-1)!; }
export function mediaUrl(record: Pick<MediaSummary, "authoringUrl">): string { return record.authoringUrl; }
export function mediaMarkdown(record: Pick<MediaSummary, "authoringUrl" | "fileName" | "mediaType">): string {
  const label = record.fileName.replace(/\.[^.]+$/, "").replace(/([\\[\]])/g, "\\$1");
  return `${record.mediaType.startsWith("image/") ? "!" : ""}[${label}](${record.authoringUrl})`;
}
const message = (error: unknown) => error instanceof Error ? error.message : "Media operation failed.";

export class MediaLibraryController {
  private current: MediaLibraryState = { phase: "idle", records: [], snapshot: null, errorMessage: null, recoveryMessage: null, notice: null, busy: false, operation: null, generation: 0, uncertain: false };
  private listeners = new Set<(state: MediaLibraryState) => void>();
  private request = 0;
  private pending: Promise<unknown> = Promise.resolve();
  private drafts = new Map<string, { record: MediaSummary; patch: MediaMetadataPatch }>();
  private persistingDrafts = new Map<string, { record: MediaSummary; patch: MediaMetadataPatch }>();
  private draftSaves = new Map<string, Promise<void>>();
  private flushing: Promise<void> | undefined;
  readonly store: MediaFileProviderStore | undefined;
  readonly contentServices: MediaContentServices | undefined;
  constructor(readonly provider: MediaProvider, private options: MediaLibraryControllerOptions = {}) {
    this.store = versionedMediaStore(provider); this.contentServices = options.contentServices;
  }
  get state() { return this.current; }
  subscribe(listener: (state: MediaLibraryState) => void) { this.listeners.add(listener); listener(this.current); return () => { this.listeners.delete(listener); }; }
  private set(patch: Partial<MediaLibraryState>) { this.current = { ...this.current, ...patch }; for (const listener of this.listeners) listener(this.current); }
  reportFailure(error: unknown) { this.set({ notice: { tone: "err", text: message(error) } }); }
  clearNotice() { this.set({ notice: null }); }
  async initialize() {
    this.set({ phase: "loading" });
    try {
      const outcome = await this.provider.initialization.initialize();
      if (outcome.status === "error") throw outcome.error;
      if (outcome.status === "recovery-required") { this.set({ phase: "recovery", recoveryMessage: outcome.recovery.message, records: outcome.summaries }); return; }
      await this.refresh();
    } catch (error) { this.set({ phase: "error", errorMessage: message(error) }); }
  }
  retryInitialization() { return this.initialize(); }
  async reload() {
    if (this.current.busy) throw new Error("Wait for the pending operation before inspecting current state.");
    await this.refresh();
    if (this.current.phase !== "ready" || (this.store && !this.current.snapshot)) throw new Error("Authoritative Media inspection did not complete.");
    this.pending = Promise.resolve();
    this.set({ uncertain: false, notice: { tone: "info", text: "Authoritative state reloaded. Inspect current records before starting a new operation; unsaved drafts retain their original revisions." } });
  }
  async refresh() {
    const request = ++this.request;
    this.set({ phase: "loading" });
    try {
      const snapshot = this.store ? await this.store.snapshot() : null;
      const records = snapshot ? snapshot.records.map(summarizeMedia) : await this.provider.store.list();
      if (request === this.request) this.set({ snapshot, records, phase: "ready", errorMessage: null, recoveryMessage: null });
    } catch (error) { if (request === this.request) this.set({ phase: "error", errorMessage: message(error) }); throw error; }
  }
  capability(name: keyof NonNullable<MediaFileProviderStore["capabilities"]>): boolean { return this.current.phase === "ready" && !this.current.uncertain && this.store?.capabilities[name] === true; }
  private requireStore(capability: keyof MediaFileProviderStore["capabilities"]): MediaFileProviderStore {
    if (!this.store || !this.capability(capability)) throw new Error(`Media ${capability} is unavailable for this provider.`);
    return this.store;
  }
  /** Pending writes survive presentation unmount and are visible to release flush. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const run = Promise.resolve().then(async () => {
      await this.pending;
      while (this.drafts.size) await this.saveDraft(this.drafts.keys().next().value!);
    });
    this.flushing = run;
    void run.finally(() => { if (this.flushing === run) this.flushing = undefined; }).catch(() => undefined);
    return run;
  }
  draftMetadata(record: MediaSummary, patch: MediaMetadataPatch) {
    const previous = this.drafts.get(record.id);
    const persisting = this.persistingDrafts.get(record.id);
    // Only replace a prior patch when every field belongs to the active save.
    // Uncommitted fields keep their original base so external changes still
    // conflict; a stale inspector can never move an existing draft backwards.
    const hasUncommitted = previous && (Object.keys(previous.patch) as (keyof MediaMetadataPatch)[])
      .some((key) => !persisting || previous.patch[key] !== persisting.patch[key]);
    const newerBase = previous && record.revision > previous.record.revision && !hasUncommitted;
    this.drafts.set(record.id, {
      record: previous && !newerBase ? previous.record : record,
      patch: { ...(newerBase ? undefined : previous?.patch), ...patch },
    });
    this.set({ generation: this.current.generation + 1 });
  }
  saveDraft(id: string): Promise<void> {
    const active = this.draftSaves.get(id);
    if (active) return active.then(() => this.drafts.has(id) ? this.saveDraft(id) : undefined);
    const saving = this.persistDraft(id);
    this.draftSaves.set(id, saving);
    void saving.finally(() => { if (this.draftSaves.get(id) === saving) this.draftSaves.delete(id); }).catch(() => undefined);
    return saving;
  }
  private async persistDraft(id: string) {
    const draft = this.drafts.get(id); if (!draft) return;
    this.persistingDrafts.set(id, draft);
    let saved: MediaRecord;
    try { saved = await this.updateMetadata(draft.record, draft.patch); }
    catch (error) {
      // A newer input base is not proof that our write committed. Restore
      // its pending fields and conflict base when the write/refresh fails.
      const newer = this.drafts.get(id);
      if (newer && newer !== draft) this.drafts.set(id, { record: draft.record, patch: { ...draft.patch, ...newer.patch } });
      throw error;
    }
    finally { this.persistingDrafts.delete(id); }
    const newer = this.drafts.get(id);
    if (!newer) return;
    if (newer === draft) this.drafts.delete(id);
    else if (newer.record.revision <= saved.revision) {
      // Concurrent edits survive our own commit, including an inspector that
      // already advanced to the saved revision while the refresh was running.
      this.drafts.set(id, { ...newer, record: summarizeMedia(saved) });
    } else {
      // This draft was authored against a later authoritative revision. Keep
      // that base; moving it back to our result would create a false conflict.
      this.drafts.set(id, newer);
    }
    this.set({ generation: this.current.generation + 1 });
  }
  hasDraft(id: string) { return this.drafts.has(id); }
  discardDraft(id: string) {
    if (this.current.busy || this.current.uncertain) throw new Error("Resolve the pending or uncertain operation before discarding changes.");
    this.drafts.delete(id); this.pending = Promise.resolve();
    this.set({ generation: this.current.generation + 1, notice: null });
  }
  private mutate<T>(label: string, task: () => Promise<T>): Promise<T> {
    if (this.current.busy) return Promise.reject(new Error("Wait for the current Media operation to finish."));
    if (this.current.phase !== "ready" || this.current.uncertain) return Promise.reject(new Error("Reload authoritative Media state before making changes."));
    const pending = Promise.resolve().then(async () => {
      let committed = false;
      try { const result = await task(); committed = true; await this.refresh(); this.set({ notice: { tone: "info", text: `${label} saved.` } }); return result; }
      catch (error) {
        if (committed) {
          const stale = Object.assign(new Error(`${label} was committed, but the refreshed library could not be read. Do not retry the write; reload authoritative state.`), { code: "committed-stale" });
          this.set({ uncertain: true }); this.reportFailure(stale); throw stale;
        }
        if (error && typeof error === "object" && "code" in error && error.code === "commit-uncertain") this.set({ uncertain: true });
        await this.refresh().catch(() => undefined); this.reportFailure(error); throw error;
      }
      finally { this.set({ busy: false, operation: null }); }
    });
    this.pending = pending;
    this.set({ busy: true, operation: label, notice: null, generation: this.current.generation + 1 });
    void pending.catch(() => undefined); return pending;
  }
  updateMetadata(record: MediaSummary, patch: MediaMetadataPatch) {
    const store = this.requireStore("metadata");
    return this.mutate("Asset details", () => store.updateMetadata(record.id, patch, { expectedRevision: record.revision }));
  }
  createFolder(name: string, parentId: string | null, index: number, token: string) {
    const store = this.requireStore("folders");
    return this.mutate("Folder", () => store.createFolder({ name, parentId, index }, token));
  }
  updateFolder(id: string, patch: MediaFolderPatch, revision: number, token: string) {
    const store = this.requireStore("folders");
    return this.mutate("Folder", () => store.updateFolder(id, patch, { expectedRevision: revision, expectedMutationToken: token }));
  }
  changeFolderState(id: string, revision: number, restore: boolean) {
    const store = this.requireStore("folders");
    return this.mutate(restore ? "Folder restore" : "Folder trash", () => restore ? store.restoreFolder(id, { expectedRevision: revision }) : store.trashFolder(id, { expectedRevision: revision }));
  }
  move(records: readonly MediaSummary[], folderId: string | null) {
    const store = this.requireStore("metadata");
    return this.mutate("Move", async () => { for (const record of records) await store.updateMetadata(record.id, { folderId }, { expectedRevision: record.revision }); });
  }
  restore(records: readonly MediaSummary[]) {
    const store = this.requireStore("restore");
    return this.mutate("Restore", async () => { for (const record of records) await store.restore(record.id, { expectedRevision: record.revision }); });
  }
  async scan(record: MediaSummary, fresh = false): Promise<MediaUsageScan> {
    if (!this.contentServices) return { status: "unavailable", locations: [], tokens: {}, message: "Authoritative Content usage inspection is unavailable; trash is blocked." };
    return this.contentServices.scan({ providerId: this.provider.descriptor.id, assetId: record.id }, fresh);
  }
  async trash(records: readonly MediaSummary[]) {
    const store = this.requireStore("trash");
    const ownDrafts = new Set(records.filter((record) => this.hasDraft(record.id)).map(({ id }) => id));
    if (ownDrafts.size) {
      await this.flush();
      records = records.map((record) => ownDrafts.has(record.id) ? this.current.records.find(({ id }) => id === record.id)! : record);
    }
    // Capture before registering this write, so a Content flush cannot wait on itself.
    const scans = await Promise.all(records.map((record) => this.scan(record, true)));
    if (scans.some((scan) => scan.status !== "complete" || scan.locations.length > 0 || (scan.additionalLocations?.length ?? 0) > 0)) throw new Error("Trash blocked: active project uses or an incomplete authoritative scan remain.");
    return this.mutate("Trash", async () => {
      for (const [index, record] of records.entries()) {
        if (!await this.contentServices!.isCurrent(scans[index]!)) throw new Error("Content changed during the safety check. Inspect usages again.");
        await store.trash(record.id, { expectedRevision: record.revision });
      }
    });
  }
  upload(file: Blob & { name: string }, folderId: string | null): Promise<MediaRecord> {
    const store = this.requireStore("replace");
    if (typeof store.upload !== "function") return Promise.reject(new Error("Upload is unavailable."));
    return this.mutate("Upload", () => store.upload(file, { folderId }));
  }
  replace(record: MediaSummary, file: Blob) {
    const store = this.requireStore("replace");
    return this.mutate("Replacement", () => store.replace(record.id, file, { expectedRevision: record.revision }));
  }
  insert(target: MediaInsertionTarget, value: MediaUse) {
    if (!this.contentServices) return Promise.reject(new Error("Content insertion is unavailable."));
    return this.mutate("Content usage", async () => {
      const current = await this.provider.store.get(value.asset.assetId);
      if (value.asset.providerId !== this.provider.descriptor.id || current.status !== "loaded" || current.record.document.state !== "active") throw new Error("The selected Media asset is unavailable or trashed.");
      if (value.kind === "image" && !summarizeMedia(current.record).mediaType.startsWith("image/")) throw new Error("The asset is no longer an image. Choose another asset or presentation.");
      await this.contentServices!.insert(target, value);
    });
  }
  async copyUrl(record: MediaSummary) { await this.copy(record.authoringUrl); }
  async copyMarkdown(record: MediaSummary) { await this.copy(mediaMarkdown(record)); }
  async copy(text: string) { await (this.options.writeClipboard ?? ((value) => navigator.clipboard.writeText(value)))(text); this.set({ notice: { tone: "info", text: "Copied." } }); }
  dispose() { this.request++; this.listeners.clear(); }
}
export function createMediaLibraryController(provider: MediaProvider, options?: MediaLibraryControllerOptions) { return new MediaLibraryController(provider, options); }
