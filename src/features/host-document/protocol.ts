import { z } from "zod";
import type { HostDocumentPreview, HostDocumentTarget } from "../../../server/host-document/types";
const identitySchema = z.object({ workspaceId: z.string(), revision: z.string(), pathname: z.string(), packId: z.string(), packVersion: z.string(), rendererId: z.string(), rendererVersion: z.string(), rendererDigest: z.string() }).strict();
const targetSchema = z.object({ renderedNodeId: z.string(), providerId: z.string(), recordId: z.string(), nodeId: z.string() }).strict();
const messageSchema = z.discriminatedUnion("type", [z.object({ protocol: z.literal("zudo-host-document-v1"), type: z.literal("ready"), identity: identitySchema, frameId: z.string() }).strict(), z.object({ protocol: z.literal("zudo-host-document-v1"), type: z.literal("select"), identity: identitySchema, frameId: z.string(), target: targetSchema }).strict()]);
export function acceptHostDocumentMessage(event: Pick<MessageEvent, "source" | "origin" | "data">, frame: Window | null, origin: string, preview: HostDocumentPreview): { type: "ready" } | { type: "select"; target: HostDocumentTarget } | null {
  if (!frame || event.source !== frame || event.origin !== origin) return null;
  const parsed = messageSchema.safeParse(event.data);
  if (!parsed.success || parsed.data.frameId !== preview.frameId || Object.keys(preview.identity).some(key => parsed.data.identity[key as keyof typeof preview.identity] !== preview.identity[key as keyof typeof preview.identity])) return null;
  if (parsed.data.type === "ready") return { type: "ready" };
  const selected = parsed.data.target;
  const target = preview.targets.find(value => value.renderedNodeId === selected.renderedNodeId && value.providerId === selected.providerId && value.recordId === selected.recordId && value.nodeId === selected.nodeId);
  return target ? { type: "select", target } : null;
}

/** A later refusal says nothing about whether an earlier lost response committed. */
export function confirmedFirstAttemptRefusal(recovering: boolean, code: unknown): boolean {
  return !recovering && ["stale-plan", "component-invalid", "unsupported-scope", "unsupported-target", "wrong-workspace", "invalid-request"].includes(String(code));
}
