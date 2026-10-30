import { JsonValue } from '@zudo-composer/component-contract';

/** A persisted record id in its provider's namespace. */
type RecordId = string;

declare const CONTENT_MODEL_SCHEMA_VERSION: 1;
declare const CONTENT_ENTRY_SCHEMA_VERSION: 1;
type ContentModelKind = "collection" | "single";
interface ContentRecordRef {
    providerId: string;
    recordId: RecordId;
}
interface ContentEntryRef extends ContentRecordRef {
    modelId: RecordId;
}
/**
 * Stable authoring identity for a managed asset.
 *
 * Content deliberately does not persist a versionId: the current Asset head
 * may change while a draft is being edited. The provider-qualified shape is
 * shared structurally with AssetAssetRef so release can add an exact version
 * without losing which Asset provider owns the asset.
 */
type ContentAssetRef = {
    providerId: string;
    assetId: string;
};
type ContentAssetUse = {
    kind: "image";
    asset: ContentAssetRef;
    alt: string;
    decorative: boolean;
    caption: string;
} | {
    kind: "link";
    asset: ContentAssetRef;
    label: string;
} | {
    kind: "download";
    asset: ContentAssetRef;
    label: string;
    showSize: boolean;
    showType: boolean;
} | {
    kind: "card";
    asset: ContentAssetRef;
    title: string;
    description: string;
};
type ContentValueSchema = {
    kind: "text" | "long-text" | "markdown" | "number" | "boolean" | "date" | "slug" | "color" | "url";
} | {
    kind: "choice";
    options: {
        value: string;
        label: string;
    }[];
} | {
    kind: "reference";
    target: ContentRecordRef;
} | {
    kind: "reference-list";
    target: ContentRecordRef;
    ordered: boolean;
} | {
    kind: "object";
    fields: ContentFieldDefinition[];
} | {
    kind: "list";
    item: ContentValueSchema;
} | {
    kind: "asset-use";
    use: ContentAssetUse["kind"];
};
type ContentFieldDefinition = {
    id: RecordId;
    key: string;
    label: string;
    required: boolean;
} & ContentValueSchema;
/** Inverses are presentation metadata. Only the named owning field stores edges. */
interface ContentInverseDefinition {
    id: string;
    label: string;
    source: ContentRecordRef;
    fieldId: string;
}
interface ContentPresentation {
    groups: {
        id: string;
        label: string;
        fieldIds: string[];
    }[];
    views: {
        id: string;
        label: string;
        fieldIds: string[];
    }[];
    inverses: ContentInverseDefinition[];
}
interface ContentModelDocument {
    schemaVersion: typeof CONTENT_MODEL_SCHEMA_VERSION;
    id: RecordId;
    name: string;
    description: string;
    kind: ContentModelKind;
    fields: ContentFieldDefinition[];
    presentation?: ContentPresentation;
}
interface ContentModelRecord {
    id: RecordId;
    createdAt: string;
    updatedAt: string;
    document: ContentModelDocument;
}
interface ContentEntryRecord {
    schemaVersion: typeof CONTENT_ENTRY_SCHEMA_VERSION;
    id: RecordId;
    modelId: RecordId;
    createdAt: string;
    updatedAt: string;
    values: Record<RecordId, JsonValue>;
    lifecycle: "draft" | "published";
    /** Storage assigns a new generation atomically for every entry mutation. */
    generation: number;
}
interface ContentCompletenessDiagnostic {
    code: "required-value-missing" | "semantic-value-incomplete";
    modelId: RecordId;
    entryId: RecordId;
    fieldId: RecordId;
    fieldKey: string;
    message: string;
    path?: readonly (string | number)[];
}

