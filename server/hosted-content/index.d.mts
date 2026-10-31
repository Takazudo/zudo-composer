import { JsonValue, ComponentPackManifest } from '@zudo-composer/component-contract';
export { JsonValue } from '@zudo-composer/component-contract';
import { z } from 'zod';

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
interface HostedCommandBase {
    operationKey: string;
    expected: HostedIdentities;
}
type HostedCommand = HostedCommandBase & ({
    kind: "set-fields";
    entry: ContentEntryRef;
    values: Record<string, JsonValue>;
    clear: string[];
} | {
    kind: "create-entry";
    collectionId: string;
    values: Record<string, JsonValue>;
    before: ContentEntryRef | null;
} | {
    kind: "add-entry";
    collectionId: string;
    entry: ContentEntryRef;
    before: ContentEntryRef | null;
} | {
    kind: "reorder";
    collectionId: string;
    entries: ContentEntryRef[];
} | {
    kind: "capture-snapshot";
} | {
    kind: "begin-publication";
    snapshotId: string;
}
/** Writes the revision's values as a new working revision; lifecycle, baseline and history are kept. */
 | {
    kind: "restore-revision";
    entry: ContentEntryRef;
    revisionId: string;
});
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
interface HostedServiceOptions {
    siteId: string;
    definition: string;
    policy: HostedPolicy;
    storage: HostedStorage;
    authorize(actor: HostedActor): void | Promise<void>;
    digest(value: string): Promise<string>;
    createId(): string;
    now(): string;
    /** Host-owned pure projection includes the fixed templates, outlets, routes and mappings. No Node compilation per request. */
    project(providers: HostedProvider[], assets: HostedAsset[]): JsonValue | Promise<JsonValue>;
    validateSubmission(snapshot: HostedSnapshot): void | Promise<void>;
    validateMarkdown?(value: string): void;
    /** Trusted label recorded on every revision this service writes, e.g. "article-admin". Defaults to "hosted-content". */
    source?: string;
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
    /** The identities this read was taken at; a command prepared from it quotes them as `expected`. */
    expected: HostedIdentities;
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
/** A validated set-fields candidate that was not written. */
interface HostedFieldPreview {
    entry: ContentEntryRef;
    expected: HostedIdentities;
    values: Record<string, JsonValue>;
    differences: HostedFieldDifference[];
}
interface HostedComparison {
    entry: ContentEntryRef;
    from: HostedRevisionTarget;
    to: HostedRevisionTarget;
    differences: HostedFieldDifference[];
}
type HostedRestoreDiagnosticCode = "field-removed" | "invalid-value" | "forbidden" | "collection-owned";
interface HostedRestoreDiagnostic {
    entry: ContentEntryRef;
    fieldId: string;
    code: HostedRestoreDiagnosticCode;
    message: string;
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
    /** Run set-fields validation against the pinned identities and return the candidate without writing anything. */
    previewFields(actor: HostedActor, query: {
        entry: ContentEntryRef;
        values: Record<string, JsonValue>;
        clear: string[];
        expected: HostedIdentities;
    }): Promise<HostedFieldPreview>;
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
/** `unavailable` means storage kept refusing a commit; nothing was written and the exact request may be retried. */
type HostedErrorCode = "invalid-request" | "invalid-value" | "forbidden" | "not-found" | "revision-conflict" | "baseline-conflict" | "definition-conflict" | "operation-key-reuse" | "publication-busy" | "incomplete" | "restore-incompatible" | "configuration-required" | "unavailable";
declare class HostedContentError extends Error {
    readonly code: HostedErrorCode;
    readonly diagnostics?: ContentCompletenessDiagnostic[] | undefined;
    readonly restoreDiagnostics?: HostedRestoreDiagnostic[] | undefined;
    constructor(code: HostedErrorCode, message: string, diagnostics?: ContentCompletenessDiagnostic[] | undefined, restoreDiagnostics?: HostedRestoreDiagnostic[] | undefined);
}
interface HostedTransport {
    readState(): Promise<HostedState>;
    execute(request: HostedCommand): Promise<HostedResult>;
    readReceipt(operationKey: string): Promise<HostedReceipt | null>;
    getPublication(publicationId: string): Promise<HostedPublication>;
    /** Editorial reads; a transport without them supports only the single-entry editor. */
    listModels?(): Promise<HostedModelSummary[]>;
    listEntries?(query: {
        perspective: HostedPerspective;
        providerId: string;
        modelId: string;
    } & HostedPage): Promise<HostedEntryPage>;
    readEntry?(query: {
        perspective: HostedPerspective;
        entry: ContentEntryRef;
    }): Promise<HostedEntryView>;
    listRevisions?(query: {
        entry: ContentEntryRef;
    } & HostedPage): Promise<HostedRevisionPage>;
    readRevision?(revisionId: string): Promise<HostedRevision>;
    compareRevisions?(query: {
        entry: ContentEntryRef;
        from: HostedRevisionTarget;
        to: HostedRevisionTarget;
    }): Promise<HostedComparison>;
    readPublicationStatus?(): Promise<HostedPublicationOverview>;
}

/** Trusted, site-bound service. Host callbacks are privileged; never expose them as client verbs. */
declare function createHostedContentService(supplied: HostedServiceOptions): HostedService;

/** JSON canonicalization used for identities. Rejects values JSON would silently lose. */
declare function canonicalSerialize(value: unknown): string;

/** Envelope discriminator — keeps Composer traffic off other message buses. */
declare const COMPOSER_PREVIEW_CHANNEL: "composer-preview";
/** Protocol version. Bump only on a BREAKING envelope change. */
declare const COMPOSER_PREVIEW_PROTOCOL_VERSION: 2;
interface PreviewPackIdentity {
    readonly packId: string;
    readonly packVersion: string;
}
/** The three fields of a `MessageEvent` this protocol is allowed to look at. */
interface MessageEventLike {
    readonly data: unknown;
    readonly origin: string;
    readonly source: unknown;
}
/** Anything that can receive an exact-origin `postMessage`. */
interface MessagePoster {
    postMessage(message: unknown, targetOrigin: string): void;
}
/** Anything that can host the `message` listener. */
interface MessageTarget {
    addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
    removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}
type GuardFailure = "wrong-source" | "wrong-origin" | "invalid-payload" | "pack-mismatch";
type GuardResult<T> = {
    ok: true;
    message: T;
} | {
    ok: false;
    reason: GuardFailure;
    detail?: string;
};

/** Additive hosted-document messages on the existing guarded Composer wire protocol.
 * This module is portable: no browser globals or renderer implementations. */

interface HostedRendererIdentity {
    rendererId: string;
    rendererVersion: string;
}
declare const hostedPreviewBindingSchema: z.ZodObject<{
    frameSession: z.ZodString;
    frameGeneration: z.ZodNumber;
    requestId: z.ZodNumber;
    snapshotId: z.ZodString;
    snapshotDigest: z.ZodString;
    draftRevision: z.ZodString;
    baseline: z.ZodObject<{
        gitSha: z.ZodString;
        contentDigest: z.ZodString;
    }, z.core.$strict>;
    definition: z.ZodString;
    routeId: z.ZodString;
}, z.core.$strict>;
type HostedPreviewBinding = z.infer<typeof hostedPreviewBindingSchema>;
declare const hostedReadySchema: z.ZodObject<{
    type: z.ZodLiteral<"host-ready">;
    frameSession: z.ZodString;
    rendererId: z.ZodString;
    rendererVersion: z.ZodString;
    channel: z.ZodLiteral<"composer-preview">;
    v: z.ZodLiteral<2>;
    packId: z.ZodString;
    packVersion: z.ZodString;
}, z.core.$strict>;
declare const hostedRenderSchema: z.ZodObject<{
    type: z.ZodLiteral<"document-render">;
    renderData: z.ZodPipe<z.ZodUnknown, z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>;
    frameSession: z.ZodString;
    frameGeneration: z.ZodNumber;
    requestId: z.ZodNumber;
    snapshotId: z.ZodString;
    snapshotDigest: z.ZodString;
    draftRevision: z.ZodString;
    baseline: z.ZodObject<{
        gitSha: z.ZodString;
        contentDigest: z.ZodString;
    }, z.core.$strict>;
    definition: z.ZodString;
    routeId: z.ZodString;
    rendererId: z.ZodString;
    rendererVersion: z.ZodString;
    channel: z.ZodLiteral<"composer-preview">;
    v: z.ZodLiteral<2>;
    packId: z.ZodString;
    packVersion: z.ZodString;
}, z.core.$strict>;
declare const hostedRenderedSchema: z.ZodObject<{
    type: z.ZodLiteral<"document-rendered">;
    frameSession: z.ZodString;
    frameGeneration: z.ZodNumber;
    requestId: z.ZodNumber;
    snapshotId: z.ZodString;
    snapshotDigest: z.ZodString;
    draftRevision: z.ZodString;
    baseline: z.ZodObject<{
        gitSha: z.ZodString;
        contentDigest: z.ZodString;
    }, z.core.$strict>;
    definition: z.ZodString;
    routeId: z.ZodString;
    rendererId: z.ZodString;
    rendererVersion: z.ZodString;
    channel: z.ZodLiteral<"composer-preview">;
    v: z.ZodLiteral<2>;
    packId: z.ZodString;
    packVersion: z.ZodString;
}, z.core.$strict>;
declare const hostedDocumentErrorSchema: z.ZodObject<{
    type: z.ZodLiteral<"document-error">;
    code: z.ZodEnum<{
        "render-failed": "render-failed";
        "missing-dependency": "missing-dependency";
        "unsupported-route": "unsupported-route";
        "invalid-document": "invalid-document";
    }>;
    message: z.ZodString;
    frameSession: z.ZodString;
    frameGeneration: z.ZodNumber;
    requestId: z.ZodNumber;
    snapshotId: z.ZodString;
    snapshotDigest: z.ZodString;
    draftRevision: z.ZodString;
    baseline: z.ZodObject<{
        gitSha: z.ZodString;
        contentDigest: z.ZodString;
    }, z.core.$strict>;
    definition: z.ZodString;
    routeId: z.ZodString;
    rendererId: z.ZodString;
    rendererVersion: z.ZodString;
    channel: z.ZodLiteral<"composer-preview">;
    v: z.ZodLiteral<2>;
    packId: z.ZodString;
    packVersion: z.ZodString;
}, z.core.$strict>;
declare const hostedPreviewResponseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"host-ready">;
    frameSession: z.ZodString;
    rendererId: z.ZodString;
    rendererVersion: z.ZodString;
    channel: z.ZodLiteral<"composer-preview">;
    v: z.ZodLiteral<2>;
    packId: z.ZodString;
    packVersion: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"document-rendered">;
    frameSession: z.ZodString;
    frameGeneration: z.ZodNumber;
    requestId: z.ZodNumber;
    snapshotId: z.ZodString;
    snapshotDigest: z.ZodString;
    draftRevision: z.ZodString;
    baseline: z.ZodObject<{
        gitSha: z.ZodString;
        contentDigest: z.ZodString;
    }, z.core.$strict>;
    definition: z.ZodString;
    routeId: z.ZodString;
    rendererId: z.ZodString;
    rendererVersion: z.ZodString;
    channel: z.ZodLiteral<"composer-preview">;
    v: z.ZodLiteral<2>;
    packId: z.ZodString;
    packVersion: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"document-error">;
    code: z.ZodEnum<{
        "render-failed": "render-failed";
        "missing-dependency": "missing-dependency";
        "unsupported-route": "unsupported-route";
        "invalid-document": "invalid-document";
    }>;
    message: z.ZodString;
    frameSession: z.ZodString;
    frameGeneration: z.ZodNumber;
    requestId: z.ZodNumber;
    snapshotId: z.ZodString;
    snapshotDigest: z.ZodString;
    draftRevision: z.ZodString;
    baseline: z.ZodObject<{
        gitSha: z.ZodString;
        contentDigest: z.ZodString;
    }, z.core.$strict>;
    definition: z.ZodString;
    routeId: z.ZodString;
    rendererId: z.ZodString;
    rendererVersion: z.ZodString;
    channel: z.ZodLiteral<"composer-preview">;
    v: z.ZodLiteral<2>;
    packId: z.ZodString;
    packVersion: z.ZodString;
}, z.core.$strict>], "type">;
type HostedDocumentRender = z.infer<typeof hostedRenderSchema>;
type HostedDocumentRendered = z.infer<typeof hostedRenderedSchema>;
type HostedDocumentError = z.infer<typeof hostedDocumentErrorSchema>;
type HostedPreviewResponse = z.infer<typeof hostedPreviewResponseSchema>;
type HostedPreviewGuardFailure = "wrong-source" | "wrong-origin" | "invalid-payload" | "pack-mismatch" | "renderer-mismatch";
type Expected = {
    source: unknown;
    origin: string;
    pack: PreviewPackIdentity;
    renderer: HostedRendererIdentity;
};
declare function readHostedPreviewRequest(event: MessageEventLike, expected: Expected): {
    ok: false;
    reason: "renderer-mismatch";
    detail: string;
} | GuardResult<{
    type: "document-render";
    renderData: JsonValue;
    frameSession: string;
    frameGeneration: number;
    requestId: number;
    snapshotId: string;
    snapshotDigest: string;
    draftRevision: string;
    baseline: {
        gitSha: string;
        contentDigest: string;
    };
    definition: string;
    routeId: string;
    rendererId: string;
    rendererVersion: string;
    channel: "composer-preview";
    v: 2;
    packId: string;
    packVersion: string;
}>;
declare function readHostedPreviewResponse(event: MessageEventLike, expected: Expected): {
    ok: false;
    reason: "renderer-mismatch";
    detail: string;
} | GuardResult<{
    type: "host-ready";
    frameSession: string;
    rendererId: string;
    rendererVersion: string;
    channel: "composer-preview";
    v: 2;
    packId: string;
    packVersion: string;
} | {
    type: "document-rendered";
    frameSession: string;
    frameGeneration: number;
    requestId: number;
    snapshotId: string;
    snapshotDigest: string;
    draftRevision: string;
    baseline: {
        gitSha: string;
        contentDigest: string;
    };
    definition: string;
    routeId: string;
    rendererId: string;
    rendererVersion: string;
    channel: "composer-preview";
    v: 2;
    packId: string;
    packVersion: string;
} | {
    type: "document-error";
    code: "render-failed" | "missing-dependency" | "unsupported-route" | "invalid-document";
    message: string;
    frameSession: string;
    frameGeneration: number;
    requestId: number;
    snapshotId: string;
    snapshotDigest: string;
    draftRevision: string;
    baseline: {
        gitSha: string;
        contentDigest: string;
    };
    definition: string;
    routeId: string;
    rendererId: string;
    rendererVersion: string;
    channel: "composer-preview";
    v: 2;
    packId: string;
    packVersion: string;
}>;
declare function hostedReadyMessage(pack: PreviewPackIdentity, identity: HostedRendererIdentity, frameSession: string): {
    type: "host-ready";
    frameSession: string;
    rendererId: string;
    rendererVersion: string;
    channel: "composer-preview";
    v: 2;
    packId: string;
    packVersion: string;
};
declare function hostedRenderMessage(pack: PreviewPackIdentity, identity: HostedRendererIdentity, binding: HostedPreviewBinding, renderData: JsonValue): HostedDocumentRender;
declare function hostedRenderedMessage(request: HostedDocumentRender): HostedDocumentRendered;
declare function hostedDocumentErrorMessage(request: HostedDocumentRender, code: HostedDocumentError["code"], message: string): HostedDocumentError;
/** Result binding equality deliberately covers every identity, never only request ID. */
declare function matchesHostedPreviewBinding(a: HostedPreviewBinding, b: HostedPreviewBinding): boolean;

