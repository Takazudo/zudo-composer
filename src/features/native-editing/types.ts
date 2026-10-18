import type { CompositionRecord } from "../../composer/library/types";
import type { PreviewLinkedSourceContext } from "../composer/preview/protocol";

export interface NativeIdentity { workspaceId: string; sitemapId: string; pageId: string; providerId: "files"; recordId: string }
export type NativeInsertion = { kind: "text"; text: string } | { kind: "image"; assetId: string; alt: string } | { kind: "table"; columns: string[]; rows: string[][] };
export interface NativeRequest { workspaceId: string; page: string; sitemapId: string; after: { nodeId: string }; insert: NativeInsertion }
export interface NativeInspection {
  identity: NativeIdentity; revision: string; record: CompositionRecord; linked?: PreviewLinkedSourceContext;
  targets: { nodeId: string; kind: string; componentId: string; ordinal: number }[];
  allTargets: { nodeId: string; componentId: string; native: string | null; reason?: string }[];
  writeBlockers: string[]; capabilities: Record<string, { available: boolean; reason?: string }>;
}
export interface NativePlan { id: string; digest: string; dependencyDigest: string; request: NativeRequest; identity: NativeIdentity; before: CompositionRecord; candidate: CompositionRecord; linked?: PreviewLinkedSourceContext }
export interface NativeReceipt { operationId: string; planId: string; reviewDigest: string; kind: "applied" | "undone"; identity: NativeIdentity; beforeDigest: string; afterDigest: string; committedAt: string }
export interface NativeReceipts { applied: NativeReceipt | null; undone: NativeReceipt | null }