interface HostedIdentities {
    draftRevision: string;
    baseline: {
        gitSha: string;
        contentDigest: string;
    };
    definition: string;
}
interface HostedProvider {
    providerId: string;
    models: ContentModelRecord[];
    entries: ContentEntryRecord[];
}
interface HostedFieldPermission {
    fieldId: string;
    replace?: boolean;
    clear?: boolean;
    children?: HostedFieldPermission[];
    assetSelect?: boolean;
    assetDescription?: string[];
    listAdd?: boolean;
    listRemove?: boolean;
    listReorder?: boolean;
    maxLength?: number;
}
interface HostedModelPermission {
    providerId: string;
    modelId: string;
    entryIds: string[];
    fields: HostedFieldPermission[];
}
interface HostedCollectionPermission {
    id: string;
    owner: ContentEntryRef;
    fieldId: string;
    target: {
        providerId: string;
        modelId: string;
    };
    create: boolean;
    add: boolean;
    reorder: boolean;
    maxItems: number;
    initialValues: Record<string, JsonValue>;
}
interface HostedAsset {
    providerId: string;
    assetId: string;
    versionId: string;
    checksum: string;
    url: string;
    label: string;
}
interface HostedPolicy {
    models: HostedModelPermission[];
    collections: HostedCollectionPermission[];
    assets: HostedAsset[];
}
interface HostedState extends HostedIdentities {
    providers: HostedProvider[];
    integrationFence: number;
}
interface HostedSnapshot extends HostedIdentities {
    id: string;
    digest: string;
    providers: HostedProvider[];
    assets: HostedAsset[];
    diagnostics: ContentCompletenessDiagnostic[];
    renderData: JsonValue;
}
type HostedPublicationStage = "submitted" | "building" | "verified" | "integrated" | "deployed" | "failed" | "conflict" | "unavailable";
interface HostedPublication {
    id: string;
    snapshotId: string;
    expectedBaseline: HostedIdentities["baseline"];
    status: HostedPublicationStage;
    statusVersion: number;
    message?: string;
    gitSha?: string;
    lastProvenStatus?: "submitted" | "building" | "verified" | "integrated" | "deployed";
    facts?: Record<string, string>;
    integratedFence?: number;
}
interface HostedResult {
    state: HostedState;
    createdEntry?: ContentEntryRef;
    snapshot?: HostedSnapshot;
    publication?: HostedPublication;
}
/** One row per operation, sized like the scoped state. Keys never expire in this version, so none is ever recycled. */
interface HostedReceipt {
    actorId: string;
    operationKey: string;
    fingerprint: string;
    result: HostedResult;
}
type HostedRevisionOperation = "initial" | "set-fields" | "create-entry" | "add-entry" | "reorder" | "restore-revision" | "adopt-canonical-baseline";
/**
 * One immutable working revision of one Entry. It is written in the same atomic commit as the Entry change and
 * its receipt, and it is never updated or pruned: history is retained for the life of the storage.
 */
interface HostedRevision {
    id: string;
    entry: ContentEntryRef;
    /** 1-based and contiguous per Entry; the newest revision has the highest sequence. */
    sequence: number;
    parentId: string | null;
    values: Record<string, JsonValue>;
    /** The hosted definition the values were written under. */
    definition: string;
    createdAt: string;
    /** The authenticated actor, or null when the values came from canonical content rather than an edit here. */
    actor: HostedActor | null;
    /** Trusted host label for the entry point, from the service options; never a request value. */
    source: string;
    operation: {
        kind: HostedRevisionOperation;
        key: string | null;
    };
    restoredFrom?: string;
}
/** Complete logical content of one site's storage, for seeding and fixture inspection only. The service never loads it whole. */
interface HostedDatabase {
    state: HostedState;
    baselineProviders: HostedProvider[];
    activePublicationId?: string | null;
    receipts: HostedReceipt[];
    snapshots: HostedSnapshot[];
    publications: HostedPublication[];
    revisions: HostedRevision[];
}
/** The one mutable row. Its size is bounded by the working and baseline content, never by history. */
interface HostedHead {
    /** Opaque storage version compared by every commit; it changes on every successful commit. */
    version: string;
    state: HostedState;
    baselineProviders: HostedProvider[];
    activePublicationId: string | null;
}
/** One conditional write. Receipts, snapshots and revisions are insert-only; a publication replaces the row with its id. */
interface HostedCommit {
    expectedVersion: string;
    head: HostedHead;
    receipt?: HostedReceipt;
    snapshot?: HostedSnapshot;
    publication?: HostedPublication;
    revisions?: HostedRevision[];
}
/**
 * Narrow keyed reads plus one atomic conditional commit, e.g. a single D1 `batch()`.
 * The service prepares every commit from detached reads, so no transaction stays open across host code,
 * and retries a refused commit from fresh reads. Every read returns detached data.
 */
