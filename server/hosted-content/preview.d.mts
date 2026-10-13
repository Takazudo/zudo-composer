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
interface HostedAsset {
    providerId: string;
    assetId: string;
    versionId: string;
    checksum: string;
    url: string;
    label: string;
}
interface HostedSnapshot extends HostedIdentities {
    id: string;
    digest: string;
    providers: HostedProvider[];
    assets: HostedAsset[];
    diagnostics: ContentCompletenessDiagnostic[];
    renderData: JsonValue;
}

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

export { HostedPreviewError, buildHostedPreviewLocation, createHostedPreviewController, createHostedPreviewFullscreen, createHostedPreviewHost };
export type { HostedPreviewController, HostedPreviewControllerOptions, HostedPreviewHostOptions, HostedPreviewLocation, HostedPreviewRenderContext, HostedPreviewState };
