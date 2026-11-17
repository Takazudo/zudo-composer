import type { HostDocumentIdentity, HostDocumentPreview, HostDocumentTarget } from "../../server/host-document/types";
import type { ContentEntryRef } from "../content/model";
import type { PageRef } from "../../server/edit/draft-model";

export type QualifiedNode = Pick<HostDocumentTarget, "renderedNodeId" | "providerId" | "recordId" | "nodeId">;
export interface HostSelection { revision: string; pathname: string; target: QualifiedNode; prop?: string }
export interface ContentFieldPolicy { providerId: string; modelId: string; fieldIds: readonly string[]; fieldInstructions?: Readonly<Record<string, string>> }
export interface AffectedUse { pathname: string; target: QualifiedNode; prop: string }
export interface InspectedOwner {
  capabilityId: string; baseDigest: string; pathname: string; target: QualifiedNode;
  field?: { prop: string; label: string; current: unknown };
  owner: { domain: "composition"; page: PageRef; recordId: string; nodeId: string }
    | { domain: "content"; entry: ContentEntryRef; fieldIds: readonly string[] }
    | { domain: "unsupported"; reason: string };
  capabilities: { fields: readonly { id: string; label: string; kind: string; editingConstraints?: { instructions: string; authority: "guidance-only" } }[]; insertSlots: readonly { slotId: string; components: readonly string[] }[] };
  affectedUses: readonly AffectedUse[];
}
export type ReviewOperation = { domain: "composition"; draftId: string; revision: number; draftCandidateDigest: string }
  | { domain: "content"; proposalId: string; contentCandidateDigest: string };
export interface HostReviewCard {
  id: string; workspaceId: string; operation: ReviewOperation; baseDigest: string; candidateDigest: string;
  summary: string; ownerLabel: string; affectedUses: readonly AffectedUse[];
  routes: readonly { pathname: string; title: string }[];
  status: "open" | "applied" | "undone" | "stale" | "discarded"; reason?: string;
}
export interface HostReviewPreview { reviewId: string; candidateDigest: string; baseDigest: string; preview: Omit<HostDocumentPreview, "html">; documentUrl: string }
export interface HostReviewAcknowledgement { reviewId: string; candidateDigest: string; baseDigest: string; identity: HostDocumentIdentity; frameId: string }
export interface HostReviewOutcome { domain: ReviewOperation["domain"]; reviewId: string; recovered: boolean; receipt: unknown }
export interface RunFence {
  conversationId: string; runId: string; turnId: string; toolCallId: string; signal: AbortSignal;
  assertActive(): Promise<void>;
}
export interface HostReviewService {
  inspect(input: { workspaceId: string; selection: HostSelection }, fence: RunFence): Promise<InspectedOwner>;
  stageContent(input: { workspaceId: string; capabilityId: string; values: Record<string, string>; summary: string }, fence: RunFence): Promise<HostReviewCard>;
  reviewComposition(input: { workspaceId: string; draftId: string; revision: number; candidateDigest: string }): Promise<HostReviewCard>;
  preview(input: { workspaceId: string; reviewId: string; pathname: string }): Promise<HostReviewPreview>;
  read(input: { workspaceId: string; reviewId: string }): Promise<HostReviewCard>;
  apply(input: { workspaceId: string; reviewId: string; rendered: HostReviewAcknowledgement }): Promise<HostReviewOutcome>;
  undo(input: { workspaceId: string; reviewId: string }): Promise<HostReviewOutcome>;
}