declare const ASSET_TYPES: readonly ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/zip", "text/plain", "text/csv", "application/json"];

type AssetType = (typeof ASSET_TYPES)[number];
/** Stable provider-qualified identity used by authoring references. */
interface AssetAssetRef {
    providerId: string;
    assetId: string;
}
/** Exact immutable version identity used by release/pin operations. */
interface AssetVersionRef extends AssetAssetRef {
    versionId: string;
}
interface AssetVersionPin extends AssetVersionRef {
    checksum: string;
    byteLength: number;
    mimeType: AssetType;
    url: string;
}

interface LockedAssetPin extends AssetVersionPin {
    fileName?: string;
    metadataRevision: number;
    headVersionId: string;
}
interface AssetReferenceLock {
    schemaVersion: 1;
    providerId: string;
    mutationToken: string;
    pins: LockedAssetPin[];
}

/** A JSON object — the shape of a node's `props`. */
type JsonObject = {
    [key: string]: JsonValue;
};
/** The only Composition document schema version this build understands. */
declare const COMPOSITION_SCHEMA_VERSION: 2;
type CompositionSchemaVersion = typeof COMPOSITION_SCHEMA_VERSION;
/** A single persisted node in a Composition tree. */
interface CompositionNode {
    /** Stable, unique node id (persisted document key). */
    id: string;
    /** Stable component id — looked up in the manifest. */
    componentId: string;
    /** Component schema version this node was authored against. */
    componentVersion: number;
    /** JSON-safe scalar props. */
    props: JsonObject;
    /** Stable slot id → ordered child nodes. */
    slots: Record<string, CompositionNode[]>;
}
/** The real component slot a Global template exposes to its consumers. */
interface GlobalTemplateOutletTarget {
    /** Id of the component node that owns the exposed slot. Never the virtual root. */
    parentId: string;
    /** Stable manifest slot id on `parentId`. */
    slotId: string;
}
/**
 * The single named projection point a Global template exposes in schema v2.
 * `id` is machine-stable; changing the human label or target never reissues it.
 */
