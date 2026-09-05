import type { CompositionDocument } from "../../composer/model/types";
import type { CompositionRecordRef } from "../../composer/library";
import type { ContentEntryRecord } from "../../content";
import type { MappingRecordRef } from "../../mapping";
import type { SiteProjectCollectionAttachment } from "../../site-project";

/** A current named slot that an aggregate project service has verified. */
export interface MappingAttachmentTarget {
  readonly composition: CompositionRecordRef;
  readonly compositionName: string;
  readonly nodeId: string;
  readonly slotId: string;
  readonly slotLabel: string;
  readonly componentId: string;
  readonly cardinality: "single" | "many";
  readonly accepts?: readonly string[];
}

export interface MappingAttachmentDiagnostic {
  readonly code: string;
  readonly severity: "blocking" | "nonblocking";
  readonly message: string;
  readonly path?: string;
}

export interface MappingAttachmentItem {
  readonly attachment: SiteProjectCollectionAttachment;
  readonly target: MappingAttachmentTarget;
  readonly mapping: MappingRecordRef;
  readonly mappingName: string;
  readonly effectiveEntries: readonly ContentEntryRecord[];
  readonly materializedDocument?: CompositionDocument;
  readonly staticFallback?: CompositionDocument;
  readonly diagnostics: readonly MappingAttachmentDiagnostic[];
}

export interface MappingAttachmentSnapshot {
  readonly targets: readonly MappingAttachmentTarget[];
  readonly attachments: readonly MappingAttachmentItem[];
}

export interface MappingAttachmentPreview {
  readonly status: "ready" | "blocked" | "unavailable";
  readonly document?: CompositionDocument;
  readonly staticFallback?: CompositionDocument;
  readonly effectiveEntries: readonly ContentEntryRecord[];
  readonly diagnostics: readonly MappingAttachmentDiagnostic[];
}

/**
 * Aggregate attachment callbacks supplied by the workspace owner.
 *
 * Mapping owns the authoring surface; the aggregate service owns project
 * metadata, conflict validation, deterministic materialization and persistence.
 * Keeping this seam callback-based lets the route consume the shared contract
 * without reaching into SiteProject storage or duplicating compiler rules.
 */
export interface MappingAttachmentCallbacks {
  list(): Promise<MappingAttachmentSnapshot>;
  attach(request: {
    composition: CompositionRecordRef;
    target: { nodeId: string; slotId: string };
    mapping: MappingRecordRef;
  }): Promise<MappingAttachmentItem | void>;
  detach(attachment: SiteProjectCollectionAttachment): Promise<void>;
  preview(attachment: SiteProjectCollectionAttachment): Promise<MappingAttachmentPreview>;
  /** Mapping deletion must prove no persisted aggregate edge references it. */
  assertMappingDeletable(mapping: MappingRecordRef): Promise<void>;
  /** Flushes a queued aggregate mutation, when the owner uses staged writes. */
  flush?(): Promise<void>;
  /** Durable change notifications belong to the owner service, not the pane. */
  subscribe?(listener: () => void): () => void;
}

export interface MappingAttachmentState {
  readonly phase: "idle" | "loading" | "ready" | "error" | "unavailable";
  readonly snapshot: MappingAttachmentSnapshot | null;
  readonly preview: MappingAttachmentPreview | null;
  readonly message: string | null;
}

export const emptyMappingAttachmentState: MappingAttachmentState = {
  phase: "idle",
  snapshot: null,
  preview: null,
  message: null,
};

/** Stable target identity used by the attachment dialog and tests. */
export function attachmentTargetKey(target: Pick<MappingAttachmentTarget, "composition" | "nodeId" | "slotId">): string {
  return `${target.composition.providerId}/${target.composition.recordId}/${target.nodeId}/${target.slotId}`;
}