interface HostedStorage {
    readHead(): Promise<HostedHead>;
    readReceipt(actorId: string, operationKey: string): Promise<HostedReceipt | null>;
    readSnapshot(snapshotId: string): Promise<HostedSnapshot | null>;
    readPublication(publicationId: string): Promise<HostedPublication | null>;
    readRevision(revisionId: string): Promise<HostedRevision | null>;
    /** One Entry's revisions, newest first, below `beforeSequence` when given; never more than `limit`. */
    listRevisions(entry: ContentEntryRef, page: {
        beforeSequence?: number;
        limit: number;
    }): Promise<HostedRevision[]>;
    /**
     * Write everything or nothing. Resolve false, writing nothing, when the stored head version differs from
     * `expectedVersion` or the receipt (actorId, operationKey), snapshot id, revision id or revision (entry, sequence) already exists. Throw only when the
     * outcome is unknown or storage failed; a throw after a durable write is recovered through the receipt.
     */
    commit(change: HostedCommit): Promise<boolean>;
}
interface HostedActor {
    id: string;
}
/** Privileged host evidence that canonical Git content changed outside a publication. */
interface HostedCanonicalAdoption {
    /** The stored baseline and definition being replaced; a stale adoption is refused. */
    expected: {
        baseline: HostedIdentities["baseline"];
        definition: string;
    };
    baseline: HostedIdentities["baseline"];
    /** Complete canonical providers at that commit, valid under the service's current definition. */
    providers: HostedProvider[];
    /** `rebase` carries retained draft changes that still validate; `discard` resets the draft to canonical content. */
    draft: "rebase" | "discard";
    /** False reports what would be carried or dropped and writes nothing. */
    apply: boolean;
}
type HostedRebaseDropReason = "entry-removed" | "model-removed" | "field-removed" | "canonical-changed" | "invalid-value" | "forbidden" | "discarded";
interface HostedRebaseChange {
    entry: ContentEntryRef;
    fieldId: string;
}
interface HostedAdoptionResult {
    applied: boolean;
    /** The adopted state, or the state it would produce when not applied. */
    state: HostedState;
    carried: HostedRebaseChange[];
    dropped: (HostedRebaseChange & {
        reason: HostedRebaseDropReason;
    })[];
}
/** `working` is the retained draft; `published` is the active canonical baseline, never a lifecycle filter of the draft. */
type HostedPerspective = "working" | "published";
/** `new`: absent from the active baseline. `published`: working values equal it. `changed`: working values differ from it. */
type HostedEditorialStatus = "new" | "published" | "changed";
interface HostedModelSummary {
    providerId: string;
    model: ContentModelRecord;
    workingEntries: number;
    publishedEntries: number;
}
interface HostedEntryView {
    entry: ContentEntryRef;
    perspective: HostedPerspective;
    status: HostedEditorialStatus;
    lifecycle: ContentEntryRecord["lifecycle"];
    generation: number;
    updatedAt: string;
    values: Record<string, JsonValue>;
    /** Head of the Entry's working history, the same in both perspectives; null before history begins. Guards history and restore. */
    workingRevisionId: string | null;
    /** What identifies the shown values: a working revision, or the activated baseline for published values (never a revision id). */
    valuesIdentity: HostedValuesIdentity;
}
type HostedValuesIdentity = {
    perspective: "working";
    draftRevision: string;
    revisionId: string | null;
} | {
    perspective: "published";
    baseline: HostedState["baseline"];
    integrationFence: number;
};
interface HostedPage {
    cursor?: string;
    limit?: number;
}
interface HostedEntryPage {
    entries: HostedEntryView[];
    nextCursor: string | null;
}
interface HostedRevisionPage {
    revisions: HostedRevision[];
    nextCursor: string | null;
}
type HostedRevisionTarget = {
    revisionId: string;
} | {
    perspective: HostedPerspective;
};
interface HostedFieldDifference {
    fieldId: string;
    key: string;
    label: string;
    change: "added" | "removed" | "changed";
    before?: JsonValue;
    after?: JsonValue;
    /** True when the current definition no longer has this field. */
    removedFromDefinition: boolean;
}
interface HostedComparison {
    entry: ContentEntryRef;
    from: HostedRevisionTarget;
    to: HostedRevisionTarget;
    differences: HostedFieldDifference[];
}
/** Each stage is reported separately; none implies the next. */
interface HostedPublicationOverview {
    /** The active canonical baseline that `published` reads return. */
    activated: {
        baseline: HostedIdentities["baseline"];
        definition: string;
        integrationFence: number;
    };
    /** The newest accepted submission, if any. */
    submission: {
        publicationId: string;
        snapshotId: string;
        status: HostedPublicationStage;
        statusVersion: number;
        message?: string;
    } | null;
    /** Host-recorded `artifact` fact of that submission, e.g. a local artifact id; null until the host records one. */
    artifact: string | null;
    deployed: boolean;
}
interface HostedService {
    readState(actor: HostedActor): Promise<HostedState>;
    listModels(actor: HostedActor): Promise<HostedModelSummary[]>;
    listEntries(actor: HostedActor, query: {
        perspective: HostedPerspective;
        providerId: string;
        modelId: string;
    } & HostedPage): Promise<HostedEntryPage>;
    readEntry(actor: HostedActor, query: {
        perspective: HostedPerspective;
        entry: ContentEntryRef;
    }): Promise<HostedEntryView>;
    listRevisions(actor: HostedActor, query: {
        entry: ContentEntryRef;
    } & HostedPage): Promise<HostedRevisionPage>;
    readRevision(actor: HostedActor, revisionId: string): Promise<HostedRevision>;
    compareRevisions(actor: HostedActor, query: {
        entry: ContentEntryRef;
        from: HostedRevisionTarget;
        to: HostedRevisionTarget;
    }): Promise<HostedComparison>;
    readPublicationStatus(actor: HostedActor): Promise<HostedPublicationOverview>;
    execute(actor: HostedActor, request: unknown): Promise<HostedResult>;
    readReceipt(actor: HostedActor, operationKey: string): Promise<HostedReceipt | null>;
    readSnapshot(actor: HostedActor, snapshotId: string): Promise<HostedSnapshot>;
    getPublication(actor: HostedActor, publicationId: string): Promise<HostedPublication>;
    recordStatus(evidence: {
        publicationId: string;
        snapshotId: string;
        statusVersion: number;
        status: HostedPublicationStage;
        message?: string;
        facts?: Record<string, string>;
    }): Promise<HostedPublication>;
    recordConfirmedIntegration(evidence: {
        publicationId: string;
        snapshotId: string;
        expectedBaseline: HostedIdentities["baseline"];
        gitSha: string;
        contentDigest: string;
    }): Promise<HostedState>;
    /** Adopt an external canonical baseline and/or definition, rebasing or discarding the retained draft explicitly. */
    adoptCanonicalBaseline(evidence: HostedCanonicalAdoption): Promise<HostedAdoptionResult>;
}