interface GlobalTemplateOutlet {
    id: string;
    label: string;
    target: GlobalTemplateOutletTarget;
}
/** Publish this Composition as a live, one-outlet Global template. */
interface GlobalTemplatePublication {
    kind: "global-template";
    outlet: GlobalTemplateOutlet;
}
/** Publish this Composition as a detached-clone Pattern. */
interface PatternPublication {
    kind: "pattern";
}
/**
 * Reuse role persisted on a Composition. Absence means an ordinary local-only
 * Composition. The union deliberately contains no generic reference node.
 */
type CompositionPublication = GlobalTemplatePublication | PatternPublication;
/**
 * A consumer's stable link to one source outlet. Provider identity is omitted:
 * the containing record's active provider supplies that at resolution time.
 */
interface CompositionBinding {
    sourceRecordId: RecordId;
    outletId: string;
}
/** The full persisted Composition document in the current schema. */
interface CompositionDocument {
    schemaVersion: CompositionSchemaVersion;
    id: string;
    name: string;
    /**
     * The virtual root's children. `root` is an insertion slot only — the array
     * itself is NOT a node and has no id/props/component.
     */
    root: CompositionNode[];
    /** Optional reusable-source role. Mutually exclusive with `binding` semantically. */
    publication?: CompositionPublication;
    /** Optional live source binding. The local `root` remains canonical. */
    binding?: CompositionBinding;
}

