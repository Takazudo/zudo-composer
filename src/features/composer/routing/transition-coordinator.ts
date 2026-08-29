import type {
  CompositionLoadOutcome,
  CompositionProviderId,
  CompositionRecord,
  CompositionRecordRef,
  CompositionSaveOutcome,
  SaveQueue,
  CompositionSummary,
} from "../../../composer/browser";

import type { ComposerProviderPreference } from "./provider-preference";
import type { ComposerRoute, ComposerRouteError, ComposerRouteResolution } from "./route";

export interface ComposerRoutingProvider {
  readonly id: CompositionProviderId;
  list(): Promise<readonly CompositionSummary[]>;
  get(recordId: string): Promise<CompositionLoadOutcome>;
}

export interface ComposerRoutingProviderRegistry {
  get(providerId: string): ComposerRoutingProvider | undefined;
}

export interface ComposerDetailSession {
  /** The queue is permanently bound to one provider-qualified record identity. */
  readonly queue: Pick<SaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>, "ref" | "state" | "flush">;
  /** Lands editor-local/debounced props into that queue before it is flushed. */
  flushPendingProps(ref: Readonly<CompositionRecordRef>): void | Promise<void>;
}

export interface ComposerTransitionHistory {
  push(url: string): void;
  replace(url: string): void;
}

interface ComposerCommittedStateBase {
  readonly url: string;
  readonly generation: number;
}

export interface ComposerIndexState extends ComposerCommittedStateBase {
  readonly view: "index";
  readonly route: Extract<ComposerRoute, { kind: "index" }>;
  readonly providerId: CompositionProviderId;
  readonly collection: readonly CompositionSummary[];
}

export interface ComposerDetailState extends ComposerCommittedStateBase {
  readonly view: "detail";
  readonly route: Extract<ComposerRoute, { kind: "detail" }>;
  readonly providerId: CompositionProviderId;
  readonly collection: readonly CompositionSummary[];
  readonly record: CompositionRecord;
  readonly draft: CompositionRecord;
  readonly session: ComposerDetailSession;
}

export interface ComposerNotFoundState extends ComposerCommittedStateBase {
  readonly view: "not-found";
  readonly route: ComposerRoute | null;
  readonly error: ComposerRouteError | ComposerTransitionError;
}

export type ComposerCommittedState =
  | ComposerIndexState
  | ComposerDetailState
  | ComposerNotFoundState;

export type ComposerTransitionErrorCode =
  | "unknown-provider"
  | "collection-load-failed"
  | "record-load-failed"
  | "record-not-found"
  | "invalid-record"
  | "future-schema"
  | "detail-session-failed"
  | "flush-failed"
  | "history-write-failed";

export class ComposerTransitionError extends Error {
  readonly name = "ComposerTransitionError";

