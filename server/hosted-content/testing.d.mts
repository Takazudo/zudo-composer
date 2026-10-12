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
interface HostedReceipt {
    actorId: string;
    operationKey: string;
    fingerprint: string;
    result: HostedResult;
}
/** Complete logical content of one site's storage, for seeding and fixture inspection only. The service never loads it whole. */
interface HostedDatabase {
    state: HostedState;
    baselineProviders: HostedProvider[];
    activePublicationId?: string | null;
    receipts: HostedReceipt[];
    snapshots: HostedSnapshot[];
    publications: HostedPublication[];
}
/** The one mutable row. Its size is bounded by the working and baseline content, never by history. */
interface HostedHead {
    /** Opaque storage version compared by every commit; it changes on every successful commit. */
    version: string;
    state: HostedState;
    baselineProviders: HostedProvider[];
    activePublicationId: string | null;
}
/** One conditional write. Receipts and snapshots are insert-only; a publication replaces the row with its id. */
interface HostedCommit {
    expectedVersion: string;
    head: HostedHead;
    receipt?: HostedReceipt;
    snapshot?: HostedSnapshot;
    publication?: HostedPublication;
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
    /**
     * Write everything or nothing. Resolve false, writing nothing, when the stored head version differs from
     * `expectedVersion` or the receipt (actorId, operationKey) or snapshot id already exists. Throw only when the
     * outcome is unknown or storage failed; a throw after a durable write is recovered through the receipt.
     */
    commit(change: HostedCommit): Promise<boolean>;
}
interface HostedActor {
    id: string;
}
interface HostedService {
    readState(actor: HostedActor): Promise<HostedState>;
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
declare function createHostedConformanceService(storage: HostedStorage, handleId: string): HostedService;
/**
 * Portable, framework-independent service conformance. It imports no Node/DOM APIs.
 * Run it against a deterministic fault backend and the actual downstream adapter.
 * A pass identifies only the tested backend; it is never evidence for another database.
 */
declare function runHostedContentConformance(factory: HostedConformanceFactory): Promise<HostedConformanceReport>;

export { createHostedConformanceService, createHostedContentConformancePolicy, createHostedContentConformanceSeed, createMemoryHostedConformanceFactory, createMemoryHostedStorage, hostedConformanceDigest, runHostedContentConformance };
export type { HostedConformanceBackend, HostedConformanceFactory, HostedConformanceFault, HostedConformanceGate, HostedConformanceHandle, HostedConformanceReport };