/** A persisted composition and its storage metadata. */
interface CompositionRecord {
    id: RecordId;
    createdAt: string;
    updatedAt: string;
    document: CompositionDocument;
}
declare const COMPOSITION_PROVIDER_IDS: {
    readonly files: "files";
};
type CompositionProviderId = (typeof COMPOSITION_PROVIDER_IDS)[keyof typeof COMPOSITION_PROVIDER_IDS];
/** A provider-qualified identity. Record ids are unique only inside a provider. */
interface CompositionRecordRef {
    providerId: CompositionProviderId;
    recordId: RecordId;
}

type LinkedJsxModuleKind = "standalone" | "global-template" | "linked-consumer";

interface ContentModelRef {
    providerId: string;
    recordId: string;
}

declare const MAPPING_SCHEMA_VERSION: 2;
type MappingMode = {
    kind: "single";
} | {
    kind: "collection";
    query: MappingCollectionQuery;
};
type MappingCollectionConditionOperator = "equals" | "not-equals" | "contains" | "exists";
interface MappingCollectionCondition {
    fieldId: RecordId;
    operator: MappingCollectionConditionOperator;
    value?: JsonValue;
}
interface MappingCollectionSort {
    fieldId: RecordId;
    direction: "asc" | "desc";
}
interface MappingCollectionPin {
    providerId: string;
    modelId: RecordId;
    recordId: RecordId;
}
interface MappingCollectionQuery {
    publication: "published-only" | "include-drafts";
    conditions: MappingCollectionCondition[];
    sort: MappingCollectionSort[];
    pins: MappingCollectionPin[];
    limit: number;
}
interface MappingTarget {
    nodeId: string;
    prop: string;
}
type MappingSourceProjection = {
    kind: "value";
} | {
    kind: "object-field";
    fieldIds: readonly RecordId[];
} | {
    kind: "asset-url";
} | {
    kind: "asset-download";
} | {
    kind: "asset-text";
    field: "alt" | "caption" | "label" | "title" | "description";
} | {
    kind: "reference-id";
} | {
    kind: "route-link";
};
type MappingTransform = 
/** Preserve the scalar value exactly when the source and target domains agree. */
{
    kind: "identity";
}
/** Format a canonical Content date string as a medium, UTC-stable display date. */
 | {
    kind: "date-medium";
}
/** Keep 160 Unicode code points from longer Content, then append an ellipsis. */
 | {
    kind: "truncate-160";
}
/** Add a configured label/decorator before string-producing Content. */
 | {
    kind: "prefix";
    prefix: string;
};
interface MappingBinding {
    id: RecordId;
    sourceFieldId: RecordId;
    projection: MappingSourceProjection;
    target: MappingTarget;
    transform: MappingTransform;
}
interface MappingDocument {
    schemaVersion: typeof MAPPING_SCHEMA_VERSION;
    id: RecordId;
    name: string;
    contentModel: ContentModelRef;
    composition: CompositionRecordRef;
    mode: MappingMode;
    bindings: MappingBinding[];
}
interface MappingRecord {
    id: RecordId;
    createdAt: string;
    updatedAt: string;
    document: MappingDocument;
}

/** The only Sitemap document schema version understood by this build. */
declare const SITEMAP_SCHEMA_VERSION: 3;
type SitemapSchemaVersion = typeof SITEMAP_SCHEMA_VERSION;
/** A stable reference to a saved Composer composition. */
interface CompositionRef {
    providerId: string;
    recordId: RecordId;
}
/** A stable reference to a saved Mapping. */
interface MappingRef {
    providerId: string;
    recordId: RecordId;
}
type MappingRoute = {
    kind: "single";
} | {
    kind: "selected-entry";
    entry: SitemapEntryRef;
} | {
    kind: "entry-field";
    fieldId: RecordId;
    titleFieldId?: RecordId;
};
interface SitemapEntryRef {
    providerId: string;
    modelId: string;
    recordId: RecordId;
}
interface SitemapAncestorSelection {
    nodeId: string;
    entry: SitemapEntryRef;
}
type SitemapNavigationDestination = {
    kind: "route";
    nodeId: string;
    entry?: SitemapEntryRef;
    ancestors?: SitemapAncestorSelection[];
} | {
    kind: "external";
    url: string;
};
interface SitemapNavigationItem {
    id: string;
    label: string;
    visible: boolean;
    destination: SitemapNavigationDestination;
}
interface SitemapNavigation {
    primary: SitemapNavigationItem[];
    footer: SitemapNavigationItem[];
}
/** Every authored page has one explicit, persisted source. */
type SitemapPageSource = {
    kind: "unassigned";
} | {
    kind: "composition";
    ref: CompositionRef;
} | {
    kind: "mapping";
    ref: MappingRef;
    route: MappingRoute;
};
/** One authored page in the sitemap tree. Mapping Entries are never persisted here. */
interface SitemapNode {
    id: string;
    title: string;
    slug?: string;
    source: SitemapPageSource;
    notes?: string;
    children: SitemapNode[];
}
/** The complete persisted Sitemap document. */
interface SitemapDocument {
    schemaVersion: SitemapSchemaVersion;
    id: string;
    name: string;
    navigation: SitemapNavigation;
    /** Virtual insertion slot. The array itself is never a page node. */
    root: SitemapNode[];
}