  constructor(
    readonly code: ComposerTransitionErrorCode,
    message: string,
    readonly ref?: Readonly<CompositionRecordRef>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type ComposerTransitionResult =
  | { readonly status: "committed"; readonly state: ComposerCommittedState }
  | { readonly status: "rolled-back"; readonly error: ComposerTransitionError }
  | { readonly status: "stale" };

export interface ComposerTransitionIntent {
  readonly resolution: ComposerRouteResolution;
  /** Exact pathname + hash observed or requested for this intent. */
  readonly url: string;
  /** History events/direct loads already changed the address bar. */
  readonly history: "push" | "replace" | "already-applied";
  /** Explicit index provider switch; otherwise preference/default is used. */
  readonly indexProviderId?: CompositionProviderId;
}

export interface ComposerTransitionCoordinatorOptions {
  readonly registry: ComposerRoutingProviderRegistry;
  readonly defaultProviderId: CompositionProviderId;
  readonly preference?: ComposerProviderPreference;
  readonly history?: ComposerTransitionHistory;
  readonly createDetailSession: (
    ref: Readonly<CompositionRecordRef>,
    record: CompositionRecord,
  ) => ComposerDetailSession | Promise<ComposerDetailSession>;
}

export interface ComposerTransitionCoordinator {
  readonly state: ComposerCommittedState | null;
  readonly generation: number;
  transition(intent: ComposerTransitionIntent): Promise<ComposerTransitionResult>;
  cancel(): void;
  subscribe(listener: (state: ComposerCommittedState) => void): () => void;
}

function sameRef(a: Readonly<CompositionRecordRef>, b: Readonly<CompositionRecordRef>): boolean {
  return a.providerId === b.providerId && a.recordId === b.recordId;
}

function detailRef(state: ComposerDetailState): Readonly<CompositionRecordRef> {
  return { providerId: state.providerId, recordId: state.route.recordId };
}

function loadError(
  code: "collection-load-failed" | "record-load-failed",
  providerId: CompositionProviderId,
  recordId: string | undefined,
  cause: unknown,
): ComposerTransitionError {
  const ref = recordId === undefined ? undefined : { providerId, recordId };
  const subject = code === "collection-load-failed" ? "collection" : `record "${recordId}"`;
  return new ComposerTransitionError(
    code,
    `Could not load the ${subject} from provider "${providerId}".`,
    ref,
    { cause },
  );
}

function recordOutcome(
  ref: Readonly<CompositionRecordRef>,
  outcome: CompositionLoadOutcome,
): CompositionRecord {
  switch (outcome.status) {
    case "loaded":
      return outcome.record;
    case "not-found":
      throw new ComposerTransitionError(
        "record-not-found",
        `Composition "${ref.recordId}" was not found in provider "${ref.providerId}".`,
        ref,
      );
    case "invalid":
      throw new ComposerTransitionError(
        "invalid-record",
        `Composition "${ref.recordId}" is invalid: ${outcome.issue.message}`,
        ref,
      );
    case "future-schema":
      throw new ComposerTransitionError(
        "future-schema",
        `Composition "${ref.recordId}" uses unsupported schema version ${outcome.foundSchemaVersion}.`,
        ref,
      );
  }
}

class LatestIntentComposerTransitionCoordinator implements ComposerTransitionCoordinator {
  private readonly options: ComposerTransitionCoordinatorOptions;
  private readonly listeners = new Set<(state: ComposerCommittedState) => void>();
  private current: ComposerCommittedState | null = null;
  private currentGeneration = 0;

  constructor(options: ComposerTransitionCoordinatorOptions) {
    this.options = options;
  }

  get state(): ComposerCommittedState | null {
    return this.current;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  cancel(): void {
    this.currentGeneration += 1;
  }

  subscribe(listener: (state: ComposerCommittedState) => void): () => void {
    this.listeners.add(listener);
    if (this.current) this.deliver(listener, this.current);
    return () => this.listeners.delete(listener);
  }

  async transition(intent: ComposerTransitionIntent): Promise<ComposerTransitionResult> {
    const generation = ++this.currentGeneration;
    const prior = this.current;

    if (this.isSameCommittedTarget(prior, intent)) {
      const matchingPrior = prior as ComposerIndexState | ComposerDetailState;
      try {
        this.applyHistory(intent);
      } catch (cause) {
        return this.rollback(
          generation,
          matchingPrior,
          new ComposerTransitionError(
            "history-write-failed",
            `Could not update Composer history to "${intent.url}".`,
            undefined,
            { cause },
          ),
        );
      }
      return { status: "committed", state: matchingPrior };
    }

    if (prior?.view === "detail") {
      const flushResult = await this.flushPriorDetail(prior, generation);
      if (flushResult) return flushResult;
    }

    if (!this.isCurrent(generation)) return { status: "stale" };

    if (intent.resolution.status === "not-found") {
      const state: ComposerNotFoundState = {
        view: "not-found",
        route: null,
        error: intent.resolution.error,
        url: intent.url,
        generation,
      };
      return this.commitTarget(state, intent, prior, generation);
    }

    const route = intent.resolution.route;
    try {
      const state =
        route.kind === "index"
          ? await this.loadIndex(route, intent, generation)
          : await this.loadDetail(route, intent.url, generation);
      if (!this.isCurrent(generation)) return { status: "stale" };
      // Target reads and detail-session construction are asynchronous while
      // the prior editor intentionally remains mounted. Land and persist any
      // edits made during that wait at the final commit boundary too; the
      // first flush above only protects edits that existed when loading began.
      if (prior?.view === "detail") {
        const finalFlushResult = await this.flushPriorDetail(prior, generation);
        if (finalFlushResult) return finalFlushResult;
      }
      if (!this.isCurrent(generation)) return { status: "stale" };
      return this.commitTarget(state, intent, prior, generation);
    } catch (cause) {
      if (!this.isCurrent(generation)) return { status: "stale" };
      const error =
        cause instanceof ComposerTransitionError
          ? cause
          : new ComposerTransitionError(
              "record-load-failed",
              "The Composer target could not be loaded.",
              undefined,
              { cause },
            );
      return this.rollbackOrCommitInitialError(generation, prior, intent, route, error);
    }
  }

  private isCurrent(generation: number): boolean {
    return generation === this.currentGeneration;
  }

  private isSameCommittedTarget(
    prior: ComposerCommittedState | null,
    intent: ComposerTransitionIntent,
  ): boolean {
    if (!prior || intent.resolution.status !== "matched") return false;
    const route = intent.resolution.route;
    if (prior.view === "index" && route.kind === "index") {
      return !intent.indexProviderId || intent.indexProviderId === prior.providerId;
    }
    return (
      prior.view === "detail" &&
      route.kind === "detail" &&
      sameRef(detailRef(prior), route)
    );
  }

  private async flushPriorDetail(
    prior: ComposerDetailState,
    generation: number,
  ): Promise<ComposerTransitionResult | null> {
    const ref = detailRef(prior);
    try {
      if (!sameRef(prior.session.queue.ref, ref)) {
        throw new Error(
          `Detail queue identity is ${prior.session.queue.ref.providerId}/${prior.session.queue.ref.recordId}; ` +
            `expected ${ref.providerId}/${ref.recordId}.`,
        );
      }
      await prior.session.flushPendingProps(ref);
      if (!sameRef(prior.session.queue.ref, ref)) {
        throw new Error("Detail queue identity changed while pending props were flushed.");
      }
      await prior.session.queue.flush();
      return null;
    } catch (cause) {
      if (!this.isCurrent(generation)) return { status: "stale" };
      const error = new ComposerTransitionError(
        "flush-failed",
        `Could not save composition "${ref.recordId}" before leaving provider "${ref.providerId}".`,
        ref,
        { cause },
      );
      return this.rollback(generation, prior, error);
    }
  }

  private chooseIndexProvider(explicit: CompositionProviderId | undefined): CompositionProviderId {
    if (explicit) {
      if (this.options.registry.get(explicit)?.id === explicit) return explicit;
      throw new ComposerTransitionError(
        "unknown-provider",
        `Composition provider "${explicit}" is not available.`,
      );
    }

    if (this.options.preference) {
      try {
        const preferred = this.options.preference.read();
        const provider = preferred === null ? undefined : this.options.registry.get(preferred);
        if (provider?.id === preferred) return provider.id;
      } catch {
        // Provider preference is deliberately best-effort.
      }
    }

    if (
      this.options.registry.get(this.options.defaultProviderId)?.id ===
      this.options.defaultProviderId
    ) {
      return this.options.defaultProviderId;
    }
    throw new ComposerTransitionError(
      "unknown-provider",
      `Default composition provider "${this.options.defaultProviderId}" is not available.`,
    );
  }

  private provider(providerId: CompositionProviderId): ComposerRoutingProvider {
    const provider = this.options.registry.get(providerId);
    if (provider?.id === providerId) return provider;
    throw new ComposerTransitionError(
      "unknown-provider",
      `Composition provider "${providerId}" is not available.`,
    );
  }

  private async loadIndex(
    route: Extract<ComposerRoute, { kind: "index" }>,
    intent: ComposerTransitionIntent,
    generation: number,
  ): Promise<ComposerIndexState> {
    const providerId = this.chooseIndexProvider(intent.indexProviderId);
    const provider = this.provider(providerId);
    const collection = await provider.list().catch((cause: unknown) => {
      throw loadError("collection-load-failed", providerId, undefined, cause);
    });
    return { view: "index", route, providerId, collection, url: intent.url, generation };
  }

  private async loadDetail(
    route: Extract<ComposerRoute, { kind: "detail" }>,
    url: string,
    generation: number,
  ): Promise<ComposerDetailState> {
    const ref: Readonly<CompositionRecordRef> = {
      providerId: route.providerId,
      recordId: route.recordId,
    };
    const provider = this.provider(ref.providerId);
    const [collection, outcome] = await Promise.all([
      provider.list().catch((cause: unknown) => {
        throw loadError("collection-load-failed", ref.providerId, undefined, cause);
      }),
      provider.get(ref.recordId).catch((cause: unknown) => {
        throw loadError("record-load-failed", ref.providerId, ref.recordId, cause);
      }),
    ]);
    const record = recordOutcome(ref, outcome);
    if (!this.isCurrent(generation)) {
      throw new Error("The Composer transition was superseded.");
    }

    let session: ComposerDetailSession;
    try {
      session = await this.options.createDetailSession(ref, record);
    } catch (cause) {
      throw new ComposerTransitionError(
        "detail-session-failed",
        `Could not prepare composition "${ref.recordId}" for editing.`,
        ref,
        { cause },
      );
    }
    if (!sameRef(session.queue.ref, ref)) {
      throw new ComposerTransitionError(
        "detail-session-failed",
        `The detail session was bound to the wrong composition identity.`,
        ref,
      );
    }

    return {
      view: "detail",
      route,
      providerId: ref.providerId,
      collection,
      record,
      draft: session.queue.state.draft,
      session,
      url,
      generation,
    };
  }

  private commitTarget(
    state: ComposerCommittedState,
    intent: ComposerTransitionIntent,
    prior: ComposerCommittedState | null,
    generation: number,
  ): ComposerTransitionResult {
    if (!this.isCurrent(generation)) return { status: "stale" };
    try {
      this.applyHistory(intent);
    } catch (cause) {
      return this.rollbackOrCommitInitialError(
        generation,
        prior,
        intent,
        state.route ?? { kind: "index" },
        new ComposerTransitionError(
          "history-write-failed",
          `Could not update Composer history to "${intent.url}".`,
          undefined,
          { cause },
        ),
      );
    }

    this.publish(state);
    if (state.view !== "not-found") this.writePreference(state.providerId);
    return { status: "committed", state };
  }

  private applyHistory(intent: ComposerTransitionIntent): void {
    if (!this.options.history || intent.history === "already-applied") return;
    this.options.history[intent.history](intent.url);
  }

  private writePreference(providerId: CompositionProviderId): void {
    try {
      this.options.preference?.write(providerId);
    } catch {
      // A failed preference write cannot undo a successful provider commit.
    }
  }

  private rollbackOrCommitInitialError(
    generation: number,
    prior: ComposerCommittedState | null,
    intent: ComposerTransitionIntent,
    route: ComposerRoute,
    error: ComposerTransitionError,
  ): ComposerTransitionResult {
    if (prior) return this.rollback(generation, prior, error);

    const state: ComposerNotFoundState = {
      view: "not-found",
      route,
      error,
      url: intent.url,
      generation,
    };
    if (intent.history !== "already-applied") {
      try {
        this.applyHistory(intent);
      } catch {
        // The actionable load error remains useful even if history is unavailable.
      }
    }
    this.publish(state);
    return { status: "committed", state };
  }

  private rollback(
    generation: number,
    prior: ComposerCommittedState,
    error: ComposerTransitionError,
  ): ComposerTransitionResult {
    if (!this.isCurrent(generation)) return { status: "stale" };
    try {
      this.options.history?.replace(prior.url);
    } catch {
      // State still rolls back even when the host cannot repair its address bar.
    }

    if (prior.view === "detail") {
      this.publish({ ...prior, draft: prior.session.queue.state.draft });
    }
    return { status: "rolled-back", error };
  }

  private publish(state: ComposerCommittedState): void {
    this.current = state;
    for (const listener of [...this.listeners]) this.deliver(listener, state);
  }

  private deliver(
    listener: (state: ComposerCommittedState) => void,
    state: ComposerCommittedState,
  ): void {
    try {
      listener(state);
    } catch {
      // Observers cannot break transition ordering.
    }
  }
}

export function createComposerTransitionCoordinator(
  options: ComposerTransitionCoordinatorOptions,
): ComposerTransitionCoordinator {
  return new LatestIntentComposerTransitionCoordinator(options);
}
