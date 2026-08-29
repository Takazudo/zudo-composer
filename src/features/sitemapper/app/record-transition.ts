import { cloneJson, createUuidIdFactory, isSafeRecordId, type IdFactory } from "../../../shared";
import type { SaveQueue, SaveQueueRef } from "../../../shared/persistence";
import type { SitemapRecord, SitemapRecordLoadOutcome, SitemapStore } from "../../../sitemapper/library";

export interface SitemapperRecordSession {
  readonly queue: Pick<SaveQueue<SitemapRecord>, "state" | "flush" | "close">;
  /** Synchronously lands all editor-local/debounced values in `queue.state.draft`. */
  flushPropUpdates(): void;
}

export interface SitemapperIndexTransitionState {
  readonly view: "index";
  readonly error: Error | null;
}

export interface SitemapperRecordTransitionState {
  readonly view: "record";
  readonly record: SitemapRecord;
  readonly session: SitemapperRecordSession;
  readonly error: Error | null;
}

export type SitemapperTransitionState =
  | SitemapperIndexTransitionState
  | SitemapperRecordTransitionState;

export type SitemapperTransitionResult =
  | { readonly status: "committed"; readonly state: SitemapperTransitionState }
  | { readonly status: "failed"; readonly error: Error };

export interface SitemapperRecordTransitionOptions {
  store: Pick<SitemapStore, "get" | "put">;
  createSession(record: SitemapRecord): SitemapperRecordSession;
  idFactory?: IdFactory;
  now?: () => string;
}

export interface SitemapperRecordTransitions {
  readonly state: SitemapperTransitionState;
  open(recordId: string): Promise<SitemapperTransitionResult>;
  switchTo(recordId: string): Promise<SitemapperTransitionResult>;
  backToIndex(): Promise<SitemapperTransitionResult>;
  duplicateCurrent(options?: { id?: string; name?: string }): Promise<SitemapperTransitionResult>;
  subscribe(listener: (state: SitemapperTransitionState) => void): () => void;
}

export class SitemapperTransitionError extends Error {
  readonly name = "SitemapperTransitionError";