/** A persisted sitemap and its storage metadata. */
interface SitemapRecord {
    id: RecordId;
    createdAt: string;
    updatedAt: string;
    document: SitemapDocument;
}

/**
 * Stable SiteProject provider ids and their current browser-provider ids.
 *
 * Authoring persists to the host project's files, so every domain names its
 * filesystem provider. Keeping the mapping explicit prevents adapters from
 * accepting arbitrary provider strings and leaves the portable contract
 * independent of browser provider construction; the two identities happen to
 * match again today.
 */
declare const SITE_PROJECT_PROVIDER_REGISTRY: Readonly<{
    readonly compositions: Readonly<{
        files: Readonly<{
            logicalId: "files";
            browserProviderId: "files";
        }>;
    }>;
    readonly content: Readonly<{
        "content-filesystem": Readonly<{
            logicalId: "content-filesystem";
            browserProviderId: "content-filesystem";
        }>;
    }>;
    readonly mappings: Readonly<{
        "mapping-filesystem": Readonly<{
            logicalId: "mapping-filesystem";
            browserProviderId: "mapping-filesystem";
        }>;
    }>;
    readonly sitemaps: Readonly<{
        "sitemap-filesystem": Readonly<{
            logicalId: "sitemap-filesystem";
            browserProviderId: "sitemap-filesystem";
        }>;
    }>;
}>;
type SiteProjectDomain = keyof typeof SITE_PROJECT_PROVIDER_REGISTRY;
type SiteProjectProviderId<TDomain extends SiteProjectDomain> = keyof (typeof SITE_PROJECT_PROVIDER_REGISTRY)[TDomain] & string;

declare const SITE_PROJECT_SCHEMA_VERSION: 2;
interface SiteProjectCollectionAttachment {
    id: RecordId;
    /** Deterministic authored ordering across distinct target slots. */
    order: number;
    composition: SiteProjectRecordRef<SiteProjectProviderId<"compositions">>;
    target: {
        nodeId: string;
        slotId: string;
    };
    mapping: SiteProjectRecordRef<SiteProjectProviderId<"mappings">>;
}
interface SiteProjectComponentPackRequirement {
    contractVersion: ComponentPackManifest["contractVersion"];
    packId: string;
    packVersion: string;
}
interface SiteProjectRecordRef<TProviderId extends string = string> {
    providerId: TProviderId;
    recordId: RecordId;
}
interface SiteProjectCompositionProvider {
    id: SiteProjectProviderId<"compositions">;
    records: CompositionRecord[];
}
interface SiteProjectContentProvider {
    id: SiteProjectProviderId<"content">;
    models: ContentModelRecord[];
    entries: ContentEntryRecord[];
}
interface SiteProjectMappingProvider {
    id: SiteProjectProviderId<"mappings">;
    records: MappingRecord[];
}
interface SiteProjectSitemapProvider {
    id: SiteProjectProviderId<"sitemaps">;
    records: SitemapRecord[];
}
interface SiteProjectProviders {
    compositions: SiteProjectCompositionProvider[];
    content: SiteProjectContentProvider[];
    mappings: SiteProjectMappingProvider[];
    sitemaps: SiteProjectSitemapProvider[];
}
/** The portable, JSON-safe whole-site aggregate. */
interface SiteProject {
    schemaVersion: typeof SITE_PROJECT_SCHEMA_VERSION;
    id: RecordId;
    name: string;
    componentPack: SiteProjectComponentPackRequirement;
    providers: SiteProjectProviders;
    activeSitemap: SiteProjectRecordRef<SiteProjectProviderId<"sitemaps">>;
    collectionAttachments: SiteProjectCollectionAttachment[];
}

interface SitemapRouteAncestor {
    nodeId: string;
    pathname: string;
    displayTitle: string;
    selectedEntry?: SitemapEntryRef;
}

interface ResolvedSitemapNavigationItem {
    id: string;
    label: string;
    href: string;
    external: boolean;
    nodeId?: string;
}
interface SitemapNavigationDiagnostic {
    code: "navigation-stale" | "navigation-ambiguous" | "navigation-unsafe";
    menu: "primary" | "footer";
    itemId: string;
    message: string;
}
interface ResolvedSitemapNavigation {
    primary: ResolvedSitemapNavigationItem[];
    footer: ResolvedSitemapNavigationItem[];
    diagnostics: SitemapNavigationDiagnostic[];
}

