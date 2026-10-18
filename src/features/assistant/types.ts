import type { CompositionRecord } from "../../composer/library/types";
import type { PreviewLinkedSourceContext } from "../composer/preview/protocol";

export interface PageRef { sitemapId: string; pageId: string }
export interface PageIdentity { workspaceId: string; sitemapId: string; pageId: string; providerId: "files"; recordId: string }
export interface DraftChange {
  id: string; kind: "field" | "added" | "removed"; page: PageRef; recordId: string; nodeId: string; componentId: string; componentTitle: string;
  prop?: string; fieldLabel?: string; before?: unknown; after?: unknown; props?: Record<string, unknown>; children?: number; operationIds: string[]; reasons: string[];
}
export interface DraftView {
  generation: number; permission: "apply" | "propose";
  draft: null | {
    id: string; revision: number; status: "open" | "applied" | "discarded" | "undone"; createdAt: string; updatedAt: string;
    applied: { operationId: string; candidateDigest: string; committedAt: string } | null; undone: { operationId: string; committedAt: string } | null;
    dependenciesCurrent: boolean; dependencyDigest?: string;
    operations: { id: string; kind: string; page: PageRef; provenance: { actor: string; conversationId?: string }; reason: string | null; createdAt: string }[];
    pages: { page: PageRef; identity: PageIdentity; before: CompositionRecord; candidate: CompositionRecord; changed: boolean; linked: PreviewLinkedSourceContext | null }[];
    changes: DraftChange[]; stale: { page: PageRef; reason: string }[]; buildError: { code: string; message: string } | null; candidateDigest: string | null;
  };
}
export interface UsedMemory { status: "used" | "empty" | "off" | "unavailable"; revision: number | null; mode: MemoryMode; characters: number }
export type MemoryMode = "off" | "read-only" | "auto";
export interface MemoryView { revision: number; body: string; mode: MemoryMode; modeRevision: number; clearGeneration: number; updatedAt: string | null; history: { revision: number; actor: string; kind: string; createdAt: string; restoredFrom?: number }[] }
export interface MessageContext { page: (PageRef & { title?: string }) | null; selection: { nodeId: string; componentId?: string; label?: string } | null; payloadIds: string[] }
export interface ChatMessage {
  id: string; role: "user" | "assistant"; text: string; createdAt: string; turnId: string; runId?: string; context?: MessageContext; memory?: UsedMemory;
  draft?: { draftId: string; operationIds: string[] } | null;
  memoryProposals?: { id: string; baseRevision: number; change: { kind: "append"; text: string } | { kind: "replace"; find: string; text: string }; status: string; resolvedRevision?: number }[];
  remembered?: { revision: number }[]; suggestions?: { id: string; text: string; target: { page: PageRef; nodeId: string; prop: string } | null; status: string }[];
  outcome?: "completed" | "stopped" | "failed" | "interrupted";
}
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[] }
export interface ConversationSummary { id: string; title: string; updatedAt: string; messages: number; lastText: string }
export interface RunEvent { seq: number; at: string; type: string; data: Record<string, unknown> }
export interface RunRecord { id: string; conversationId: string; turnId: string; status: "running" | "completed" | "stopped" | "failed" | "interrupted"; error?: { code: string; message: string }; events: RunEvent[]; memory: UsedMemory | null }
export interface AssistantStatus {
  provider: { ok: true; provider: string; model: string } | { ok: false; code: string; message: string; model?: string };
  siteName: string; botName: string; defaultName: string; permission: "apply" | "propose"; memory: MemoryView;
  destination: { provider: string; model: string; sends: string[] };
}
