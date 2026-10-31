import { JsonValue } from '@zudo-composer/component-contract';
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
interface HostedActor {
    id: string;
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
/** `unavailable` means storage kept refusing a commit; nothing was written and the exact request may be retried. */
type HostedErrorCode = "invalid-request" | "invalid-value" | "forbidden" | "not-found" | "revision-conflict" | "baseline-conflict" | "definition-conflict" | "operation-key-reuse" | "publication-busy" | "incomplete" | "restore-incompatible" | "configuration-required" | "unavailable";
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

/** `blocked`: the host must reconcile its definition or configuration; local values are retained until then. */
type HostedSavePhase = "loading" | "clean" | "dirty" | "saving" | "saved" | "recovering" | "conflict" | "blocked" | "failed";
interface HostedLocalEdit {
    entry: ContentEntryRef;
    fieldId: string;
    value?: JsonValue;
    revision: number;
}
interface HostedPendingOperation {
    request: HostedCommand;
    localRevision: number;
    rejected: boolean;
    rejectedCode?: HostedErrorCode;
}
/** The host persists this detached object. Session memory alone is not reload durability. */
interface HostedCreationDraft {
    collectionId: string;
    values: Record<string, JsonValue>;
    revision: number;
}
interface HostedRecoveryCheckpoint {
    version: 1;
    acknowledged: HostedState | null;
    edits: HostedLocalEdit[];
    localRevision: number;
    pending: HostedPendingOperation | null;
    publication?: HostedPublication | null;
    creationDraft?: HostedCreationDraft | null;
}
interface HostedEditorSessionState {
    phase: HostedSavePhase;
    invalidInputs: readonly string[];
    presentationRevision: number;
    content: HostedState | null;
    localRevision: number;
    dirty: boolean;
    pending: HostedPendingOperation | null;
    error: unknown;
    reviewedSnapshot: HostedSnapshot | null;
    publication: HostedPublication | null;
    publicationError: unknown;
    publicationStale: boolean;
    creationDraft: HostedCreationDraft | null;
    lastCreatedEntry: ContentEntryRef | null;
}
interface HostedPreviewAdapter {
    render(snapshot: HostedSnapshot, routeId: string): Promise<unknown>;
    readonly state?: {
        status: string;
        result?: {
            snapshotId: string;
            snapshotDigest: string;
            draftRevision: string;
            baseline: HostedIdentities["baseline"];
            definition: string;
            routeId: string;
        };
    };
    subscribe?(listener: () => void): () => void;
    invalidate?(): void;
    dispose?(): void;
}
interface HostedSessionOptions {
    transport: HostedTransport;
    createOperationKey(): string;
    /** Must persist before resolving if reload/crash recovery is required. */
    persistRecovery?(checkpoint: HostedRecoveryCheckpoint): void | Promise<void>;
    recovery?: HostedRecoveryCheckpoint;
    isAuthenticationExpired?(error: unknown): boolean;
    onAuthenticationExpired?(error: unknown): void;
    preview?: HostedPreviewAdapter;
}
/** One active immutable operation; later edits cannot be sent until it is resolved. */
declare class HostedContentSession {
    private options;
    private acknowledged;
    private edits;
    private projection;
    private invalidInputs;
    private presentationRevision;
    private revision;
    private pending;
    private phase;
    private error;
    private reviewed;
    private reviewedRoute;
    private unsubscribePreview?;
    private publication;
    private publicationError;
    private publicationStale;
    private creationDraft;
    private lastCreatedEntry;
    private previewGeneration;
    private flight;
    private listeners;
    private checkpointWrites;
    constructor(options: HostedSessionOptions);
    get state(): HostedEditorSessionState;
    private projectContent;
    private hasCurrentPreview;
    /** Error objects are kept separately from JSON checkpoint data. */
    get currentError(): unknown;
    subscribe(listener: (state: HostedEditorSessionState) => void): () => void;
    private emit;
    checkpoint(): HostedRecoveryCheckpoint;
    private persist;
    initialize(): Promise<void>;
    /** Browser-internal incomplete number text is local only, never a typed draft value. */
    setIncompleteInput(controlId: string, incomplete: boolean): void;
    stageCreation(collectionId: string, values: Record<string, JsonValue>): void;
    cancelCreation(): void;
    edit(entry: ContentEntryRef, fieldId: string, value: JsonValue | undefined): void;
    private fail;
    private resolvePending;
    flush(): Promise<void>;
    private command;
    private collectionAction;
    createEntry(collectionId: string, values: Record<string, JsonValue>, before?: ContentEntryRef | null): Promise<HostedResult>;
    addEntry(collectionId: string, entry: ContentEntryRef, before?: ContentEntryRef | null): Promise<HostedResult>;
    reorder(collectionId: string, entries: ContentEntryRef[]): Promise<HostedResult>;
    /**
     * Restore an exact revision as a new working revision through the guarded service command. Retained edits are
     * saved first, so a restore never overwrites unsaved work; a definite refusal writes nothing and leaves no
     * operation to review, because the request carried no local edits.
     */
    restoreRevision(entry: ContentEntryRef, revisionId: string): Promise<HostedResult>;
    /** A clean refresh may adopt a confirmed integration; dirty edits need explicit review. */
    refresh(): Promise<void>;
    refreshPublication(): Promise<HostedPublication>;
    captureAndPreview(routeId: string): Promise<HostedSnapshot>;
    submit(): Promise<HostedPublication>;
    /** Read-only conflict review; retained edits remain untouched. */
    reviewAuthoritative(): Promise<HostedState>;
    /** Explicit host/user decision after displaying the authoritative difference. */
    reapply(authoritative: HostedState): Promise<void>;
    /** Explicit discard is unavailable while an operation could still commit. */
    discard(authoritative: HostedState): Promise<void>;
    /** Presentation disposal leaves recovery and any in-flight operation intact. */
    dispose(): void;
}

interface HostedControlLabels {
    clear: string;
    addItem: string;
    removeItem: string;
    moveUp: string;
    moveDown: string;
    choose: string;
    none: string;
    unavailable: string;
    asset: string;
    item: string;
    bold: string;
    italic: string;
    link: string;
    heading: string;
    alt: string;
    caption: string;
    decorative: string;
    label: string;
    title: string;
    description: string;
    showSize: string;
    showType: string;
}

interface HostedEditorLabels extends HostedControlLabels {
    save: string;
    preview: string;
    submit: string;
    loading: string;
    clean: string;
    dirty: string;
    saving: string;
    saved: string;
    recovering: string;
    conflict: string;
    blocked: string;
    failed: string;
    content: string;
    edit: string;
    create: string;
    addExisting: string;
    cancel: string;
    review: string;
    reapply: string;
    discard: string;
    localValue: string;
    serverValue: string;
    reload: string;
    refreshStatus: string;
    statusUnavailable: string;
    cannotClear: string;
    lastKnownStatus: string;
    previewCurrent: string;
    previewRequired: string;
    submissionIncomplete: string;
    submitted: string;
    building: string;
    verified: string;
    integrated: string;
    deployed: string;
    unavailable: string;
}
declare const hostedEditorLabels: HostedEditorLabels;
declare const hostedEditorLabelsJa: HostedEditorLabels;
/** Routine messages by error code; the error object keeps its technical message and diagnostics for host support. */
declare const hostedErrorMessages: Record<HostedErrorCode, string>;
declare const hostedErrorMessagesJa: Record<HostedErrorCode, string>;

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

/** Additive hosted-document messages on the existing guarded Composer wire protocol.
 * This module is portable: no browser globals or renderer implementations. */

interface HostedRendererIdentity {
    rendererId: string;
    rendererVersion: string;
}
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
type HostedDocumentRender = z.infer<typeof hostedRenderSchema>;
type HostedDocumentRendered = z.infer<typeof hostedRenderedSchema>;
type HostedDocumentError = z.infer<typeof hostedDocumentErrorSchema>;
type HostedPreviewGuardFailure = "wrong-source" | "wrong-origin" | "invalid-payload" | "pack-mismatch" | "renderer-mismatch";

/** Browser lifecycle for the shared Composer guarded document protocol. */

interface HostedPreviewLocation {
    src: string;
    targetOrigin: string;
}
/** Preview URL is host configuration. Editable content never selects it. */
declare function buildHostedPreviewLocation(previewUrl: string, documentOrigin: string): HostedPreviewLocation;
type HostedPreviewState = {
    status: "idle" | "stale" | "disposed";
} | {
    status: "pending";
    snapshotId: string;
    routeId: string;
} | {
    status: "rendered";
    result: HostedDocumentRendered;
} | {
    status: "error";
    error: HostedPreviewError;
};
declare class HostedPreviewError extends Error {
    readonly code: HostedDocumentError["code"] | "timeout" | "superseded" | "disposed" | "identity-mismatch" | "transport-error";
    constructor(code: HostedDocumentError["code"] | "timeout" | "superseded" | "disposed" | "identity-mismatch" | "transport-error", message: string);
}
interface HostedPreviewControllerOptions {
    frame: {
        readonly contentWindow: MessagePoster | null;
        addEventListener?(type: "load", listener: () => void): void;
        removeEventListener?(type: "load", listener: () => void): void;
    };
    location: HostedPreviewLocation;
    hostWindow: MessageTarget;
    /** Defaults to the browser document origin; explicit for structural test hosts. */
    documentOrigin?: string;
    pack: PreviewPackIdentity;
    renderer: HostedRendererIdentity;
    /** Total wait includes transport readiness. Defaults to 10 seconds. */
    timeoutMs?: number;
    onState?(state: HostedPreviewState): void;
    onRejected?(reason: HostedPreviewGuardFailure, detail?: string): void;
}
interface HostedPreviewController {
    readonly state: HostedPreviewState;
    subscribe(listener: (state: HostedPreviewState) => void): () => void;
    render(snapshot: HostedSnapshot, routeId: string): Promise<HostedDocumentRendered>;
    /** A local change invalidates approval, including any in-flight completion. */
    invalidate(): void;
    /** Call before setting/reloading iframe src; old boot messages become obsolete. */
    reload(): void;
    dispose(): void;
}
declare function createHostedPreviewController(options: HostedPreviewControllerOptions): HostedPreviewController;
interface HostedPreviewRenderContext {
    signal: AbortSignal;
    isCurrent(): boolean;
}
interface HostedPreviewHostOptions {
    hostWindow: MessageTarget;
    parent: MessagePoster;
    origin: string;
    pack: PreviewPackIdentity;
    renderer: HostedRendererIdentity;
    /** Host generates a fresh opaque token for each document boot. */
    frameSession: string;
    /** Resolve only after actual visitor commit and declared asset/dependency work.
     * Check context before committing asynchronous work; obsolete work is aborted. */
    render(request: HostedDocumentRender, context: HostedPreviewRenderContext): void | Promise<void>;
    onRejected?(reason: HostedPreviewGuardFailure, detail?: string): void;
}
/** No framework dependency: a host mounts its own real renderer and styles. */
declare function createHostedPreviewHost(options: HostedPreviewHostOptions): {
    ready(): void;
    dispose(): void;
};
/** Fullscreen presentation retains the same iframe and never touches its src.
 * The host owns dialog/layout; this helper owns the trigger focus contract. */
declare function createHostedPreviewFullscreen(options: {
    show(): void;
    hide(): void;
}): {
    open(trigger: {
        focus(): void;
    }): void;
    close(): void;
    dispose(): void;
};

interface HostedEditorSelection {
    entry: ContentEntryRef;
    fieldId: string;
}
/** What a host field renderer receives. It never holds storage, transport or the session itself. */
interface HostedFieldRenderContext {
    readonly entry: ContentEntryRef;
    readonly field: ContentFieldDefinition;
    readonly permission: HostedFieldPermission;
    readonly value: JsonValue | undefined;
    readonly disabled: boolean;
    readonly labels: HostedEditorLabels;
    /** Stage a value through the same session edit as the built-in control; the service validates it on save. */
    setValue(next: JsonValue | undefined): void;
    /** Mount the built-in control for this field into a host element, e.g. beside a host-owned counter. */
    renderDefault(element: HTMLElement): HostedFieldMount;
}
interface HostedFieldMount {
    update(context: HostedFieldRenderContext): void;
    destroy(): void;
}
/** Host-owned control for chosen fields. Fields it does not match keep the built-in control. */
interface HostedFieldRenderer {
    matches(field: ContentFieldDefinition, entry: ContentEntryRef): boolean;
    mount(element: HTMLElement, context: HostedFieldRenderContext): HostedFieldMount;
}
interface HostedContentEditorOptions extends HostedSessionOptions {
    policy: HostedPolicy;
    selection: HostedEditorSelection;
    /** Defaults to the permitted record form; field mode is the minimal checkpoint surface. */
    presentation?: "record" | "field";
    routeId?: string;
    labels?: Partial<HostedEditorLabels>;
    /** Routine messages for typed errors, e.g. `hostedErrorMessagesJa`; other errors show their own message. */
    errorMessages?: Partial<Record<HostedErrorCode, string>>;
    /** Map typed diagnostics and transport failures to host-facing messages. Overrides `errorMessages`. */
    formatError?(error: unknown): string;
    onNavigate?(selection: HostedEditorSelection): void | Promise<void>;
    /** The first matching renderer replaces a record field's control; the label and clear action stay built in. */
    fieldRenderers?: HostedFieldRenderer[];
}
interface HostedContentEditorHandle {
    readonly state: HostedEditorSessionState;
    ready: Promise<void>;
    subscribe(listener: (state: HostedEditorSessionState) => void): () => void;
    flush(): Promise<void>;
    navigate(selection: HostedEditorSelection): Promise<void>;
    refresh(): Promise<void>;
    preview(): ReturnType<HostedContentSession["captureAndPreview"]>;
    submit(): ReturnType<HostedContentSession["submit"]>;
    refreshPublication(): ReturnType<HostedContentSession["refreshPublication"]>;
    readonly selection: HostedEditorSelection;
    /** Restore an exact revision of a permitted Entry as a new working revision; unsaved edits are saved first. */
    restore(entry: ContentEntryRef, revisionId: string): Promise<HostedResult>;
    dispose(): void;
}
/** Mount only the policy projection. Location paths/queries never select local authoring tools. */
declare function mountHostedContentEditor(container: HTMLElement, options: HostedContentEditorOptions): HostedContentEditorHandle;

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
interface EditorialReceipt {
    operationKey: string;
    entry: ContentEntryRef;
    /** The revision the operation appended, or the unchanged head when nothing changed. */
    revisionId: string | null;
    /** The precondition after this operation, for a follow-up such as an undo. */
    expected: string;
}
/** One field of the Entry's current definition. */
interface EditorialField {
    id: string;
    key: string;
    label: string;
    kind: string;
    required: boolean;
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

interface RemoteContentAi {
    status(): Promise<ContentAiStatus>;
    scope(entry: ContentEntryRef): Promise<EditorialField[]>;
    prepare(request: {
        entry: ContentEntryRef;
        instruction: string;
    }): Promise<ContentAiPrepareResult>;
    read(request: {
        proposalId: string;
    }): Promise<ContentAiOperation>;
    apply(request: {
        proposalId: string;
        renderedCandidate?: string;
    }): Promise<ContentAiOutcome>;
    undo(request: {
        proposalId: string;
    }): Promise<ContentAiOutcome>;
}
/** The browser half of Content-AI. Provenance and the proposer stay on the server. */
declare function createRemoteContentAi(call: (operation: ContentAiWireOperation, payload: unknown) => Promise<unknown>): RemoteContentAi;

export { HostedContentSession, HostedPreviewError, buildHostedPreviewLocation, createHostedPreviewController, createHostedPreviewFullscreen, createHostedPreviewHost, createRemoteContentAi, hostedEditorLabels, hostedEditorLabelsJa, hostedErrorMessages, hostedErrorMessagesJa, mountHostedContentEditor };
export type { HostedContentEditorHandle, HostedContentEditorOptions, HostedControlLabels, HostedEditorLabels, HostedEditorSelection, HostedEditorSessionState, HostedFieldMount, HostedFieldRenderContext, HostedFieldRenderer, HostedPreviewAdapter, HostedPreviewController, HostedPreviewControllerOptions, HostedPreviewHostOptions, HostedPreviewLocation, HostedPreviewRenderContext, HostedPreviewState, HostedRecoveryCheckpoint, HostedSessionOptions, RemoteContentAi };
