import type {
  ComponentCatalog,
  CompositionBinding,
  CompositionNode,
  GlobalTemplateOutlet,
  RootPolicy,
} from "../model/types";
import type {
  CompositionDeleteOutcome,
  CompositionLoadOutcome,
  CompositionProviderDescriptor,
  CompositionRecord,
  CompositionRecordRef,
  CompositionStore,
  CompositionSummary,
  CompositionUnpublishOutcome,
} from "../library/types";

/** A lightweight reusable-source row; `None` is intentionally not a record. */
export interface ReuseCatalogEntry {
  ref: CompositionRecordRef;
  summary: CompositionSummary;
  kind: "global-template" | "pattern";
  /** Present only for a Global template and stable across label/target changes. */
  outlet?: Pick<GlobalTemplateOutlet, "id" | "label">;
}

export type ReuseCatalogOutcome =
  | { status: "listed"; entries: readonly ReuseCatalogEntry[] }
  | { status: "unavailable"; message: string }
  | { status: "load-error"; message: string };

/** Typed selection failures let consumers distinguish safe retry from invalid source data. */
export type ReuseSelectionOutcome =
  | {
      status: "loaded";
      record: CompositionRecord;
      kind: "global-template" | "pattern";
    }
  | { status: "empty"; record: CompositionRecord; reason: "empty-pattern" }
  | {
      status: "invalid";
      reason: "current-record" | "not-reusable" | "nested-template" | "missing-outlet";
      record?: CompositionRecord;
    }
  | { status: "unavailable"; message: string }
  | { status: "load-error"; message: string };

export interface ReuseDependent {
  ref: CompositionRecordRef;
  summary: CompositionSummary;
  binding: CompositionBinding;
}

export type ReuseDependentsOutcome =
  | { status: "listed"; dependents: readonly ReuseDependent[] }
  | { status: "unavailable"; message: string }
  | { status: "load-error"; message: string };

export type GlobalTemplateResolutionFailureReason =
  | "not-found"
  | "invalid-record"
  | "future-schema"
  | "unavailable"
  | "load-error"
  | "source-id-mismatch"
  | "not-global-template"
  | "invalid-outlet-target";

interface GlobalTemplateResolutionBase {
  /** The exact persisted binding; no resolver result detaches or rewrites it. */
  binding: CompositionBinding;
  /** The consumer's canonical local roots; resolution never drops or repairs them. */
  localRoot: readonly CompositionNode[];
}

export type GlobalTemplateResolutionOutcome =
  | { status: "unbound"; binding: undefined; localRoot: readonly CompositionNode[] }
  | (GlobalTemplateResolutionBase & {
      status: "resolved";
      source: CompositionRecord;
      outlet: GlobalTemplateOutlet;
      /** Constraints from the real published component slot, never the virtual root. */
      rootPolicy: Extract<RootPolicy, { kind: "resolved" }>;
    })
  | (GlobalTemplateResolutionBase & {
      status: "missing-template";
      reason: Extract<
        GlobalTemplateResolutionFailureReason,
        "not-found" | "invalid-record" | "future-schema" | "unavailable" | "load-error" | "source-id-mismatch"
      >;
    })
  | (GlobalTemplateResolutionBase & {
      status: "missing-outlet";
      source: CompositionRecord;
    })
  | (GlobalTemplateResolutionBase & {
      status: "invalid-template";
      source: CompositionRecord;
      reason: Extract<GlobalTemplateResolutionFailureReason, "not-global-template" | "invalid-outlet-target">;
    })
  | (GlobalTemplateResolutionBase & { status: "nested-template"; source: CompositionRecord })
  | (GlobalTemplateResolutionBase & { status: "self-reference" })
  | (GlobalTemplateResolutionBase & {
      status: "incompatible-local-root";
      source: CompositionRecord;
      outlet: GlobalTemplateOutlet;
      rootPolicy: Extract<RootPolicy, { kind: "resolved" }>;
      message: string;
    });

/** The concrete service boundary; it is deliberately read-only. */
export interface ReuseReadProvider {
  readonly provider: CompositionProviderDescriptor;
  list(): Promise<readonly CompositionSummary[]>;
  get(id: string): Promise<CompositionLoadOutcome>;
}

export interface CompositionReuseResolver {
  resolve(consumer: CompositionRecord): Promise<GlobalTemplateResolutionOutcome>;
}

export interface CompositionReuseService extends CompositionReuseResolver {
  listCatalog(current?: CompositionRecordRef): Promise<ReuseCatalogOutcome>;
  loadSelection(ref: CompositionRecordRef, current?: CompositionRecordRef): Promise<ReuseSelectionOutcome>;
  listDependents(sourceRecordId: string): Promise<ReuseDependentsOutcome>;
}

/**
 * The provider-owned mutation seam used by template lifecycle UI. It is kept
 * outside the reducer and iframe because dependency scans must be performed by
 * the provider that owns both the source and its canonical consumers.
 */
export interface ReuseLifecycleProvider {
  readonly descriptor: CompositionProviderDescriptor;
  readonly store: CompositionStore;
}

export type ReuseDeleteOutcome =
  | CompositionDeleteOutcome
  | { status: "unavailable"; message: string }
  | { status: "load-error"; message: string };

export type ReuseUnpublishOutcome =
  | CompositionUnpublishOutcome
  | { status: "unavailable"; message: string }
  | { status: "load-error"; message: string };

export type ReuseConsumerLifecycleOutcome =
  | {
      status: "detached";
      kind: "snapshot" | "removed-broken-binding";
      record: CompositionRecord;
    }
  | { status: "not-found" }
  | {
      status: "blocked";
      kind: "snapshot" | "removed-broken-binding";
      reason: string;
      message: string;
    }
  | { status: "unavailable"; message: string }
  | { status: "load-error" | "save-failed"; message: string };

export interface CompositionReuseLifecycleService {
  deleteSource(ref: CompositionRecordRef): Promise<ReuseDeleteOutcome>;
  unpublishSource(ref: CompositionRecordRef): Promise<ReuseUnpublishOutcome>;
  detachAsSnapshot(ref: CompositionRecordRef): Promise<ReuseConsumerLifecycleOutcome>;
  removeBrokenBinding(ref: CompositionRecordRef): Promise<ReuseConsumerLifecycleOutcome>;
}

/** Narrow hook configuration; the parent app owns provider selection and refresh events. */
export interface ComposerReuseResolutionOptions {
  /** Active provider-qualified record identity; changes invalidate prior reads. */
  ref: CompositionRecordRef;
  resolver: CompositionReuseResolver;
  /** Increment after a relevant source save to resolve from the latest saved source. */
  refreshKey?: unknown;
}

export interface ResolveGlobalTemplateOptions {
  consumer: CompositionRecord;
  source: CompositionRecord;
  manifest: ComponentCatalog;
}