  constructor(
    readonly code: "not-found" | "invalid-record" | "future-schema" | "load-failed" | "save-failed" | "duplicate-failed",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

function errorFromLoad(recordId: string, outcome: Exclude<SitemapRecordLoadOutcome, { status: "loaded" }>): Error {
  switch (outcome.status) {
    case "not-found":
      return new SitemapperTransitionError("not-found", `Sitemap "${recordId}" was not found.`);
    case "invalid":
      return new SitemapperTransitionError("invalid-record", outcome.issue.message);
    case "future-schema":
      return new SitemapperTransitionError(
        "future-schema",
        `Sitemap "${recordId}" uses unsupported schema version ${outcome.foundSchemaVersion}.`,
      );
  }
}

function asError(reason: unknown, code: "load-failed" | "save-failed" | "duplicate-failed", message: string): Error {
  return reason instanceof SitemapperTransitionError
    ? reason
    : new SitemapperTransitionError(code, message, { cause: reason });
}

class RecordTransitions implements SitemapperRecordTransitions {
  private current: SitemapperTransitionState = { view: "index", error: null };
  private readonly listeners = new Set<(state: SitemapperTransitionState) => void>();
  private readonly idFactory: IdFactory;
  private readonly now: () => string;

  constructor(private readonly options: SitemapperRecordTransitionOptions) {
    this.idFactory = options.idFactory ?? createUuidIdFactory();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get state(): SitemapperTransitionState {
    return this.current;
  }

  subscribe(listener: (state: SitemapperTransitionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  async open(recordId: string): Promise<SitemapperTransitionResult> {
    if (this.current.view === "record" && this.current.record.id === recordId) {
      return { status: "committed", state: this.current };
    }

    let outcome: SitemapRecordLoadOutcome;
    try {
      outcome = await this.options.store.get(recordId);
    } catch (reason) {
      return this.fail(asError(reason, "load-failed", `Could not load sitemap "${recordId}".`));
    }
    if (outcome.status !== "loaded") return this.fail(errorFromLoad(recordId, outcome));

    let nextSession: SitemapperRecordSession;
    try {
      nextSession = this.options.createSession(cloneJson(outcome.record));
    } catch (reason) {
      return this.fail(asError(reason, "load-failed", `Could not open sitemap "${recordId}".`));
    }
    if (!(await this.leaveCurrent())) {
      await nextSession.queue.close().catch(() => undefined);
      return { status: "failed", error: this.current.error! };
    }
    return this.commit({ view: "record", record: outcome.record, session: nextSession, error: null });
  }

  switchTo(recordId: string): Promise<SitemapperTransitionResult> {
    return this.open(recordId);
  }

  async backToIndex(): Promise<SitemapperTransitionResult> {
    if (!(await this.leaveCurrent())) return { status: "failed", error: this.current.error! };
    return this.commit({ view: "index", error: null });
  }

  async duplicateCurrent(
    options: { id?: string; name?: string } = {},
  ): Promise<SitemapperTransitionResult> {
    if (this.current.view !== "record") {
      return this.fail(new SitemapperTransitionError("duplicate-failed", "No sitemap is currently open."));
    }
    const sourceState = this.current;
    try {
      // The draft is read only after the debounce has landed and persistence has
      // caught up, so duplication never falls back to the last-loaded record.
      sourceState.session.flushPropUpdates();
      await sourceState.session.queue.flush();
      const source = sourceState.session.queue.state.draft;
      const id = options.id ?? this.idFactory(source.document.name);
      if (!isSafeRecordId(id) || id === source.id) {
        throw new SitemapperTransitionError("duplicate-failed", "Duplication requires a fresh, non-empty sitemap id.");
      }
      const existing = await this.options.store.get(id);
      if (existing.status !== "not-found") {
        throw new SitemapperTransitionError("duplicate-failed", `Sitemap "${id}" already exists.`);
      }
      const timestamp = this.now();
      const duplicate: SitemapRecord = {
        id,
        createdAt: timestamp,
        updatedAt: timestamp,
        document: {
          ...cloneJson(source.document),
          id,
          name: options.name ?? `${source.document.name} copy`,
        },
      };
      await this.options.store.put(duplicate);
      const nextSession = this.options.createSession(cloneJson(duplicate));
      await sourceState.session.queue.close();
      return this.commit({ view: "record", record: duplicate, session: nextSession, error: null });
    } catch (reason) {
      return this.fail(asError(reason, "duplicate-failed", "Could not duplicate the current sitemap."));
    }
  }

  private async leaveCurrent(): Promise<boolean> {
    if (this.current.view !== "record") return true;
    const state = this.current;
    try {
      // This order is load-bearing: close detaches the queue and would drop a
      // pending draft if it happened before either flush.
      state.session.flushPropUpdates();
      await state.session.queue.flush();
      await state.session.queue.close();
      return true;
    } catch (reason) {
      this.fail(asError(reason, "save-failed", "Could not save the current sitemap."));
      return false;
    }
  }

  private fail(error: Error): { status: "failed"; error: Error } {
    this.current = { ...this.current, error };
    this.publish();
    return { status: "failed", error };
  }

  private commit(state: SitemapperTransitionState): { status: "committed"; state: SitemapperTransitionState } {
    this.current = state;
    this.publish();
    return { status: "committed", state };
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener(this.current);
  }
}

/** Starts at the library index every time; v1 intentionally persists no last-opened pointer. */
export function createSitemapperRecordTransitions(
  options: SitemapperRecordTransitionOptions,
): SitemapperRecordTransitions {
  return new RecordTransitions(options);
}

export type SitemapperRecordRef = SaveQueueRef;
