import type { MediaInitializationOutcome, MediaProvider, MediaSummary } from "../../media";

export type MediaLibraryView = "gallery" | "details";
export type MediaReferenceScan =
  | { status: "idle" }
  | { status: "scanning"; mediaId: string }
  | { status: "complete"; mediaId: string; references: readonly string[] }
  | { status: "unavailable"; mediaId: string; message: string }
  | { status: "error"; mediaId: string; message: string };

export interface MediaLibraryState {
  phase: "idle" | "loading" | "ready" | "recovery" | "error";
  records: readonly MediaSummary[];
  view: MediaLibraryView;
  message: string;
  recoveryMessage: string | null;
  referenceScan: MediaReferenceScan;
}

export interface MediaLibraryControllerOptions {
  writeClipboard?: (text: string) => void | Promise<void>;
  /** Integrations may scan known sources, but these results can never prove safety. */
  scanReferences?: (mediaUrl: string) => Promise<readonly string[]>;
}

const initialState: MediaLibraryState = { phase: "idle", records: [], view: "gallery", message: "", recoveryMessage: null, referenceScan: { status: "idle" } };
const errorMessage = (reason: unknown, fallback: string): string => reason instanceof Error ? reason.message : fallback;
const MEDIA_PUBLIC_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const satisfies Record<MediaSummary["mediaType"], string>;

export function mediaPublicFileName(record: Pick<MediaSummary, "id" | "mediaType">): string {
  return `media-${record.id}.${MEDIA_PUBLIC_EXTENSION[record.mediaType]}`;
}

export function mediaUrl(record: Pick<MediaSummary, "id" | "mediaType">): string {
  return `/uploaded-media/${encodeURIComponent(mediaPublicFileName(record))}`;
}

export function mediaMarkdown(record: Pick<MediaSummary, "id" | "mediaType" | "fileName">): string {
  const alt = record.fileName
    .replace(/\.[^.]+$/, "")
    .replace(/([\\[\]])/g, "\\$1");
  return `![${alt}](${mediaUrl(record)})`;
}

export class MediaLibraryController {
  private current: MediaLibraryState = initialState;
  private readonly listeners = new Set<(state: MediaLibraryState) => void>();
  private readonly writeClipboard: (text: string) => void | Promise<void>;
  private readonly scanReferences?: (mediaUrl: string) => Promise<readonly string[]>;
  private listRequestId = 0;
  private referenceRequestId = 0;
  private alive = true;

  constructor(readonly provider: MediaProvider, options: MediaLibraryControllerOptions = {}) {
    this.writeClipboard = options.writeClipboard ?? ((text) => {
      if (!globalThis.navigator?.clipboard) throw new Error("Clipboard access is unavailable.");
      return globalThis.navigator.clipboard.writeText(text);
    });
    this.scanReferences = options.scanReferences;
  }

  get state(): MediaLibraryState { return this.current; }
  subscribe(listener: (state: MediaLibraryState) => void): () => void { this.listeners.add(listener); listener(this.current); return () => this.listeners.delete(listener); }
  async initialize(): Promise<void> { await this.runInitialization(() => this.provider.initialization.initialize()); }
  async retryInitialization(): Promise<void> { await this.runInitialization(() => this.provider.initialization.retry()); }
  async startFresh(): Promise<void> { await this.runInitialization(() => this.provider.initialization.startFresh()); }
  setView(view: MediaLibraryView): void { this.set({ ...this.current, view }); }

  async refresh(): Promise<void> {
    const requestId = ++this.listRequestId;
    try {
      const records = await this.provider.store.list();
      if (!this.isCurrentList(requestId)) return;
      this.set({ ...this.current, phase: "ready", records, message: "Media library refreshed." });
    } catch (reason) {
      if (!this.isCurrentList(requestId)) return;
      this.set({ ...this.current, phase: "error", message: errorMessage(reason, "Media listing failed.") });
    }
  }

  async copyMarkdown(record: MediaSummary): Promise<void> {
    await this.writeClipboard(mediaMarkdown(record));
    if (this.alive) this.set({ ...this.current, message: `Copied Markdown for ${record.fileName}.` });
  }

  async scanDeleteReferences(record: MediaSummary): Promise<void> {
    const requestId = ++this.referenceRequestId;
    if (!this.scanReferences) {
      this.set({ ...this.current, referenceScan: { status: "unavailable", mediaId: record.id, message: "No enumerable reference sources are connected to this surface." } });
      return;
    }
    this.set({ ...this.current, referenceScan: { status: "scanning", mediaId: record.id } });
    try {
      const references = await this.scanReferences(mediaUrl(record));
      if (!this.alive || requestId !== this.referenceRequestId) return;
      this.set({ ...this.current, referenceScan: { status: "complete", mediaId: record.id, references } });
    } catch (reason) {
      if (!this.alive || requestId !== this.referenceRequestId) return;
      this.set({ ...this.current, referenceScan: { status: "error", mediaId: record.id, message: errorMessage(reason, "Reference scan failed.") } });
    }
  }

  clearReferenceScan(): void { this.referenceRequestId += 1; this.set({ ...this.current, referenceScan: { status: "idle" } }); }

  async deleteMedia(id: string): Promise<void> {
    const deleted = await this.provider.store.delete(id);
    if (!this.alive) return;
    this.set({ ...this.current, records: this.current.records.filter((record) => record.id !== id), referenceScan: { status: "idle" }, message: deleted ? "Media deleted." : "Media was already absent." });
  }

  dispose(): void { this.alive = false; this.listRequestId += 1; this.referenceRequestId += 1; this.listeners.clear(); }

  private async runInitialization(load: () => Promise<MediaInitializationOutcome>): Promise<void> {
    const requestId = ++this.listRequestId;
    this.set({ ...this.current, phase: "loading", message: "Loading Media library…" });
    try {
      const outcome = await load();
      if (!this.isCurrentList(requestId)) return;
      if (outcome.status === "ready") this.set({ ...initialState, phase: "ready", records: outcome.summaries, view: this.current.view, message: "Media library ready." });
      else if (outcome.status === "recovery-required") this.set({ ...initialState, phase: "recovery", records: outcome.summaries, view: this.current.view, recoveryMessage: outcome.recovery.message, message: "Recovery required. Source data was preserved." });
      else this.set({ ...initialState, phase: "error", view: this.current.view, message: outcome.error.message });
    } catch (reason) {
      if (this.isCurrentList(requestId)) this.set({ ...initialState, phase: "error", view: this.current.view, message: errorMessage(reason, "Media library initialization failed.") });
    }
  }

  private isCurrentList(requestId: number): boolean { return this.alive && requestId === this.listRequestId; }
  private set(state: MediaLibraryState): void { if (!this.alive) return; this.current = state; for (const listener of [...this.listeners]) listener(state); }
}

export function createMediaLibraryController(provider: MediaProvider, options?: MediaLibraryControllerOptions): MediaLibraryController {
  return new MediaLibraryController(provider, options);
}