/** These faults occur at the storage boundary, never by forging a service receipt. */
type HostedConformanceFault = "before-commit" | "receipt-persistence" | "lost-acknowledgement";
interface HostedConformanceGate {
    /** Resolves once the next commit was prepared and submitted, before the backend applies it. */
    entered: Promise<void>;
    release(): void;
}
interface HostedConformanceHandle {
    storage: HostedStorage;
    /** `receipt-persistence` must fail an actual statement after the head write inside the same atomic commit. */
    faultNextCommit(fault: HostedConformanceFault): void;
    /** Delay applying the next commit. Other handles keep committing, so the held commit must be refused and retried. */
    holdNextCommit(): HostedConformanceGate;
    /** Complete logical storage content for assertions; never used by the service. */
    dump(): Promise<HostedDatabase>;
}
interface HostedConformanceBackend {
    /** Every call must open an independent storage handle. */
    open(): Promise<HostedConformanceHandle>;
    /** Close all handles; reopen the same durable state without reseeding. */
    restart(): Promise<void>;
    close(): Promise<void>;
}
interface HostedConformanceFactory {
    /** Each scenario receives its own fresh database. Seed only an absent database. */
    create(seed: HostedDatabase, scenario: string): Promise<HostedConformanceBackend>;
}
interface HostedConformanceReport {
    scenarios: string[];
    assertions: number;
}
/** In-process storage for tests and single-isolate examples. It proves no durability or cross-process behavior. */
declare function createMemoryHostedStorage(seed: HostedDatabase): {
    storage: HostedStorage;
    dump(): HostedDatabase;
    replace(database: HostedDatabase): void;
};
/**
 * Deterministic fault/interleaving reference only. This fake does not demonstrate
 * disk durability, process isolation, SQLite or D1 behavior.
 */
declare function createMemoryHostedConformanceFactory(): HostedConformanceFactory;
/** Public deterministic data shared by adapter and independent-process proofs. */
declare function createHostedContentConformanceSeed(): HostedDatabase;
declare function createHostedContentConformancePolicy(): HostedPolicy;
/** A deterministic test digest; production hosts must supply a cryptographic digest. */
declare function hostedConformanceDigest(value: string): Promise<string>;
declare function createHostedConformanceService(storage: HostedStorage, handleId: string, definition?: string): HostedService;
/**
 * Portable, framework-independent service conformance. It imports no Node/DOM APIs.
 * Run it against a deterministic fault backend and the actual downstream adapter.
 * A pass identifies only the tested backend; it is never evidence for another database.
 */
declare function runHostedContentConformance(factory: HostedConformanceFactory): Promise<HostedConformanceReport>;

export { createHostedConformanceService, createHostedContentConformancePolicy, createHostedContentConformanceSeed, createMemoryHostedConformanceFactory, createMemoryHostedStorage, hostedConformanceDigest, runHostedContentConformance };
export type { HostedConformanceBackend, HostedConformanceFactory, HostedConformanceFault, HostedConformanceGate, HostedConformanceHandle, HostedConformanceReport };