interface SiteCompiledModule {
    recordId: string;
    moduleSpecifier: string;
    kind: LinkedJsxModuleKind;
    code: string;
}
interface SiteCompiledRouteSource {
    kind: "composition" | "mapping";
    ref: SiteProjectRecordRef;
}
interface SiteCompiledRouteComposition {
    /** Stable provider-qualified identity of the canonical local Composition. */
    local: SiteProjectRecordRef;
    /** Deterministic route-variant identity used only for source planning. */
    routeRecordId: string;
    /** Evaluated local document. Its canonical source id is deliberately retained. */
    document: CompositionDocument;
    linkedSource?: {
        ref: SiteProjectRecordRef;
        outlet: {
            id: string;
            label: string;
            target: {
                parentId: string;
                slotId: string;
            };
        };
        document: CompositionDocument;
    };
}
interface SiteCompiledRoute {
    materializationSources?: readonly {
        renderedNodeId: string;
        providerId: string;
        recordId: string;
        nodeId: string;
        attachmentId: string;
        entries: readonly {
            providerId: string;
            modelId: string;
            recordId: string;
        }[];
    }[];
    pathname: string;
    /** Plain per-route title resolved during compilation; delivery never infers it from rendered content. */
    displayTitle: string;
    sitemapNode: {
        id: string;
        path: string;
    };
    source: SiteCompiledRouteSource;
    selectedEntry?: SitemapEntryRef;
    ancestors: readonly SitemapRouteAncestor[];
    composition: SiteCompiledRouteComposition;
    modules: readonly SiteCompiledModule[];
}
interface SiteBuildPlan {
    navigation: ResolvedSitemapNavigation;
    projectId: string;
    activeSitemap: SiteProjectRecordRef;
    routes: readonly SiteCompiledRoute[];
    /** Route targets plus code-identical, deduplicated dependency modules. */
    modules: readonly SiteCompiledModule[];
}

/** Fixed host structure prepared at build time: templates, outlets, mappings, sitemap and attachments. */
interface HostedSitePlan {
    project: SiteProject;
    /** Manifest-only pack data; runtime component functions never enter the projection. */
    componentPack: ComponentPackManifest;
    /** Exact-version Assets lock captured with the static build, required when Content uses managed Assets. */
    assetLock?: AssetReferenceLock;
}
/** A compiled route without generated JSX source: the neutral composition every renderer consumes. */
type HostedProjectedRoute = Omit<SiteCompiledRoute, "modules">;
interface HostedProjectionDiagnostic {
    code: string;
    message: string;
    path: string;
    pathname?: string;
}
type HostedSiteProjection = {
    status: "ready";
    projectId: string;
    navigation: SiteBuildPlan["navigation"];
    routes: HostedProjectedRoute[];
}
/** A type-valid incomplete draft may not compile; this is preview data, never an exception. */
 | {
    status: "blocked";
    diagnostics: HostedProjectionDiagnostic[];
};
/**
 * Worker-safe route projection over one Content snapshot, using the same pure compiler as
 * `compileStaticSite`. Release policy applies, so only published Entries participate; hosted
 * delivery candidates already mark every permitted Entry published.
 */
declare function projectHostedSite(plan: HostedSitePlan, providers: HostedProvider[]): Promise<HostedSiteProjection>;
/** A `project` service callback whose render data is the JSON projection of the whole site. */
declare function createHostedSiteProjector(plan: HostedSitePlan): HostedServiceOptions["project"];

type EditorialPerspective = "working" | "published";
/** `new`: absent from the activated publication. `published`: working values equal it. `changed`: they differ. */
type EditorialStatus = "new" | "published" | "changed";
/** What identifies the shown values: a working revision, or the activated publication (never a revision id). */
type EditorialValuesIdentity = {
    perspective: "working";
    token: string;
    revisionId: string | null;
} | {
    perspective: "published";
    release: string;
    fence: number;
};
interface EditorialEntryView {
    entry: ContentEntryRef;
    perspective: EditorialPerspective;
    status: EditorialStatus;
    /** Publication intent recorded on the working Entry. */
    lifecycle: ContentEntryRecord["lifecycle"];
    updatedAt: string;
    values: Record<string, JsonValue>;
    /** Head of the Entry's working history, the same in both perspectives; null before history begins. */
    workingRevisionId: string | null;
    valuesIdentity: EditorialValuesIdentity;
    /** Opaque precondition a save or restore quotes back; any newer write makes it stale. */
    expected: string;
}
interface EditorialRevision {
    id: string;
    entry: ContentEntryRef;
    sequence: number;
    parentId: string | null;
    values: Record<string, JsonValue>;
    createdAt: string;
    actor: {
        id: string;
    } | null;
    source: string;
    operation: {
        kind: string;
        key: string | null;
    };
    restoredFrom?: string;
}
interface EditorialRevisionPage {
    revisions: EditorialRevision[];
    nextCursor: string | null;
}
type EditorialRevisionTarget = {
    revisionId: string;
} | {
    perspective: EditorialPerspective;
};
interface EditorialFieldDifference {
    fieldId: string;
    key: string;
    label: string;
    change: "added" | "removed" | "changed";
    before?: JsonValue;
    after?: JsonValue;
    /** True when the current definition no longer has this field. */
    removedFromDefinition: boolean;
}
interface EditorialComparison {
    entry: ContentEntryRef;
    from: EditorialRevisionTarget;
    to: EditorialRevisionTarget;
    differences: EditorialFieldDifference[];
}
interface EditorialFieldsRequest {
    entry: ContentEntryRef;
    /** The `expected` of the view the change was prepared against. */
    expected: string;
    values: Record<string, JsonValue>;
    clear: string[];
}
/** A candidate validated against the pinned precondition; nothing was written. */
interface EditorialValidation {
    entry: ContentEntryRef;
    expected: string;
    values: Record<string, JsonValue>;
    differences: EditorialFieldDifference[];
}
interface EditorialReceipt {
    operationKey: string;
    entry: ContentEntryRef;
    /** The revision the operation appended, or the unchanged head when nothing changed. */
    revisionId: string | null;
    /** The precondition after this operation, for a follow-up such as an undo. */
    expected: string;
}
interface EditorialPublicationStatus {
    /** The activated publication that `published` reads return. */
    activated: {
        release: string | null;
        fence: number;
    };
    /** The newest submission still on its way, when the backend tracks one. */
    submission: {
        id: string;
        status: string;
    } | null;
    artifact: string | null;
    deployed: boolean;
}
type EditorialFieldDiagnosticCode = "field-removed" | "invalid-value" | "forbidden" | "collection-owned";
interface EditorialFieldDiagnostic {
    fieldId: string;
    code: EditorialFieldDiagnosticCode;
    message: string;
}
type EditorialErrorCode = "invalid-request" | "not-found" | "forbidden" | "invalid-value" | "revision-conflict" | "operation-key-reuse" | "restore-incompatible" | "configuration-required" | "unavailable";
declare class EditorialError extends Error {
    readonly code: EditorialErrorCode;
    readonly diagnostics: EditorialFieldDiagnostic[];
    readonly name = "EditorialError";
    constructor(code: EditorialErrorCode, message: string, diagnostics?: EditorialFieldDiagnostic[]);
}
/**
 * Bound by trusted server code to one actor and one source label, so
 * provenance never comes from a request body.
 */
