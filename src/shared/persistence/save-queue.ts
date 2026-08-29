// Revision-aware persistence coordination shared by the authoring sub-apps.
//
// The queue owns the single-flight/latest-wins contract: edits are detached
// and frozen immediately, at most one write is active, and edits made while it
// is active collapse into the newest retained revision. It deliberately knows
// only about provider-qualified refs and records with ids.

import { cloneJson } from "../json";

/** The minimum record shape required by the queue. */
export type SaveQueueRecord = { id: string };

/** Provider-qualified identity used to scope a queue and its records. */
export interface SaveQueueRef {
  readonly providerId: string;
  readonly recordId: string;
}

export interface SaveQueueSnapshot<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
> {
  readonly ref: Readonly<TRef>;
  readonly revision: number;
  /** A detached, deeply frozen copy of the draft accepted for this revision. */
  readonly record: TRecord;
}

export type SaveSnapshot<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
> = SaveQueueSnapshot<TRecord, TRef>;

interface SaveQueueStateBase<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef,
> {
  readonly ref: Readonly<TRef>;
  readonly draft: TRecord;
  readonly draftRevision: number;
  readonly savedRevision: number;
  readonly closed: boolean;
}

export interface SaveQueueDirtyState<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
> extends SaveQueueStateBase<TRecord, TRef> {
  readonly status: "dirty";
  readonly dirty: true;
  readonly saving: false;
  readonly error: null;
}

export interface SaveQueueSavingState<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
> extends SaveQueueStateBase<TRecord, TRef> {
  readonly status: "saving";
  readonly dirty: true;
  readonly saving: true;
  readonly error: null;
  readonly savingRevision: number;
}

export interface SaveQueueSavedState<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
  TResult = void,
> extends SaveQueueStateBase<TRecord, TRef> {
  readonly status: "saved";
  readonly dirty: false;
  readonly saving: false;
  readonly error: null;
  /** Present only when a provider reports canonical and derived output separately. */
  readonly outcome?: TResult;
}

export interface SaveQueueErrorState<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
> extends SaveQueueStateBase<TRecord, TRef> {
  readonly status: "error";
  readonly dirty: true;
  readonly saving: false;
  readonly error: Error;
  readonly failedRevision: number;
}

export type SaveQueueState<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
  TResult = void,
> =
  | SaveQueueDirtyState<TRecord, TRef>
  | SaveQueueSavingState<TRecord, TRef>
  | SaveQueueSavedState<TRecord, TRef, TResult>
  | SaveQueueErrorState<TRecord, TRef>;

export type SaveQueueListener<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
  TResult = void,
> = (state: SaveQueueState<TRecord, TRef, TResult>) => void;

export type SaveQueueWriter<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
  TResult = void,
> = (snapshot: SaveQueueSnapshot<TRecord, TRef>) => Promise<TResult>;

export interface SaveQueueOptions<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
  TResult = void,
> {
  readonly ref: TRef;
  /** The already-persisted record from which revision zero starts. */
  readonly initialRecord: TRecord;
  readonly write: SaveQueueWriter<TRecord, TRef, TResult>;
}

export interface SaveQueue<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
  TResult = void,
> {
  readonly ref: Readonly<TRef>;
  readonly state: SaveQueueState<TRecord, TRef, TResult>;

  /** Accept a new draft and synchronously return its monotonically increasing revision. */
  edit(ref: TRef, record: TRecord): number;
  /** Retry the newest retained draft after a failure. */
  retry(): void;
  /** Resolve once the newest draft is saved, or reject at the first persistent failure. */
  flush(): Promise<void>;
  /**
   * Detach immediately and resolve after the current write settles. Pending drafts are not
   * started; route transitions that require persistence must successfully flush first.
   */
  close(): Promise<void>;
  /** Subscribe to state transitions. The current state is delivered immediately. */
  subscribe(listener: SaveQueueListener<TRecord, TRef, TResult>): () => void;
}

export class SaveQueueIdentityError<TRef extends SaveQueueRef = SaveQueueRef> extends Error {
  readonly name: string = "SaveQueueIdentityError";

  constructor(
    readonly expected: Readonly<TRef>,
    readonly received: Readonly<TRef>,
  ) {
    super(
      `Save queue identity mismatch: expected ${expected.providerId}/${expected.recordId}, ` +
        `received ${received.providerId}/${received.recordId}.`,
    );
  }
}

export class SaveQueueClosedError extends Error {
  readonly name: string = "SaveQueueClosedError";

  constructor(message = "The save queue is closed.") {
    super(message);
  }
}

