import type { MediaInitializationOutcome, MediaProvider, MediaSummary } from "../../media";

export type MediaReferenceScan =
  | { status: "idle" }
  | { status: "scanning"; mediaId: string }
  | { status: "complete"; mediaId: string; references: readonly string[] }
  | { status: "unavailable"; mediaId: string; message: string }
  | { status: "error"; mediaId: string; message: string };

/**
 * Feedback for one completed action, rendered as a dismissible `Banner`.
 *
 * The route used to keep a `message` string in the header and rewrite it on
 * every transition, which made a permanent line of prose out of what is really
 * an event. A notice is replaced by the next action and can be dismissed;
 * durable state (connected provider, failed store) is a chip or a banner of its
 * own, never this.
 */
export interface MediaNotice {
  readonly tone: "info" | "err";
  readonly text: string;
}

export interface MediaLibraryState {
  phase: "idle" | "loading" | "ready" | "recovery" | "error";
  records: readonly MediaSummary[];
  /** Why the store could not be read; only set in the `error` phase. */
  errorMessage: string | null;
  recoveryMessage: string | null;
  notice: MediaNotice | null;
  referenceScan: MediaReferenceScan;
}

export interface MediaLibraryControllerOptions {
  writeClipboard?: (text: string) => void | Promise<void>;
  /** Integrations may scan known sources, but these results can never prove safety. */
  scanReferences?: (mediaUrl: string) => Promise<readonly string[]>;
}

const initialState: MediaLibraryState = {
  phase: "idle",
  records: [],
  errorMessage: null,
  recoveryMessage: null,
  notice: null,
  referenceScan: { status: "idle" },
};

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

  /** Reports an action failure raised outside the controller's own methods. */
  reportFailure(reason: unknown, fallback = "Media action failed."): void {
    this.set({ ...this.current, notice: { tone: "err", text: errorMessage(reason, fallback) } });
  }

  clearNotice(): void {
    if (this.current.notice !== null) this.set({ ...this.current, notice: null });
  }

  async refresh(): Promise<void> {
    const requestId = ++this.listRequestId;
    try {
      const records = await this.provider.store.list();
      if (!this.isCurrentList(requestId)) return;
      // A listing only reports the records that read correctly, so it is no
      // answer to a quarantine: an upload must not silently dismiss the
      // recovery banner. Only a fresh initialization can leave that phase.
      const phase = this.current.phase === "recovery" ? "recovery" : "ready";
      this.set({ ...this.current, phase, errorMessage: null, records });
    } catch (reason) {
      if (!this.isCurrentList(requestId)) return;
      this.set({ ...this.current, phase: "error", errorMessage: errorMessage(reason, "Media listing failed.") });
    }
  }

  async copyMarkdown(record: MediaSummary): Promise<void> {
    await this.writeClipboard(mediaMarkdown(record));
    this.note(`Copied Markdown for ${record.fileName}.`);
  }

  async copyUrl(record: MediaSummary): Promise<void> {
    await this.writeClipboard(mediaUrl(record));
    this.note(`Copied the public URL for ${record.fileName}.`);
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

  /**
   * Deletes one asset or a whole bulk selection. Failures are reported per
   * record rather than as one rollback: a bulk delete that stops halfway must
   * still drop the assets that are actually gone, or the grid lies.
   */
  async deleteMedia(targets: readonly MediaSummary[]): Promise<void> {
    const deleted = new Set<string>();
    let failure: unknown;
    for (const target of targets) {
      try {
        await this.provider.store.delete(target.id);
        deleted.add(target.id);
      } catch (reason) {
        failure = reason;
        break;
      }
    }
    if (!this.alive) return;
    const first = targets[0];
    this.set({
      ...this.current,
      records: this.current.records.filter((record) => !deleted.has(record.id)),
      referenceScan: { status: "idle" },
      notice: failure !== undefined
        ? { tone: "err", text: errorMessage(failure, "The media could not be deleted.") }
        : { tone: "info", text: deleted.size === 1 && first ? `Deleted ${first.fileName}.` : `Deleted ${deleted.size} assets.` },
    });
  }

  dispose(): void { this.alive = false; this.listRequestId += 1; this.referenceRequestId += 1; this.listeners.clear(); }

  private note(text: string): void {
    this.set({ ...this.current, notice: { tone: "info", text } });
  }

  private async runInitialization(load: () => Promise<MediaInitializationOutcome>): Promise<void> {
    const requestId = ++this.listRequestId;
    this.set({ ...this.current, phase: "loading", errorMessage: null, notice: null });
    try {
      const outcome = await load();
      if (!this.isCurrentList(requestId)) return;
      if (outcome.status === "ready") this.set({ ...initialState, phase: "ready", records: outcome.summaries });
      else if (outcome.status === "recovery-required") this.set({ ...initialState, phase: "recovery", records: outcome.summaries, recoveryMessage: outcome.recovery.message });
      else this.set({ ...initialState, phase: "error", errorMessage: outcome.error.message });
    } catch (reason) {
      if (this.isCurrentList(requestId)) this.set({ ...initialState, phase: "error", errorMessage: errorMessage(reason, "Media library initialization failed.") });
    }
  }

  private isCurrentList(requestId: number): boolean { return this.alive && requestId === this.listRequestId; }
  private set(state: MediaLibraryState): void { if (!this.alive) return; this.current = state; for (const listener of [...this.listeners]) listener(state); }
}

export function createMediaLibraryController(provider: MediaProvider, options?: MediaLibraryControllerOptions): MediaLibraryController {
  return new MediaLibraryController(provider, options);
}