interface ContentEditorialBoundary {
    readonly backend: "native" | "hosted";
    readEntry(query: {
        entry: ContentEntryRef;
        perspective: EditorialPerspective;
    }): Promise<EditorialEntryView>;
    /** The Entry model's current field definitions. */
    readFields(query: {
        entry: ContentEntryRef;
    }): Promise<EditorialField[]>;
    listRevisions(query: {
        entry: ContentEntryRef;
        cursor?: string;
        limit?: number;
    }): Promise<EditorialRevisionPage>;
    readRevision(query: {
        entry: ContentEntryRef;
        revisionId: string;
    }): Promise<EditorialRevision>;
    compare(query: {
        entry: ContentEntryRef;
        from: EditorialRevisionTarget;
        to: EditorialRevisionTarget;
    }): Promise<EditorialComparison>;
    validateFields(request: EditorialFieldsRequest): Promise<EditorialValidation>;
    saveFields(request: EditorialFieldsRequest & {
        operationKey: string;
    }): Promise<EditorialReceipt>;
    /** Writes the revision's values as a new working revision; publication intent, the activated publication and history are kept. */
    restoreRevision(request: {
        entry: ContentEntryRef;
        revisionId: string;
        expected: string;
        operationKey: string;
    }): Promise<EditorialReceipt>;
    publicationStatus(): Promise<EditorialPublicationStatus>;
    /**
     * The committed receipt of this actor's operation key, or null when none was
     * committed. Never writes, so a caller can tell recovery from a fresh request.
     */
    readOperation(query: {
        entry: ContentEntryRef;
        operationKey: string;
    }): Promise<EditorialReceipt | null>;
}
/** One field of the Entry's current definition. */
interface EditorialField {
    id: string;
    key: string;
    label: string;
    kind: string;
    required: boolean;
}
interface EditorialProvenance {
    actor: {
        id: string;
    } | null;
    source: string;
}

interface HostedEditorialOptions {
    /** The site's service for a trusted source label; every service shares the site's storage. */
    service(source: string): HostedService;
    provenance: EditorialProvenance;
}
declare function createHostedContentEditorial(options: HostedEditorialOptions): ContentEditorialBoundary;

/** Field keys and kinds Content-AI may write. Anything else is refused. */
declare const CONTENT_AI_FIELD_KEYS: readonly ["title", "body"];
interface ContentAiProposerInput {
    instruction: string;
    /** Only the scoped fields, with their current working values. */
    fields: {
        key: string;
        label: string;
        kind: string;
        value: string;
    }[];
    signal: AbortSignal;
}
type ContentAiProposerOutput = {
    kind: "proposal";
    values: Record<string, string>;
    summary: string;
} | {
    kind: "refusal";
    message: string;
};
interface ContentAiProposer {
    readonly label: string;
    propose(input: ContentAiProposerInput): Promise<ContentAiProposerOutput>;
}
interface ContentAiProposal {
    id: string;
    entry: ContentEntryRef;
    /** The precondition the proposal was validated against; Apply quotes it unchanged. */
    expected: string;
    summary: string;
    /** Field id → proposed value, scoped fields only. */
    values: Record<string, string>;
    differences: EditorialFieldDifference[];
    /** The exact working values Apply would write. */
    candidate: Record<string, unknown>;
    /** SHA-256 of the entry, precondition and candidate: what a rendered preview must acknowledge. */
    candidateDigest: string;
    operationKey: string;
    provider: string;
    createdAt: string;
    /** After this a fresh Apply is refused; a committed Apply or Undo stays recoverable. */
    expiresAt: string;
}
type ContentAiPrepareResult = {
    status: "proposed";
    proposal: ContentAiProposal;
} | {
    status: "refused";
    message: string;
};
/**
 * The immutable record of one prepared proposal. It is persisted before the
 * proposal is acknowledged, holds no editable Content, and is never updated:
 * whether it was applied or undone is read back from the owning backend's
 * receipts, so a crash between a commit and its response loses nothing.
 */