interface SaveQueueErrorFactory<TRef extends SaveQueueRef> {
  identity(
    expected: Readonly<TRef>,
    received: Readonly<TRef>,
  ): SaveQueueIdentityError<TRef>;
  closed(): SaveQueueClosedError;
  persistence(reason: unknown): Error;
}

interface Attempt<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef,
> {
  readonly token: symbol;
  readonly snapshot: SaveQueueSnapshot<TRecord, TRef>;
  readonly settled: Promise<void>;
}

interface FlushWaiter {
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneRecord<TRecord extends SaveQueueRecord>(record: TRecord): TRecord {
  return deepFreeze(cloneJson(record));
}

function cloneRef<TRef extends SaveQueueRef>(ref: TRef): Readonly<TRef> {
  return Object.freeze({ ...ref }) as Readonly<TRef>;
}

function sameRef(a: Readonly<SaveQueueRef>, b: Readonly<SaveQueueRef>): boolean {
  return a.providerId === b.providerId && a.recordId === b.recordId;
}

function saveError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("Persistence failed.", { cause: reason });
}

function documentId(record: SaveQueueRecord): { present: boolean; id: unknown } {
  if (!("document" in record)) return { present: false, id: undefined };
  const document = (record as SaveQueueRecord & { document?: unknown }).document;
  if (document !== null && (typeof document === "object" || typeof document === "function")) {
    return { present: true, id: (document as { id?: unknown }).id };
  }
  return { present: true, id: undefined };
}

class RevisionAwareSaveQueue<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef,
  TResult,
