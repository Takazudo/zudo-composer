import { JsonValue } from '@zudo-composer/component-contract';
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
});
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
/** `unavailable` means storage kept refusing a commit; nothing was written and the exact request may be retried. */
type HostedErrorCode = "invalid-request" | "invalid-value" | "forbidden" | "not-found" | "revision-conflict" | "baseline-conflict" | "definition-conflict" | "operation-key-reuse" | "publication-busy" | "incomplete" | "configuration-required" | "unavailable";
declare class HostedContentError extends Error {
    readonly code: HostedErrorCode;
    readonly diagnostics?: ContentCompletenessDiagnostic[] | undefined;
    constructor(code: HostedErrorCode, message: string, diagnostics?: ContentCompletenessDiagnostic[] | undefined);
}
interface HostedTransport {
    readState(): Promise<HostedState>;
    execute(request: HostedCommand): Promise<HostedResult>;
    readReceipt(operationKey: string): Promise<HostedReceipt | null>;
    getPublication(publicationId: string): Promise<HostedPublication>;
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

export { COMPOSER_PREVIEW_CHANNEL, COMPOSER_PREVIEW_PROTOCOL_VERSION, HostedContentError, canonicalSerialize, createHostedContentService, hostedDocumentErrorMessage, hostedDocumentErrorSchema, hostedPreviewBindingSchema, hostedPreviewResponseSchema, hostedReadyMessage, hostedReadySchema, hostedRenderMessage, hostedRenderSchema, hostedRenderedMessage, hostedRenderedSchema, matchesHostedPreviewBinding, readHostedPreviewRequest, readHostedPreviewResponse };
export type { ContentEntryRecord, ContentEntryRef, ContentModelRecord, HostedActor, HostedAsset, HostedCollectionPermission, HostedCommand, HostedCommit, HostedDatabase, HostedDocumentError, HostedDocumentRender, HostedDocumentRendered, HostedErrorCode, HostedFieldPermission, HostedHead, HostedIdentities, HostedModelPermission, HostedPolicy, HostedPreviewBinding, HostedPreviewGuardFailure, HostedPreviewResponse, HostedProvider, HostedPublication, HostedPublicationStage, HostedReceipt, HostedRendererIdentity, HostedResult, HostedService, HostedServiceOptions, HostedSnapshot, HostedState, HostedStorage, HostedTransport, MessageEventLike, MessagePoster, MessageTarget, PreviewPackIdentity };