interface ContentAiProposalRecord {
    schemaVersion: 1;
    /** The trusted backend scope (store or site) the proposal belongs to; never taken from a request. */
    owner: string;
    actorId: string | null;
    proposal: ContentAiProposal;
}
interface ContentAiProposalStore {
    /** Create-only: an existing id is never overwritten. */
    create(record: ContentAiProposalRecord): Promise<void>;
    read(id: string): Promise<ContentAiProposalRecord | null>;
}
/** A proposal with what the backend has committed for it. */
interface ContentAiOperation {
    proposal: ContentAiProposal;
    applied: EditorialReceipt | null;
    undone: EditorialReceipt | null;
}
interface ContentAiOutcome {
    receipt: EditorialReceipt;
    recovered: boolean;
}
interface ContentAiServiceOptions {
    /** The owning backend's boundary bound to the given provenance. */
    boundary(provenance: EditorialProvenance): ContentEditorialBoundary;
    actor: {
        id: string;
    } | null;
    /** Trusted backend scope; a proposal recorded under another owner or actor is not found. */
    owner: string;
    /**
     * The inference provider, or null while none is usable. Reads, recovery of
     * committed operations, Apply of an already prepared proposal and Undo
     * never call it, so they keep working without one.
     */
    proposer: ContentAiProposer | null;
    store: ContentAiProposalStore;
    createId(): string;
    now?(): Date;
    /** How long a prepared proposal may be freshly applied; default 24 hours. */
    ttlMs?: number;
    /** False when the host permits proposals but no fresh Apply or Undo; committed ones stay recoverable. */
    canApply?: boolean;
}
interface ContentAiService {
    scope(entry: ContentEntryRef): Promise<EditorialField[]>;
    prepare(request: {
        entry: ContentEntryRef;
        instruction: string;
        signal?: AbortSignal;
    }): Promise<ContentAiPrepareResult>;
    /** The proposal and its committed Apply/Undo receipts; never writes and never calls the model. */
    read(request: {
        proposalId: string;
    }): Promise<ContentAiOperation>;
    /**
     * Recovers the committed Apply when there is one. Otherwise a fresh Apply
     * needs `renderedCandidate` to equal the proposal's candidate digest.
     */
    apply(request: {
        proposalId: string;
        renderedCandidate?: string;
    }): Promise<ContentAiOutcome>;
    undo(request: {
        proposalId: string;
    }): Promise<ContentAiOutcome>;
}
declare function contentAiCandidateDigest(value: {
    entry: ContentEntryRef;
    expected: string;
    candidate: Record<string, unknown>;
}): Promise<string>;
declare function createContentAiService(options: ContentAiServiceOptions): ContentAiService;
/** A process-local proposal store for tests and hosts that opt out of durability. */
declare function createMemoryContentAiProposalStore(records?: Map<string, ContentAiProposalRecord>): ContentAiProposalStore;
/**
 * Offline deterministic proposer for local trials and tests. It never contacts
 * a model, and its output is not evidence of model behavior.
 */
declare function createFakeContentAiProposer(): ContentAiProposer;

/**
 * Whether inference can run now. `ready` means the provider's own local check
 * passed, not that a model call has succeeded; `unknown` is never reported as
 * signed in.
 */
type ContentAiInference = {
    state: "ready";
    detail: string;
    version?: string | null;
} | {
    state: "unavailable";
    code: string;
    message: string;
} | {
    state: "unknown";
    message: string;
};
/** `configured` says the host set up Content-AI; `inference` says whether a new proposal can be prepared now. */
type ContentAiStatus = {
    configured: false;
} | {
    configured: true;
    provider: string;
    canApply: boolean;
    inference: ContentAiInference;
};
type ContentAiWireOperation = "content-ai-status" | "content-ai-scope" | "content-ai-prepare" | "content-ai-read" | "content-ai-apply" | "content-ai-undo";
type ContentAiWireResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: EditorialErrorCode;
        message: string;
        diagnostics: EditorialFieldDiagnostic[];
    };
};
interface ContentAiOperationHost {
    status(): Promise<ContentAiStatus>;
    /** Built per request with the host's trusted actor, owner, store, proposer and permission. */
    service(): Promise<ContentAiService>;
}
/** One Content-AI request. Editorial refusals become wire errors; anything else is a host fault and is rethrown. */
declare function runContentAiOperation(host: ContentAiOperationHost, operation: string, payload: unknown): Promise<ContentAiWireResult>;

export { COMPOSER_PREVIEW_CHANNEL, COMPOSER_PREVIEW_PROTOCOL_VERSION, CONTENT_AI_FIELD_KEYS, EditorialError, HostedContentError, canonicalSerialize, contentAiCandidateDigest, createContentAiService, createFakeContentAiProposer, createHostedContentEditorial, createHostedContentService, createHostedSiteProjector, createMemoryContentAiProposalStore, hostedDocumentErrorMessage, hostedDocumentErrorSchema, hostedPreviewBindingSchema, hostedPreviewResponseSchema, hostedReadyMessage, hostedReadySchema, hostedRenderMessage, hostedRenderSchema, hostedRenderedMessage, hostedRenderedSchema, matchesHostedPreviewBinding, projectHostedSite, readHostedPreviewRequest, readHostedPreviewResponse, runContentAiOperation };
export type { ContentAiInference, ContentAiOperation, ContentAiOperationHost, ContentAiOutcome, ContentAiPrepareResult, ContentAiProposal, ContentAiProposalRecord, ContentAiProposalStore, ContentAiProposer, ContentAiProposerInput, ContentAiProposerOutput, ContentAiService, ContentAiServiceOptions, ContentAiStatus, ContentAiWireOperation, ContentAiWireResult, ContentEditorialBoundary, ContentEntryRecord, ContentEntryRef, ContentFieldDefinition, ContentModelRecord, EditorialEntryView, EditorialErrorCode, EditorialField, EditorialFieldDiagnostic, EditorialFieldDifference, EditorialPerspective, EditorialProvenance, EditorialReceipt, EditorialRevision, HostedActor, HostedAdoptionResult, HostedAsset, HostedCanonicalAdoption, HostedCollectionPermission, HostedCommand, HostedCommit, HostedComparison, HostedDatabase, HostedDocumentError, HostedDocumentRender, HostedDocumentRendered, HostedEditorialOptions, HostedEditorialStatus, HostedEntryPage, HostedEntryView, HostedErrorCode, HostedFieldDifference, HostedFieldPermission, HostedFieldPreview, HostedHead, HostedIdentities, HostedModelPermission, HostedModelSummary, HostedPage, HostedPerspective, HostedPolicy, HostedPreviewBinding, HostedPreviewGuardFailure, HostedPreviewResponse, HostedProjectedRoute, HostedProjectionDiagnostic, HostedProvider, HostedPublication, HostedPublicationOverview, HostedPublicationStage, HostedRebaseChange, HostedRebaseDropReason, HostedReceipt, HostedRendererIdentity, HostedRestoreDiagnostic, HostedRestoreDiagnosticCode, HostedResult, HostedRevision, HostedRevisionOperation, HostedRevisionPage, HostedRevisionTarget, HostedService, HostedServiceOptions, HostedSitePlan, HostedSiteProjection, HostedSnapshot, HostedState, HostedStorage, HostedTransport, HostedValuesIdentity, MessageEventLike, MessagePoster, MessageTarget, PreviewPackIdentity };
