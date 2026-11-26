import { canonicalHostRoute } from "../../shared/host-route";
import { z } from "zod";
import type { HostDocumentPreview, HostDocumentTarget } from "../../../server/host-document/types";
const identitySchema = z.object({ workspaceId: z.string(), revision: z.string(), pathname: z.string(), packId: z.string(), packVersion: z.string(), rendererId: z.string(), rendererVersion: z.string(), rendererDigest: z.string() }).strict();
const targetSchema = z.object({ renderedNodeId: z.string(), providerId: z.string(), recordId: z.string(), nodeId: z.string() }).strict();
const envelope = { protocol: z.literal("zudo-host-document-v1"), identity: identitySchema, frameId: z.string(), visitorUrl: z.string().optional() };
const messageSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("ready") }).strict(),
  z.object({ ...envelope, type: z.literal("select"), target: targetSchema }).strict(),
  z.object({ ...envelope, type: z.literal("navigate"), url: z.string() }).strict(),
  z.object({ ...envelope, type: z.literal("leaving") }).strict(),
]);
export function knownVisitorUrl(value: string, origin: string, pathnames: readonly string[]): string | null {
  try { const url = new URL(value, origin); return value.startsWith("/") && url.origin === origin && canonicalHostRoute(url.pathname, pathnames) !== null ? url.pathname + url.search + url.hash : null; } catch { return null; }
}
export function matchesHostDocumentFrame(frame: HTMLIFrameElement | null, preview: HostDocumentPreview, origin: string, allowFragment = false): boolean {
  try {
    return !!frame && !!preview.navigation && frame.contentDocument?.querySelector('meta[name="zudo-host-document-frame"]')?.getAttribute("content") === preview.frameId && (allowFragment ? frame.contentWindow?.location.href.split("#")[0] === new URL(preview.navigation.url, origin).href.split("#")[0] : frame.contentWindow?.location.href === new URL(preview.navigation.url, origin).href);
  } catch { return false; }
}
export function acceptHostDocumentMessage(event: Pick<MessageEvent, "source" | "origin" | "data">, frame: Window | null, origin: string, preview: HostDocumentPreview): { type: "ready" | "leaving" } | { type: "navigate"; url: string } | { type: "select"; target: HostDocumentTarget } | null {
  if (!frame || event.source !== frame || event.origin !== origin) return null;
  const parsed = messageSchema.safeParse(event.data);
  if (!parsed.success || parsed.data.frameId !== preview.frameId || Object.keys(preview.identity).some(key => parsed.data.identity[key as keyof typeof preview.identity] !== preview.identity[key as keyof typeof preview.identity])) return null;
  const message = parsed.data;
  if (preview.navigation && message.visitorUrl !== preview.navigation.url) {
    // A native same-page fragment updates location before its hashchange message.
    if (message.type !== "navigate" || message.visitorUrl !== message.url || message.url.split("#")[0] !== preview.navigation.url.split("#")[0]) return null;
  }
  if (message.type === "ready" || message.type === "leaving") return { type: message.type };
  if (message.type === "navigate") {
    const url = preview.navigation && knownVisitorUrl(message.url, origin, preview.navigation.pathnames);
    return url ? { type: "navigate", url } : null;
  }
  const selected = message.target;
  const target = preview.targets.find(value => value.renderedNodeId === selected.renderedNodeId && value.providerId === selected.providerId && value.recordId === selected.recordId && value.nodeId === selected.nodeId);
  return target ? { type: "select", target } : null;
}

/** A later refusal says nothing about whether an earlier lost response committed. */
export function confirmedFirstAttemptRefusal(recovering: boolean, code: unknown): boolean {
  return !recovering && ["stale-plan", "component-invalid", "unsupported-scope", "unsupported-target", "wrong-workspace"].includes(String(code));
}