> implements SaveQueue<TRecord, TRef, TResult> {
  readonly ref: Readonly<TRef>;

  private readonly write: SaveQueueWriter<TRecord, TRef, TResult>;
  private readonly errors: SaveQueueErrorFactory<TRef>;
  private readonly listeners = new Set<SaveQueueListener<TRecord, TRef, TResult>>();
  private readonly flushWaiters = new Set<FlushWaiter>();
  private latest: SaveQueueSnapshot<TRecord, TRef>;
  private savedRevision = 0;
  private lastOutcome: TResult | undefined;
  private active: Attempt<TRecord, TRef> | null = null;
  private failure: { revision: number; error: Error } | null = null;
  private isClosed = false;
  private closePromise: Promise<void> | null = null;
  private currentState: SaveQueueState<TRecord, TRef, TResult>;

  constructor(
    options: SaveQueueOptions<TRecord, TRef, TResult>,
    errors: SaveQueueErrorFactory<TRef>,
  ) {
    this.ref = cloneRef(options.ref);
    this.errors = errors;
    this.assertIdentity(options.ref, options.initialRecord);
    this.write = options.write;
    this.latest = deepFreeze({
      ref: this.ref,
      revision: 0,
      record: cloneRecord(options.initialRecord),
    });
    this.currentState = this.buildState();
  }

  get state(): SaveQueueState<TRecord, TRef, TResult> {
    return this.currentState;
  }

  edit(ref: TRef, record: TRecord): number {
    this.assertOpen();
    this.assertIdentity(ref, record);

    const revision = this.latest.revision + 1;
    this.latest = deepFreeze({ ref: this.ref, revision, record: cloneRecord(record) });
    this.failure = null;
    this.lastOutcome = undefined;
    this.publish();
    this.startNewestAttempt();
    return revision;
  }

  retry(): void {
    this.assertOpen();
    if (this.active || this.savedRevision === this.latest.revision) return;
    this.failure = null;
    this.publish();
    this.startNewestAttempt();
  }

  flush(): Promise<void> {
    if (this.isClosed) return Promise.reject(this.errors.closed());
    if (this.failure) return Promise.reject(this.failure.error);
    if (this.savedRevision === this.latest.revision) return Promise.resolve();

    const promise = new Promise<void>((resolve, reject) => {
      this.flushWaiters.add({ resolve, reject });
    });
    this.startNewestAttempt();
    return promise;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    this.isClosed = true;
    const error = this.errors.closed();
    this.rejectFlushWaiters(error);
    const activeSettlement = this.active?.settled ?? Promise.resolve();
    this.publish();
    this.closePromise = activeSettlement.then(() => undefined);
    return this.closePromise;
  }

  subscribe(listener: SaveQueueListener<TRecord, TRef, TResult>): () => void {
    this.listeners.add(listener);
    this.deliver(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private assertOpen(): void {
    if (this.isClosed) throw this.errors.closed();
  }

  private assertIdentity(ref: TRef, record: TRecord): void {
    if (!sameRef(this.ref, ref)) throw this.errors.identity(this.ref, ref);
    if (ref.recordId !== record.id) {
      throw this.errors.identity(this.ref, {
        providerId: ref.providerId,
        recordId: record.id,
      } as TRef);
    }
    const nested = documentId(record);
    if (nested.present && nested.id !== record.id) {
      throw this.errors.identity(this.ref, {
        providerId: ref.providerId,
        recordId: nested.id as string,
      } as TRef);
    }
  }

  private startNewestAttempt(): void {
    if (
      this.isClosed ||
      this.active ||
      this.failure ||
      this.savedRevision === this.latest.revision
    ) {
      return;
    }

    const snapshot = this.latest;
    const token = Symbol(`save-${snapshot.revision}`);
    const settled = Promise.resolve()
      .then(() => this.write(snapshot))
      .then(
        (result) => this.finishSuccess(token, snapshot, result),
        (reason: unknown) => this.finishFailure(token, snapshot, reason),
      );
    this.active = { token, snapshot, settled };
    this.publish();
  }

  private finishSuccess(
    token: symbol,
    snapshot: SaveQueueSnapshot<TRecord, TRef>,
    result: TResult,
  ): void {
    if (!this.active || this.active.token !== token) return;
    this.active = null;
    if (this.isClosed || !sameRef(snapshot.ref, this.ref)) return;

    this.savedRevision = Math.max(this.savedRevision, snapshot.revision);
    this.lastOutcome = result === undefined ? undefined : result;
    this.publish();
    if (this.savedRevision === this.latest.revision) {
      this.resolveFlushWaiters();
      return;
    }
    this.startNewestAttempt();
  }

  private finishFailure(
    token: symbol,
    snapshot: SaveQueueSnapshot<TRecord, TRef>,
    reason: unknown,
  ): void {
    if (!this.active || this.active.token !== token) return;
    this.active = null;
    if (this.isClosed || !sameRef(snapshot.ref, this.ref)) return;

    const error = this.errors.persistence(reason);
    this.failure = { revision: snapshot.revision, error };
    this.rejectFlushWaiters(error);
    this.publish();
  }

  private buildState(): SaveQueueState<TRecord, TRef, TResult> {
    const base = {
      ref: this.ref,
      draft: this.latest.record,
      draftRevision: this.latest.revision,
      savedRevision: this.savedRevision,
      closed: this.isClosed,
    } as const;

    if (this.failure) {
      return Object.freeze({
        ...base,
        status: "error",
        dirty: true,
        saving: false,
        error: this.failure.error,
        failedRevision: this.failure.revision,
      });
    }
    if (this.active && !this.isClosed) {
      return Object.freeze({
        ...base,
        status: "saving",
        dirty: true,
        saving: true,
        error: null,
        savingRevision: this.active.snapshot.revision,
      });
    }
    if (this.savedRevision === this.latest.revision) {
      return Object.freeze({
        ...base,
        status: "saved",
        dirty: false,
        saving: false,
        error: null,
        ...(this.lastOutcome === undefined ? {} : { outcome: this.lastOutcome }),
      });
    }
    return Object.freeze({
      ...base,
      status: "dirty",
      dirty: true,
      saving: false,
      error: null,
    });
  }

  private publish(): void {
    this.currentState = this.buildState();
    for (const listener of [...this.listeners]) this.deliver(listener);
  }

  private deliver(listener: SaveQueueListener<TRecord, TRef, TResult>): void {
    try {
      listener(this.currentState);
    } catch {
      // State observers must not corrupt persistence ordering or reject an internal write.
    }
  }

  private resolveFlushWaiters(): void {
    if (this.savedRevision !== this.latest.revision || this.failure || this.isClosed) return;
    const waiters = [...this.flushWaiters];
    this.flushWaiters.clear();
    for (const waiter of waiters) waiter.resolve();
  }

  private rejectFlushWaiters(error: Error): void {
    const waiters = [...this.flushWaiters];
    this.flushWaiters.clear();
    for (const waiter of waiters) waiter.reject(error);
  }
}

export function createSaveQueue<
  TRecord extends SaveQueueRecord,
  TRef extends SaveQueueRef = SaveQueueRef,
  TResult = void,
>(
  options: SaveQueueOptions<TRecord, TRef, TResult>,
  errorFactory?: Partial<SaveQueueErrorFactory<TRef>>,
): SaveQueue<TRecord, TRef, TResult> {
  const defaults: SaveQueueErrorFactory<TRef> = {
    identity: (expected, received) => new SaveQueueIdentityError(expected, received),
    closed: () => new SaveQueueClosedError(),
    persistence: saveError,
  };
  return new RevisionAwareSaveQueue(options, {
    identity: errorFactory?.identity ?? defaults.identity,
    closed: errorFactory?.closed ?? defaults.closed,
    persistence: errorFactory?.persistence ?? defaults.persistence,
  });
}
