import {
  CompositionPersistenceError,
  isCompositionLifecycleStore,
} from "../library";
import type {
  CompositionLoadOutcome,
  CompositionRecord,
  CompositionRecordRef,
} from "../library";
import type { IdFactory } from "../../shared/id-factory";
import {
  materializeBrokenBindingRemoval,
  materializeStandaloneSnapshot,
} from "./materialize";
import { createCompositionReuseService } from "./service";
import type {
  CompositionReuseLifecycleService,
  ReuseConsumerLifecycleOutcome,
  ReuseDeleteOutcome,
  ReuseLifecycleProvider,
  ReuseUnpublishOutcome,
} from "./types";

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function failure(error: unknown): { status: "unavailable" | "load-error"; message: string } {
  return {
    status: error instanceof CompositionPersistenceError && error.code === "unavailable"
      ? "unavailable"
      : "load-error",
    message: message(error, "The Composition relationship could not be loaded."),
  };
}

function providerMismatch(
  provider: ReuseLifecycleProvider,
  ref: CompositionRecordRef,
): { status: "unavailable"; message: string } | undefined {
  return ref.providerId === provider.descriptor.id
    ? undefined
    : { status: "unavailable", message: "The requested Composition belongs to another provider." };
}

function lifecycleUnavailable(): { status: "unavailable"; message: string } {
  return {
    status: "unavailable",
    message: "This provider cannot perform a dependency-safe Composition lifecycle mutation.",
  };
}

function savedRecord(record: CompositionRecord, document: CompositionRecord["document"], now: () => string): CompositionRecord {
  return { ...record, updatedAt: now(), document };
}

function loadFailure(outcome: CompositionLoadOutcome): { status: "not-found" } | { status: "load-error"; message: string } {
  if (outcome.status === "not-found") return { status: "not-found" };
  return { status: "load-error", message: "The consumer record is invalid or uses an unsupported schema." };
}

/**
 * Provider-safe lifecycle coordinator. It intentionally only ever updates one
 * consumer record for a detach and never attempts an unsafe cross-record
 * detach-all/delete sequence. Source deletion and unpublishing stay in the
 * provider transaction/managed operation that owns the final binding scan.
 */
export function createCompositionReuseLifecycleService(
  provider: ReuseLifecycleProvider,
  options: { manifest: Parameters<typeof createCompositionReuseService>[1]; nodeIdFactory: IdFactory; now: () => string },
): CompositionReuseLifecycleService {
  const read = createCompositionReuseService({
    provider: provider.descriptor,
    list: () => provider.store.list(),
    get: (id) => provider.store.get(id),
  }, options.manifest);

  const loadConsumer = async (ref: CompositionRecordRef): Promise<
    | { status: "loaded"; record: CompositionRecord }
    | { status: "not-found" }
    | { status: "unavailable" | "load-error"; message: string }
  > => {
    const mismatch = providerMismatch(provider, ref);
    if (mismatch) return mismatch;
    try {
      const outcome = await provider.store.get(ref.recordId);
      if (outcome.status !== "loaded") return loadFailure(outcome);
      return { status: "loaded", record: outcome.record };
    } catch (error) {
      return failure(error);
    }
  };

  const saveDetached = async (
    record: CompositionRecord,
    document: CompositionRecord["document"],
    kind: "snapshot" | "removed-broken-binding",
  ): Promise<ReuseConsumerLifecycleOutcome> => {
    if (!isCompositionLifecycleStore(provider.store)) return lifecycleUnavailable();
    const next = savedRecord(record, document, options.now);
    try {
      await provider.store.saveLifecycleRecord(next);
      return { status: "detached", kind, record: next };
    } catch (error) {
      return { status: "save-failed", message: message(error, "The consumer could not be saved safely.") };
    }
  };

  return {
    async deleteSource(ref): Promise<ReuseDeleteOutcome> {
      const mismatch = providerMismatch(provider, ref);
      if (mismatch) return mismatch;
      if (!isCompositionLifecycleStore(provider.store)) return lifecycleUnavailable();
      try {
        return await provider.store.deleteWithDependencyCheck(ref.recordId);
      } catch (error) {
        return failure(error);
      }
    },

    async unpublishSource(ref): Promise<ReuseUnpublishOutcome> {
      const mismatch = providerMismatch(provider, ref);
      if (mismatch) return mismatch;
      if (!isCompositionLifecycleStore(provider.store)) return lifecycleUnavailable();
      try {
        return await provider.store.unpublishWithDependencyCheck(ref.recordId);
      } catch (error) {
        return failure(error);
      }
    },

    async detachAsSnapshot(ref): Promise<ReuseConsumerLifecycleOutcome> {
      const mismatch = providerMismatch(provider, ref);
      if (mismatch) return mismatch;
      if (!isCompositionLifecycleStore(provider.store)) return lifecycleUnavailable();
      const consumer = await loadConsumer(ref);
      if (consumer.status !== "loaded") return consumer;

      const resolution = await read.resolve(consumer.record);
      const snapshot = materializeStandaloneSnapshot(consumer.record, resolution, options.nodeIdFactory);
      if (snapshot.status !== "materialized") {
        return {
          status: "blocked",
          kind: "snapshot",
          reason: snapshot.reason,
          message: snapshot.message,
        };
      }
      return saveDetached(consumer.record, snapshot.document, "snapshot");
    },

    async removeBrokenBinding(ref): Promise<ReuseConsumerLifecycleOutcome> {
      const mismatch = providerMismatch(provider, ref);
      if (mismatch) return mismatch;
      if (!isCompositionLifecycleStore(provider.store)) return lifecycleUnavailable();
      const consumer = await loadConsumer(ref);
      if (consumer.status !== "loaded") return consumer;
      if (consumer.record.document.binding === undefined) {
        return {
          status: "blocked",
          kind: "removed-broken-binding",
          reason: "unbound",
          message: "This Composition has no broken Global-template binding to remove.",
        };
      }

      const resolution = await read.resolve(consumer.record);
      if (resolution.status === "resolved") {
        return {
          status: "blocked",
          kind: "removed-broken-binding",
          reason: "still-resolved",
          message: "The Global template is available. Use Detach as snapshot to keep its shell.",
        };
      }
      const removal = materializeBrokenBindingRemoval(consumer.record.document);
      return saveDetached(consumer.record, removal.document, "removed-broken-binding");
    },
  };
}
